import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { parseDeepSeekChunkForContent, trimContinuationOverlap } from "../../utils/deepseekWeb.js";
import {
  createDeepSeekToolCallState,
  extractOpenAIToolNames,
  flushDeepSeekToolText,
  formatOpenAIStreamToolCalls,
  processDeepSeekToolText,
} from "../../utils/deepseekToolCalls.js";

function ensureState(state) {
  if (!state.messageId) {
    state.messageId = `chatcmpl-${Date.now()}`;
    state.created = Math.floor(Date.now() / 1000);
  }
  if (typeof state.textBuffer !== "string") {
    state.textBuffer = "";
  }
  if (typeof state.reasoningBuffer !== "string") {
    state.reasoningBuffer = "";
  }
  if (typeof state.currentType !== "string") {
    state.currentType = "text";
  }
  if (!state.toolTextState || typeof state.toolTextState !== "object") {
    state.toolTextState = createDeepSeekToolCallState();
  }
  if (!(state.toolCallIds instanceof Map)) {
    state.toolCallIds = new Map();
  }
  if (!Array.isArray(state.toolNames)) {
    state.toolNames = extractOpenAIToolNames(state.requestTools);
  }
}

function buildChunk(state, delta, finishReason = null) {
  return {
    id: state.messageId,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model || "deepseek_chat",
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

function buildFinishChunk(state, finishReason) {
  state.finishReason = finishReason;
  state.finishReasonSent = true;
  return buildChunk(state, {}, finishReason);
}

function finalizeIfNeeded(state) {
  if (state.terminalError) {
    return null;
  }
  if (state.finishReasonSent) {
    return null;
  }
  const results = flushToolEvents(state);
  if (!state.textBuffer && !state.reasoningBuffer && !state.hadToolCalls && results.length === 0) {
    return null;
  }
  results.push(buildFinishChunk(state, state.finishReason || (state.hadToolCalls ? "tool_calls" : "stop")));
  return results;
}

export function deepseekToOpenAIResponse(chunk, state) {
  if (!state || typeof state !== "object") {
    return null;
  }

  ensureState(state);

  if (chunk == null) {
    return finalizeIfNeeded(state);
  }

  if (isDeepSeekTerminalErrorChunk(chunk)) {
    state.terminalError = true;
    state.finishReasonSent = true;
    return [stripDeepSeekTerminalErrorChunk(chunk)];
  }

  const parsed = parseDeepSeekChunkForContent(chunk, true, state.currentType);
  if (!parsed?.parsed) {
    return null;
  }

  state.currentType = parsed.newType || state.currentType;
  const results = [];

  for (const part of parsed.parts || []) {
    if (!part?.text) {
      continue;
    }

    if (part.type === "thinking") {
      const nextText = trimContinuationOverlap(state.reasoningBuffer, part.text);
      if (!nextText) {
        continue;
      }
      state.reasoningBuffer += nextText;
      results.push(buildChunk(state, { reasoning_content: nextText }));
      continue;
    }

    const nextText = trimContinuationOverlap(state.textBuffer, part.text);
    if (!nextText) {
      continue;
    }
    state.textBuffer += nextText;
    results.push(...processToolText(state, nextText));
  }

  if (parsed.contentFilter) {
    if (!state.finishReasonSent) {
      results.push(buildFinishChunk(state, "content_filter"));
    }
    return results.length > 0 ? results : null;
  }

  if (parsed.errorMessage) {
    state.finishReason = state.hadToolCalls ? "tool_calls" : "stop";
  }

  if (parsed.finished && !state.finishReasonSent) {
    results.push(...flushToolEvents(state));
    results.push(buildFinishChunk(state, state.hadToolCalls ? "tool_calls" : "stop"));
  }

  return results.length > 0 ? results : null;
}

function isDeepSeekTerminalErrorChunk(chunk) {
  return !!(
    chunk &&
    typeof chunk === "object" &&
    chunk._deepseekWebTerminalError === true &&
    chunk.error &&
    typeof chunk.error === "object" &&
    Number.isFinite(Number(chunk.status_code))
  );
}

function stripDeepSeekTerminalErrorChunk(chunk) {
  const { _deepseekWebTerminalError, ...rest } = chunk;
  return rest;
}

function processToolText(state, text) {
  const events = processDeepSeekToolText(state.toolTextState, text, state.toolNames);
  return buildToolEvents(state, events);
}

function flushToolEvents(state) {
  const events = flushDeepSeekToolText(state.toolTextState, state.toolNames);
  return buildToolEvents(state, events);
}

function buildToolEvents(state, events) {
  const results = [];
  for (const event of events) {
    if (event.type === "tool_calls") {
      const toolCalls = formatOpenAIStreamToolCalls(event.calls, state.toolCallIds);
      if (toolCalls.length > 0) {
        state.hadToolCalls = true;
        results.push(buildChunk(state, { tool_calls: toolCalls }));
      }
      continue;
    }
    if (event.text) {
      results.push(buildChunk(state, { content: event.text }));
    }
  }
  return results;
}

register(FORMATS.DEEPSEEK_WEB, FORMATS.OPENAI, null, deepseekToOpenAIResponse);
