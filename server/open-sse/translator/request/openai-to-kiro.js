/**
 * OpenAI to Kiro Request Translator
 * Converts OpenAI Chat Completions format to Kiro/AWS CodeWhisperer format
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { v4 as uuidv4 } from "uuid";

function getUserInput(item) {
  return item?.userInputMessage || null;
}

function getAssistantResponse(item) {
  return item?.assistantResponseMessage || null;
}

function cleanupUserContext(userInput) {
  const context = userInput?.userInputMessageContext;
  if (!context) return;
  if (Array.isArray(context.toolResults) && context.toolResults.length === 0) {
    delete context.toolResults;
  }
  if (Object.keys(context).length === 0) {
    delete userInput.userInputMessageContext;
  }
}

function getToolUseIds(assistantItem) {
  const toolUses = getAssistantResponse(assistantItem)?.toolUses;
  if (!Array.isArray(toolUses) || toolUses.length === 0) return new Set();
  return new Set(toolUses.map(toolUse => toolUse.toolUseId).filter(Boolean));
}

function filterToolResults(userItem, previousAssistantItem) {
  const userInput = getUserInput(userItem);
  const context = userInput?.userInputMessageContext;
  const toolResults = context?.toolResults;
  if (!Array.isArray(toolResults) || toolResults.length === 0) return 0;

  const allowedToolUseIds = getToolUseIds(previousAssistantItem);
  const before = toolResults.length;
  if (allowedToolUseIds.size === 0) {
    delete context.toolResults;
  } else {
    context.toolResults = toolResults.filter(result => allowedToolUseIds.has(result.toolUseId));
  }
  cleanupUserContext(userInput);
  return before - (context?.toolResults?.length || 0);
}

function hasMatchingToolResults(assistantItem, nextUserItem) {
  const toolUseIds = getToolUseIds(assistantItem);
  if (toolUseIds.size === 0) return true;

  const toolResults = getUserInput(nextUserItem)?.userInputMessageContext?.toolResults;
  if (!Array.isArray(toolResults) || toolResults.length === 0) return false;
  const resultIds = new Set(toolResults.map(result => result.toolUseId).filter(Boolean));
  return [...toolUseIds].every(id => resultIds.has(id));
}

function sanitizeToolContext(history, currentMessage) {
  let removedToolResults = 0;
  let removedToolUses = 0;

  for (let i = 0; i < history.length; i++) {
    if (getUserInput(history[i])) {
      removedToolResults += filterToolResults(history[i], history[i - 1]);
    }
  }
  if (currentMessage) {
    removedToolResults += filterToolResults(currentMessage, history[history.length - 1]);
  }

  for (let i = 0; i < history.length; i++) {
    const assistant = getAssistantResponse(history[i]);
    if (!assistant?.toolUses?.length) continue;
    const nextUser = history[i + 1] || currentMessage;
    if (!hasMatchingToolResults(history[i], nextUser)) {
      removedToolUses += assistant.toolUses.length;
      delete assistant.toolUses;
    }
  }

  for (let i = 0; i < history.length; i++) {
    if (getUserInput(history[i])) {
      removedToolResults += filterToolResults(history[i], history[i - 1]);
    }
  }
  if (currentMessage) {
    removedToolResults += filterToolResults(currentMessage, history[history.length - 1]);
  }

  return { removedToolResults, removedToolUses };
}

function normalizeHistoryShape(history) {
  while (history.length > 0 && !getUserInput(history[0])) {
    history.shift();
  }
  while (history.length > 0 && !getAssistantResponse(history[history.length - 1])) {
    history.pop();
  }
  if (history.length === 1) {
    history.length = 0;
  }
}

function getPayloadSizeBytes(obj) {
  return Buffer.byteLength(JSON.stringify(obj), "utf8");
}

function trimHistoryToSize(payload, maxBytes) {
  const history = payload?.conversationState?.history;
  if (!Array.isArray(history) || history.length === 0) return 0;

  let removed = 0;
  let payloadSize = getPayloadSizeBytes(payload);
  while (payloadSize > maxBytes && history.length > 0) {
    history.shift();
    removed += 1;
    if (history.length > 0) {
      history.shift();
      removed += 1;
    }
    payloadSize = getPayloadSizeBytes(payload);
  }

  return removed;
}

function measureContentSize(obj) {
  let size = 0;
  const visit = (value) => {
    if (typeof value === "string") size += Buffer.byteLength(value, "utf8");
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(obj);
  return size;
}

// Payload size budgets for Kiro history trimming.
// Kiro upstream (CodeWhisperer) reliably accepts ~1.5-2.5 MB before returning
// 400 "Input is too long". Token estimate: ~4 bytes/token, so:
//   1.5 MB ≈  380k tokens   (soft trim target)
//   2.5 MB ≈  640k tokens   (hard limit before send)
// Override via env if your account has a larger context allowance.
function readByteEnv(name, defaultBytes) {
  const raw = process.env?.[name];
  if (!raw) return defaultBytes;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultBytes;
}

export const KIRO_SOFT_PAYLOAD_BYTES = readByteEnv("KIRO_SOFT_PAYLOAD_BYTES", 1_500_000);
export const KIRO_HARD_PAYLOAD_BYTES = readByteEnv("KIRO_HARD_PAYLOAD_BYTES", 2_500_000);

function extractSystemPrompt(messages) {
  const parts = [];

  for (const msg of messages) {
    if (msg?.role !== "system") continue;

    if (typeof msg.content === "string") {
      const trimmed = msg.content.trim();
      if (trimmed) parts.push(trimmed);
      continue;
    }

    if (!Array.isArray(msg.content)) continue;
    const text = msg.content
      .map(part => (typeof part?.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
    if (text) parts.push(text);
  }

  return parts.join("\n\n");
}

/**
 * Convert OpenAI messages to Kiro format
 * Rules: tool -> user role, merge consecutive same roles
 */
function convertMessages(messages, tools, model) {
  let history = [];
  let currentMessage = null;
  
  let pendingUserContent = [];
  let pendingAssistantContent = [];
  let pendingToolResults = [];
  let pendingImages = [];
  let currentRole = null;

  // Image support is pre-filtered by caps in translateRequest before reaching here
  const supportsImages = true;

  const flushPending = () => {
    if (currentRole === "user") {
      const content = pendingUserContent.join("\n\n").trim() || "Continue";
      const userMsg = {
        userInputMessage: {
          content: content,
          modelId: ""
        }
      };

      // Attach images if present (Kiro API supports images field)
      if (pendingImages.length > 0) {
        userMsg.userInputMessage.images = pendingImages;
      }

      if (pendingToolResults.length > 0) {
        userMsg.userInputMessage.userInputMessageContext = {
          toolResults: pendingToolResults
        };
      }
      
      // Add tools to first user message
      if (tools && tools.length > 0 && history.length === 0) {
        if (!userMsg.userInputMessage.userInputMessageContext) {
          userMsg.userInputMessage.userInputMessageContext = {};
        }
        userMsg.userInputMessage.userInputMessageContext.tools = tools.map(t => {
          const name = t.function?.name || t.name;
          let description = t.function?.description || t.description || "";
          
          if (!description.trim()) {
            description = `Tool: ${name}`;
          }
          
          const schema = t.function?.parameters || t.parameters || t.input_schema || {};
          // Normalize schema: Kiro requires required[] and proper type/properties
          const normalizedSchema = Object.keys(schema).length === 0
            ? { type: "object", properties: {}, required: [] }
            : { ...schema, required: schema.required ?? [] };

          return {
            toolSpecification: {
              name,
              description,
              inputSchema: { json: normalizedSchema }
            }
          };
        });
      }
      
      history.push(userMsg);
      currentMessage = userMsg;
      pendingUserContent = [];
      pendingToolResults = [];
      pendingImages = [];
    } else if (currentRole === "assistant") {
      const content = pendingAssistantContent.join("\n\n").trim() || "Call tools";
      const assistantMsg = {
        assistantResponseMessage: {
          content: content
        }
      };
      history.push(assistantMsg);
      pendingAssistantContent = [];
    }
  };

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "system") continue;

    let role = msg.role === "tool" ? "user" : msg.role;
    
    // If role changes, flush pending
    if (role !== currentRole && currentRole !== null) {
      flushPending();
    }
    currentRole = role;
    
    if (role === "user") {
      // Extract content
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textParts = [];
        for (const c of msg.content) {
          if (c.type === "text" || c.text) {
            textParts.push(c.text || "");
          } else if (supportsImages && c.type === "image_url") {
            // OpenAI format: image_url.url with data URI
            const url = c.image_url?.url || "";
            const base64Match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (base64Match) {
              const mediaType = base64Match[1];
              const format = mediaType.split("/")[1] || mediaType;
              pendingImages.push({ format, source: { bytes: base64Match[2] } });
            } else if (url.startsWith("http://") || url.startsWith("https://")) {
              // Kiro only supports base64; fallback to URL text
              textParts.push(`[Image: ${url}]`);
            }
          } else if (supportsImages && c.type === "image") {
            // Claude format: source.type = "base64", source.media_type, source.data
            if (c.source?.type === "base64" && c.source?.data) {
              const mediaType = c.source.media_type || "image/png";
              const format = mediaType.split("/")[1] || mediaType;
              pendingImages.push({ format, source: { bytes: c.source.data } });
            }
          }
        }
        content = textParts.join("\n");
        
        // Check for tool_result blocks
        const toolResultBlocks = msg.content.filter(c => c.type === "tool_result");
        if (toolResultBlocks.length > 0) {
          toolResultBlocks.forEach(block => {
            const text = Array.isArray(block.content) 
              ? block.content.map(c => c.text || "").join("\n")
              : (typeof block.content === "string" ? block.content : "");
            
            pendingToolResults.push({
              toolUseId: block.tool_use_id,
              status: "success",
              content: [{ text: text }]
            });
          });
        }
      }
      
      // Handle tool role (from normalized)
      if (msg.role === "tool") {
        const toolContent = typeof msg.content === "string" ? msg.content : "";
        pendingToolResults.push({
          toolUseId: msg.tool_call_id,
          status: "success",
          content: [{ text: toolContent }]
        });
      } else if (content) {
        pendingUserContent.push(content);
      }
    } else if (role === "assistant") {
      // Extract text content and tool uses
      let textContent = "";
      let toolUses = [];
      
      if (Array.isArray(msg.content)) {
        const textBlocks = msg.content.filter(c => c.type === "text");
        textContent = textBlocks.map(b => b.text).join("\n").trim();
        
        const toolUseBlocks = msg.content.filter(c => c.type === "tool_use");
        toolUses = toolUseBlocks;
      } else if (typeof msg.content === "string") {
        textContent = msg.content.trim();
      }
      
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        toolUses = msg.tool_calls;
      }
      
      if (textContent) {
        pendingAssistantContent.push(textContent);
      }
      
      // Store tool uses in last assistant message
      if (toolUses.length > 0) {
        if (pendingAssistantContent.length === 0) {
          // pendingAssistantContent.push("Call tools");
        }
        
        // Flush to create assistant message with toolUses
        flushPending();
        
        const lastMsg = history[history.length - 1];
        if (lastMsg?.assistantResponseMessage) {
          lastMsg.assistantResponseMessage.toolUses = toolUses.map(tc => {
            if (tc.function) {
              return {
                toolUseId: tc.id || uuidv4(),
                name: tc.function.name,
                input: typeof tc.function.arguments === "string" 
                  ? JSON.parse(tc.function.arguments) 
                  : (tc.function.arguments || {})
              };
            } else {
              return {
                toolUseId: tc.id || uuidv4(),
                name: tc.name,
                input: tc.input || {}
              };
            }
          });
        }
        
        currentRole = null;
      }
    }
  }
  
  // Flush remaining
  if (currentRole !== null) {
    flushPending();
  }
  
  // Pop last userInputMessage as currentMessage (search from end, skip trailing assistant messages)
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].userInputMessage) {
      currentMessage = history.splice(i, 1)[0];
      break;
    }
  }

  // Grab tools from first history item BEFORE cleanup removes them
  const firstHistoryTools = history[0]?.userInputMessage?.userInputMessageContext?.tools;

  // Clean up history for Kiro API compatibility
  history.forEach(item => {
    if (item.userInputMessage?.userInputMessageContext?.tools) {
      delete item.userInputMessage.userInputMessageContext.tools;
    }
    if (item.userInputMessage?.userInputMessageContext &&
        Object.keys(item.userInputMessage.userInputMessageContext).length === 0) {
      delete item.userInputMessage.userInputMessageContext;
    }
    if (item.userInputMessage && !item.userInputMessage.modelId) {
      item.userInputMessage.modelId = model;
    }
  });

  // Merge consecutive user messages (Kiro requires alternating user/assistant)
  const mergedHistory = [];
  for (let i = 0; i < history.length; i++) {
    const current = history[i];
    if (current.userInputMessage &&
        mergedHistory.length > 0 &&
        mergedHistory[mergedHistory.length - 1].userInputMessage) {
      const prev = mergedHistory[mergedHistory.length - 1];
      prev.userInputMessage.content += "\n\n" + current.userInputMessage.content;
    } else {
      mergedHistory.push(current);
    }
  }

  // Inject tools into currentMessage AFTER cleanup
  if (firstHistoryTools && currentMessage?.userInputMessage &&
      !currentMessage.userInputMessage.userInputMessageContext?.tools) {
    if (!currentMessage.userInputMessage.userInputMessageContext) {
      currentMessage.userInputMessage.userInputMessageContext = {};
    }
    currentMessage.userInputMessage.userInputMessageContext.tools = firstHistoryTools;
  }

  return { history: mergedHistory, currentMessage };
}

/**
 * Build Kiro payload from OpenAI format
 */
export function buildKiroPayload(model, body, stream, credentials) {
  const messages = body.messages || [];
  const tools = body.tools || [];
  const sessionId = body._sessionId; // From Antigravity translator
  const maxTokens = body.max_tokens || body.max_completion_tokens || 32000;
  const temperature = body.temperature;
  const topP = body.top_p;
  const systemPrompt = extractSystemPrompt(messages);

  // Strip variant suffix that CodeWhisperer doesn't accept (e.g. "[1m]", "[200k]").
  // Claude CLI sometimes appends these to the model id, but the upstream rejects them.
  const normalizedModel = String(model || "").replace(/\[[^\]]+\]\s*$/, "").trim();

  const { history, currentMessage } = convertMessages(messages, tools, normalizedModel);

  const profileArn = credentials?.providerSpecificData?.profileArn || "";
  const conversationId = uuidv4();

  // Use the user's last message as-is. We deliberately avoid inlining
  // [System]/[Context] wrappers here — when the conversation grows long,
  // Kiro starts echoing those wrappers back as part of its own output.
  const finalContent = currentMessage?.userInputMessage?.content || "";

  // Inject system prompt as a virtual first user/assistant turn at the start of
  // history. This keeps the user's current turn clean while still steering the
  // model. Tagged with <system-instructions> so Kiro recognizes it as guidance,
  // not as content to be echoed back.
  if (systemPrompt) {
    history.unshift(
      {
        userInputMessage: {
          content: `<system-instructions>\n${systemPrompt}\n</system-instructions>`,
          modelId: normalizedModel,
        },
      },
      {
        assistantResponseMessage: {
          content: "Understood.",
        },
      }
    );
  }
  
  const payload = {
    conversationState: {
      chatTriggerType: "MANUAL",
      conversationId: conversationId,
      currentMessage: {
        userInputMessage: {
          content: finalContent,
          modelId: normalizedModel,
          origin: "AI_EDITOR",
          ...(currentMessage?.userInputMessage?.userInputMessageContext && {
            userInputMessageContext: currentMessage.userInputMessage.userInputMessageContext
          })
        }
      },
      history: history
    }
  };

  if (profileArn) {
    payload.profileArn = profileArn;
  }

  if (maxTokens || temperature !== undefined || topP !== undefined) {
    payload.inferenceConfig = {};
    if (maxTokens) payload.inferenceConfig.maxTokens = maxTokens;
    if (temperature !== undefined) payload.inferenceConfig.temperature = temperature;
    if (topP !== undefined) payload.inferenceConfig.topP = topP;
  }

  // Trim history aggressively before Kiro reaches the degraded large-payload range.
  let payloadSize = getPayloadSizeBytes(payload);
  const originalHistoryLen = payload.conversationState.history.length;
  const sessionInfo = sessionId ? `session=${sessionId.slice(0, 12)}...` : "no-session";

  console.log(`[KIRO] Payload: ${(payloadSize / 1024).toFixed(1)}KB (content: ${(measureContentSize(payload) / 1024).toFixed(1)}KB) | ${originalHistoryLen} history | conv=${conversationId.slice(0, 8)}... | ${sessionInfo}`);

  trimHistoryToSize(payload, KIRO_SOFT_PAYLOAD_BYTES);
  normalizeHistoryShape(payload.conversationState.history);
  const softTrimmed = originalHistoryLen - payload.conversationState.history.length;
  if (softTrimmed > 0) {
    const softPayloadSize = getPayloadSizeBytes(payload);
    const softContentSize = measureContentSize(payload);
    console.log(`[KIRO] Soft-trimmed ${softTrimmed}/${originalHistoryLen} history entries -> ${(softPayloadSize / 1024).toFixed(1)}KB (content: ${(softContentSize / 1024).toFixed(1)}KB) | target ${(KIRO_SOFT_PAYLOAD_BYTES / 1024).toFixed(0)}KB`);
  }

  const toolStats = sanitizeToolContext(payload.conversationState.history, payload.conversationState.currentMessage);
  const historyLenAfterSoftTrim = payload.conversationState.history.length;

  trimHistoryToSize(payload, KIRO_HARD_PAYLOAD_BYTES);
  normalizeHistoryShape(payload.conversationState.history);

  const hardTrimmed = historyLenAfterSoftTrim - payload.conversationState.history.length;
  payloadSize = getPayloadSizeBytes(payload);
  const contentSize = measureContentSize(payload);

  if (hardTrimmed > 0) {
    console.log(`[KIRO] Hard-trimmed ${hardTrimmed}/${originalHistoryLen} history entries -> ${(payloadSize / 1024).toFixed(1)}KB (content: ${(contentSize / 1024).toFixed(1)}KB) | limit ${(KIRO_HARD_PAYLOAD_BYTES / 1024).toFixed(0)}KB`);
  }

  if (payload.conversationState.history.length < originalHistoryLen) {
    const historyLen = payload.conversationState.history.length;
    if (historyLen > 0) {
      const firstRole = payload.conversationState.history[0].userInputMessage ? "user" : "assistant";
      const lastRole = payload.conversationState.history[historyLen - 1].userInputMessage ? "user" : "assistant";
      console.log(`[KIRO] History structure: ${historyLen} entries | first=${firstRole} | last=${lastRole}`);
    }
  } else {
    console.log(`[KIRO] Payload within soft limit (${(payloadSize / 1024).toFixed(1)}KB < ${(KIRO_SOFT_PAYLOAD_BYTES / 1024).toFixed(0)}KB)`);
  }
  if (toolStats.removedToolResults > 0 || toolStats.removedToolUses > 0) {
    console.log(`[KIRO] Sanitized tool context: removed ${toolStats.removedToolResults} toolResults, ${toolStats.removedToolUses} toolUses`);
  }

  return payload;
}

register(FORMATS.OPENAI, FORMATS.KIRO, buildKiroPayload, null);
export { convertMessages };

