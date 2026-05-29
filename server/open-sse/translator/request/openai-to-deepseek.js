import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { resolveDeepSeekFlags, resolveDeepSeekModelClass } from "./deepseek-flags.js";

/**
 * Convert OpenAI request to DeepSeek format
 * DeepSeek expects: { prompt, model_class, temperature, stream, chat_session_id, system_prompt? }
 */
export function openaiToDeepSeekRequest(model, body, stream) {
  const messages = body.messages || [];
  
  // Extract system message
  let systemMessage = "";
  const conversationMessages = [];
  
  for (const msg of messages) {
    if (msg.role === "system") {
      const content = extractTextContent(msg.content);
      systemMessage += (systemMessage ? "\n\n" : "") + content;
    } else {
      conversationMessages.push({
        role: msg.role,
        content: extractTextContent(msg.content)
      });
    }
  }

  // DeepSeek expects the last user message as "prompt" field
  const lastMessage = conversationMessages[conversationMessages.length - 1];
  
  const { searchEnabled, thinkingEnabled } = resolveDeepSeekFlags(model, body);

  const result = {
    prompt: lastMessage?.content || "",
    model_class: resolveDeepSeekModelClass(model),
    model_preference: null,
    temperature: body.temperature !== undefined ? body.temperature : 0,
    stream: stream,
    ref_file_ids: [],
    search_enabled: searchEnabled,
    thinking_enabled: thinkingEnabled,
  };

  if (systemMessage) {
    result.system_prompt = systemMessage;
  }

  // Note: chat_session_id will be added by executor

  return result;
}

function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(part => part.type === "text")
      .map(part => part.text || "")
      .join("");
  }
  return "";
}

// Register translator
register(FORMATS.OPENAI, FORMATS.DEEPSEEK_WEB, openaiToDeepSeekRequest, null);
