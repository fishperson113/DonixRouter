import { handleChat } from "#sse/handlers/chat.js";
import { FORMATS } from "#open-sse/translator/formats.js";
import { initTranslators, translateRequest } from "#open-sse/translator/index.js";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

function getPathSegments(params, request) {
  const rawPath =
    Array.isArray(params?.path) ? params.path.join("/") :
    typeof params?.path === "string" ? params.path :
    typeof params?.["*"] === "string" ? params["*"] :
    null;

  if (rawPath) {
    return rawPath.split("/").filter(Boolean);
  }

  const pathname = new URL(request.url).pathname;
  const normalized = pathname
    .replace(/^\/api\/v1beta\/models\/?/, "")
    .replace(/^\/v1beta\/models\/?/, "");

  return normalized.split("/").filter(Boolean);
}

function isGeminiCLIRequest(request) {
  const userAgent = (request.headers.get("user-agent") || "").toLowerCase();
  return userAgent.includes("gemini-cli")
    || userAgent.includes("geminicli")
    || userAgent.includes("proxy_client=geminicli");
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1beta/models/{model}:generateContent        — non-streaming
 * POST /v1beta/models/{model}:streamGenerateContent  — streaming (SSE)
 *
 * Streaming intent is determined by the URL action suffix (canonical Gemini API
 * convention), NOT by a body field. generationConfig.stream is not a real
 * Gemini API field and Gemini CLI never sets it.
 *
 * The @google/genai SDK always uses :streamGenerateContent?alt=sse for chat.
 * The upstream handleChat returns OpenAI SSE format; we transform it to
 * Gemini SSE format on the fly via transformOpenAISSEToGeminiSSE().
 */
export async function POST(request, { params }) {
  await ensureInitialized();

  try {
    const resolvedParams = await params;
    const path = getPathSegments(resolvedParams, request);
    if (path.length === 0) {
      throw new Error("Missing Gemini model path");
    }
    // path = ["provider", "model:action"] or ["model:action"]

    let model;
    let action; // ":generateContent" | ":streamGenerateContent"

    if (path.length >= 2) {
      // Format: /v1beta/models/provider/model:generateContent
      const provider = path[0];
      const modelAction = path.slice(1).join("/");
      action = modelAction.includes(":streamGenerateContent")
        ? ":streamGenerateContent"
        : ":generateContent";
      const modelName = modelAction
        .replace(":streamGenerateContent", "")
        .replace(":generateContent", "");
      model = provider + "/" + modelName;
    } else {
      // Format: /v1beta/models/model:generateContent
      const modelAction = path[0];
      action = modelAction.includes(":streamGenerateContent")
        ? ":streamGenerateContent"
        : ":generateContent";
      const bareModel = modelAction
        .replace(":streamGenerateContent", "")
        .replace(":generateContent", "");
      model = isGeminiCLIRequest(request) ? `gc/${bareModel}` : bareModel;
    }

    const body = await request.json();

    // Streaming is determined by URL action suffix:
    //   :streamGenerateContent => stream: true  (SSE)
    //   :generateContent       => stream: false (plain JSON)
    const stream = action === ":streamGenerateContent";

    // Convert Gemini request format to OpenAI/internal format
    const convertedBody = translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, model, body, stream);

    // Create new request with converted body
    const forwardedHeaders = new Headers(request.headers);
    const originalUserAgent = forwardedHeaders.get("user-agent");
    if (originalUserAgent) {
      forwardedHeaders.set("x-original-user-agent", originalUserAgent);
    }
    forwardedHeaders.set("user-agent", "donixrouter-gemini-bridge");

    const newRequest = new Request(request.url, {
      method: "POST",
      headers: forwardedHeaders,
      body: JSON.stringify(convertedBody),
    });

    const response = await handleChat(newRequest);

    if (stream) {
      // Transform OpenAI SSE => Gemini SSE on the fly.
      // The @google/genai SDK always uses :streamGenerateContent?alt=sse and
      // expects Gemini SSE chunks (no [DONE] sentinel — stream just closes).
      return transformOpenAISSEToGeminiSSE(response, model);
    } else {
      // Convert OpenAI JSON response => Gemini GenerateContentResponse
      return await convertOpenAIResponseToGemini(response, model);
    }
  } catch (error) {
    console.log("Error handling Gemini request:", error);
    return Response.json(
      { error: { message: error.message, code: 500 } },
      { status: 500 }
    );
  }
}

/**
 * Convert Gemini request format to OpenAI/internal format.
 *
 * @param {object} geminiBody  - parsed Gemini request body
 * @param {string} model       - resolved model string (e.g. "gemini-pro-high")
 * @param {boolean} stream     - whether to stream (from URL action)
 */
function convertGeminiToInternal(geminiBody, model, stream) {
  const messages = [];

  // Convert system instruction
  if (geminiBody.systemInstruction) {
    const systemText = geminiBody.systemInstruction.parts
      ?.map(p => p.text)
      .join("\n") || "";
    if (systemText) {
      messages.push({ role: "system", content: systemText });
    }
  }

  // Convert contents to messages
  if (geminiBody.contents) {
    for (const content of geminiBody.contents) {
      const role = content.role === "model" ? "assistant" : "user";
      const text = content.parts?.map(p => p.text).join("\n") || "";
      messages.push({ role, content: text });
    }
  }

  return {
    model,
    messages,
    stream,
    max_tokens: geminiBody.generationConfig?.maxOutputTokens,
    temperature: geminiBody.generationConfig?.temperature,
    top_p: geminiBody.generationConfig?.topP,
  };
}

function parseToolArgs(argumentsValue) {
  if (!argumentsValue) return {};
  if (typeof argumentsValue === "object") return argumentsValue;
  try {
    return JSON.parse(argumentsValue);
  } catch {
    return {};
  }
}

function appendToolCallParts(parts, toolCalls) {
  if (!Array.isArray(toolCalls)) return;

  for (const toolCall of toolCalls) {
    const functionCall = toolCall?.function;
    if (!functionCall?.name) continue;
    parts.push({
      functionCall: {
        ...(functionCall.id ? { id: functionCall.id } : {}),
        name: functionCall.name,
        args: parseToolArgs(functionCall.arguments),
      },
    });
  }
}

/** Map OpenAI finish_reason => Gemini finishReason */
const FINISH_REASON_MAP = {
  stop: "STOP",
  length: "MAX_TOKENS",
  tool_calls: "STOP",
  content_filter: "SAFETY",
};

/**
 * Transform an OpenAI SSE stream into a Gemini SSE stream.
 *
 * OpenAI SSE format (what handleChat returns):
 *   data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}
 *   data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{...}}
 *   data: [DONE]
 *
 * Gemini SSE format (what @google/genai SDK expects):
 *   data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hi"}]},"index":0}]}
 *   data: {"candidates":[{"content":{"role":"model","parts":[{"text":""}]},"finishReason":"STOP","index":0}],"usageMetadata":{...}}
 *   (stream closes — no [DONE])
 */
function transformOpenAISSEToGeminiSSE(upstreamResponse, model) {
  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return upstreamResponse;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state = {
    responseId: "",
    modelVersion: model,
    usage: null,
    toolCalls: Object.create(null),
    buffer: "",
  };

  const processEvent = (data, controller) => {
    if (!data || data === "[DONE]") return;

    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    const choice = parsed.choices?.[0];
    if (!choice) return;

    const delta = choice.delta || {};
    if (parsed.id) state.responseId = parsed.id;
    if (parsed.model) state.modelVersion = parsed.model;
    if (parsed.usage) state.usage = parsed.usage;

    const parts = [];
    if (delta.reasoning_content) {
      parts.push({ text: delta.reasoning_content, thought: true });
    }
    if (delta.content) {
      parts.push({ text: delta.content });
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const toolCall of delta.tool_calls) {
        const index = toolCall?.index ?? 0;
        if (!state.toolCalls[index]) {
          state.toolCalls[index] = { id: "", name: "", arguments: "" };
        }
        const current = state.toolCalls[index];
        if (toolCall.id) current.id = toolCall.id;
        if (toolCall.function?.name) current.name += toolCall.function.name;
        if (typeof toolCall.function?.arguments === "string") {
          current.arguments += toolCall.function.arguments;
        }
      }
    }
    if (choice.finish_reason) {
      appendToolCallParts(parts, Object.values(state.toolCalls).map((toolCall) => ({
        function: {
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
      })));
    }

    if (parts.length === 0 && !choice.finish_reason) return;

    const candidate = {
      content: {
        role: "model",
        parts: parts.length > 0 ? parts : [{ text: "" }],
      },
      index: 0,
    };

    if (choice.finish_reason) {
      candidate.finishReason = FINISH_REASON_MAP[choice.finish_reason] || "STOP";
    }

    const geminiChunk = { candidates: [candidate] };

    if (choice.finish_reason && state.usage) {
      geminiChunk.usageMetadata = {
        promptTokenCount: state.usage.prompt_tokens || 0,
        candidatesTokenCount: state.usage.completion_tokens || 0,
        totalTokenCount: state.usage.total_tokens || 0,
      };
      const reasoningTokens =
        state.usage.completion_tokens_details?.reasoning_tokens;
      if (reasoningTokens) {
        geminiChunk.usageMetadata.thoughtsTokenCount = reasoningTokens;
      }
      geminiChunk.modelVersion = state.modelVersion || model;
      if (state.responseId) {
        geminiChunk.responseId = state.responseId;
      }
    }

    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify(geminiChunk)}\r\n\r\n`)
    );
  };

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      state.buffer += decoder.decode(chunk, { stream: true });

      const events = state.buffer.split(/\r?\n\r?\n/);
      state.buffer = events.pop() || "";

      for (const event of events) {
        if (!event.trim()) continue;
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        processEvent(data, controller);
      }
    },
    flush(controller) {
      const remaining = state.buffer + decoder.decode();
      if (!remaining.trim()) return;
      const data = remaining
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      processEvent(data, controller);
    },
  });

  return new Response(upstreamResponse.body.pipeThrough(transformStream), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Convert an OpenAI chat.completion JSON response into a Gemini
 * GenerateContentResponse so that Gemini CLI can parse it.
 */
async function convertOpenAIResponseToGemini(response, model) {
  if (!response.ok) return response;

  let body;
  try {
    body = await response.json();
  } catch {
    return response;
  }

  if (body.candidates) return Response.json(body, {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });

  if (body.error) return Response.json(body, {
    status: response.status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });

  const choice = body.choices?.[0];
  if (!choice) {
    return Response.json(body, {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  const { message, finish_reason } = choice;

  const parts = [];
  if (message.reasoning_content) {
    parts.push({ text: message.reasoning_content, thought: true });
  }
  if (message.content !== undefined && message.content !== null) {
    parts.push({ text: message.content || "" });
  }
  appendToolCallParts(parts, message.tool_calls);
  if (parts.length === 0) {
    parts.push({ text: "" });
  }

  const finishReason = FINISH_REASON_MAP[finish_reason] || "STOP";

  const geminiResponse = {
    candidates: [
      {
        content: { role: "model", parts },
        finishReason,
        index: 0,
      },
    ],
    modelVersion: body.model || model,
  };

  if (body.usage) {
    geminiResponse.usageMetadata = {
      promptTokenCount: body.usage.prompt_tokens || 0,
      candidatesTokenCount: body.usage.completion_tokens || 0,
      totalTokenCount: body.usage.total_tokens || 0,
    };
    const reasoningTokens = body.usage.completion_tokens_details?.reasoning_tokens;
    if (reasoningTokens) {
      geminiResponse.usageMetadata.thoughtsTokenCount = reasoningTokens;
    }
  }

  return Response.json(geminiResponse, {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}
