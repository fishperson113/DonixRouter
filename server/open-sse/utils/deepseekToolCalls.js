import { randomUUID } from "node:crypto";

const TOOL_WRAPPER_OPEN = "<tool_calls";
const TOOL_WRAPPER_CLOSE = "</tool_calls>";
const TOOL_INVOKE_OPEN = "<invoke";
const TOOL_INVOKE_CLOSE = "</invoke>";
const PARTIAL_TOOL_PREFIXES = [
  "<tool_calls",
  "</tool_calls",
  "<invoke",
  "</invoke",
  "<parameter",
  "</parameter",
  "<![CDATA[",
];

export function createDeepSeekToolCallState() {
  return {
    pending: "",
    capture: "",
    capturing: false,
  };
}

export function extractOpenAIToolNames(tools) {
  if (!Array.isArray(tools)) {
    return [];
  }

  const seen = new Set();
  const names = [];
  for (const tool of tools) {
    const fn = tool?.function && typeof tool.function === "object" ? tool.function : tool;
    const name = typeof fn?.name === "string" ? fn.name.trim() : "";
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function formatOpenAIStreamToolCalls(calls, idStore) {
  if (!Array.isArray(calls) || calls.length === 0) {
    return [];
  }

  return calls.map((call, index) => ({
    index,
    id: ensureStreamToolCallId(idStore, index),
    type: "function",
    function: {
      name: call.name,
      arguments: JSON.stringify(call.input || {}),
    },
  }));
}

export function processDeepSeekToolText(state, text, toolNames = []) {
  const toolState = ensureToolState(state);
  if (text) {
    toolState.pending += text;
  }
  return drainToolState(toolState, toolNames, false);
}

export function flushDeepSeekToolText(state, toolNames = []) {
  const toolState = ensureToolState(state);
  return drainToolState(toolState, toolNames, true);
}

function ensureToolState(state) {
  if (!state || typeof state !== "object") {
    return createDeepSeekToolCallState();
  }
  if (typeof state.pending !== "string") {
    state.pending = "";
  }
  if (typeof state.capture !== "string") {
    state.capture = "";
  }
  if (state.capturing !== true) {
    state.capturing = false;
  }
  return state;
}

function drainToolState(state, toolNames, flush) {
  const events = [];

  while (true) {
    if (state.capturing) {
      if (state.pending) {
        state.capture += state.pending;
        state.pending = "";
      }

      const captureEnd = findToolCaptureEnd(state.capture);
      if (captureEnd < 0) {
        if (!flush) {
          break;
        }
        if (state.capture) {
          events.push({ type: "text", text: state.capture });
        }
        state.capture = "";
        state.capturing = false;
        continue;
      }

      const block = state.capture.slice(0, captureEnd);
      const suffix = state.capture.slice(captureEnd);
      state.capture = "";
      state.capturing = false;

      const calls = parseToolCallBlock(block, toolNames);
      if (calls.length > 0) {
        events.push({ type: "tool_calls", calls });
      } else if (block) {
        events.push({ type: "text", text: block });
      }

      if (suffix) {
        state.pending = suffix + state.pending;
      }
      continue;
    }

    if (!state.pending) {
      break;
    }

    const start = findFirstToolStart(state.pending);
    if (start >= 0) {
      const prefix = state.pending.slice(0, start);
      if (prefix) {
        events.push({ type: "text", text: prefix });
      }
      state.capture = state.pending.slice(start);
      state.pending = "";
      state.capturing = true;
      continue;
    }

    const partialStart = findPartialToolPrefixStart(state.pending);
    if (partialStart >= 0) {
      const prefix = state.pending.slice(0, partialStart);
      if (prefix) {
        events.push({ type: "text", text: prefix });
      }
      state.pending = state.pending.slice(partialStart);
      break;
    }

    events.push({ type: "text", text: state.pending });
    state.pending = "";
  }

  if (flush && state.pending) {
    events.push({ type: "text", text: state.pending });
    state.pending = "";
  }

  return events.filter((event) => {
    if (event.type === "tool_calls") {
      return Array.isArray(event.calls) && event.calls.length > 0;
    }
    return typeof event.text === "string" && event.text.length > 0;
  });
}

function findFirstToolStart(text) {
  const candidates = [
    text.toLowerCase().indexOf(TOOL_WRAPPER_OPEN),
    text.toLowerCase().indexOf(TOOL_INVOKE_OPEN),
  ].filter((index) => index >= 0);

  return candidates.length > 0 ? Math.min(...candidates) : -1;
}

function findPartialToolPrefixStart(text) {
  const lastOpen = text.lastIndexOf("<");
  if (lastOpen < 0) {
    return -1;
  }

  const suffix = text.slice(lastOpen);
  if (suffix.includes(">")) {
    return -1;
  }

  const lowered = suffix.toLowerCase();
  return PARTIAL_TOOL_PREFIXES.some((prefix) => prefix.toLowerCase().startsWith(lowered))
    ? lastOpen
    : -1;
}

function findToolCaptureEnd(text) {
  const lowered = text.toLowerCase();
  const wrapperOpenIndex = lowered.indexOf(TOOL_WRAPPER_OPEN);
  if (wrapperOpenIndex >= 0) {
    const wrapperCloseIndex = lowered.indexOf(TOOL_WRAPPER_CLOSE, wrapperOpenIndex);
    if (wrapperCloseIndex >= 0) {
      return wrapperCloseIndex + TOOL_WRAPPER_CLOSE.length;
    }
  }

  const trimmedLowered = lowered.trimStart();
  if (trimmedLowered.startsWith(TOOL_INVOKE_OPEN)) {
    const invokeCloseIndex = lowered.indexOf(TOOL_INVOKE_CLOSE);
    if (invokeCloseIndex >= 0) {
      return invokeCloseIndex + TOOL_INVOKE_CLOSE.length;
    }
  }

  return -1;
}

function parseToolCallBlock(block, _toolNames) {
  const raw = typeof block === "string" ? block.trim() : "";
  if (!raw) {
    return [];
  }

  const wrapped = raw.toLowerCase().includes(TOOL_WRAPPER_OPEN)
    ? raw
    : `<tool_calls>${raw}</tool_calls>`;
  const wrapperMatch = /<tool_calls\b[^>]*>([\s\S]*?)<\/tool_calls>/i.exec(wrapped);
  if (!wrapperMatch) {
    return [];
  }

  const calls = [];
  const invokeRegex = /<invoke\b([^>]*)>([\s\S]*?)<\/invoke>/gi;

  let invokeMatch;
  while ((invokeMatch = invokeRegex.exec(wrapperMatch[1])) !== null) {
    const invokeAttrs = parseXmlAttributes(invokeMatch[1]);
    const name = typeof invokeAttrs.name === "string" ? invokeAttrs.name.trim() : "";
    if (!name) {
      continue;
    }

    const input = {};
    const parameterRegex = /<parameter\b([^>]*)>([\s\S]*?)<\/parameter>/gi;
    let parameterMatch;
    while ((parameterMatch = parameterRegex.exec(invokeMatch[2])) !== null) {
      const parameterAttrs = parseXmlAttributes(parameterMatch[1]);
      const parameterName = typeof parameterAttrs.name === "string"
        ? parameterAttrs.name.trim()
        : "";
      if (!parameterName) {
        continue;
      }
      input[parameterName] = decodeXmlEntities(stripCdata(parameterMatch[2]).trim());
    }

    calls.push({ name, input });
  }

  return calls;
}

function parseXmlAttributes(text) {
  const attributes = {};
  const regex = /\b([A-Za-z0-9_:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    attributes[match[1]] = match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function stripCdata(text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  const match = /^<!\[CDATA\[([\s\S]*?)\]\]>$/i.exec(trimmed);
  return match ? match[1] : trimmed;
}

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function ensureStreamToolCallId(idStore, index) {
  if (!(idStore instanceof Map)) {
    return `call_${randomUUID().replace(/-/g, "")}`;
  }

  const key = Number.isInteger(index) ? index : 0;
  const existing = idStore.get(key);
  if (existing) {
    return existing;
  }

  const next = `call_${randomUUID().replace(/-/g, "")}`;
  idStore.set(key, next);
  return next;
}
