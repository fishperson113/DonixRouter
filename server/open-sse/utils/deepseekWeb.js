const MIN_CONTINUATION_SNAPSHOT_LEN = 32;

const SKIP_PATTERNS = [
  "quasi_status",
  "elapsed_secs",
  "token_usage",
  "pending_fragment",
  "conversation_mode",
  "fragments/-1/status",
  "fragments/-2/status",
  "fragments/-3/status",
];

const SKIP_EXACT_PATHS = new Set(["response/search_status"]);

const LEAKED_BOS_MARKER_PATTERN = /<\|\s*begin_of_sentence\s*\|>/gi;
const LEAKED_THOUGHT_MARKER_PATTERN = /<\|\s*(?:begin_)?of_(?:thinking|thought)\s*\|>/gi;
const LEAKED_META_MARKER_PATTERN = /<\|\s*(?:assistant|tool|end_of_sentence|end_of_thinking|end_of_thought|end_of_toolresults|end_of_instructions)\s*\|>/gi;

export function asString(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return asString(value[0]);
  if (value == null) return "";
  return String(value).trim();
}

export function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const parsed = Number.parseInt(asString(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function trimContinuationOverlap(existing, incoming) {
  if (!incoming) return "";
  if (!existing) return incoming;
  if (incoming.length >= MIN_CONTINUATION_SNAPSHOT_LEN && incoming.startsWith(existing)) {
    return incoming.slice(existing.length);
  }
  if (incoming.length >= MIN_CONTINUATION_SNAPSHOT_LEN && existing.startsWith(incoming)) {
    return "";
  }
  return incoming;
}

export function createDeepSeekContinueState(sessionID = "") {
  return {
    sessionID: asString(sessionID),
    responseMessageID: 0,
    lastStatus: "",
    finished: false,
  };
}

export function prepareDeepSeekContinueStateForNextRound(state) {
  return {
    ...state,
    lastStatus: "",
    finished: false,
  };
}

export function observeDeepSeekContinueState(state, chunk) {
  if (!state || !chunk || typeof chunk !== "object") {
    return;
  }

  const topID = numberValue(chunk.response_message_id);
  if (topID > 0) {
    state.responseMessageID = topID;
  }

  observeContinueDirectPatch(state, chunk.p, chunk.v);

  if (chunk.p === "response") {
    observeContinueBatchPatches(state, "response", chunk.v);
  } else {
    observeContinueBatchPatches(state, "", chunk.v);
  }

  const response = chunk.v && typeof chunk.v === "object" ? chunk.v.response : null;
  observeContinueResponseObject(state, response);

  const messageResponse =
    chunk.message && typeof chunk.message === "object" ? chunk.message.response : null;
  observeContinueResponseObject(state, messageResponse);
}

export function shouldAutoContinueDeepSeek(state) {
  if (!state || state.finished || !state.sessionID || state.responseMessageID <= 0) {
    return false;
  }
  return ["INCOMPLETE", "AUTO_CONTINUE"].includes(asString(state.lastStatus).toUpperCase());
}

function observeContinueDirectPatch(state, path, value) {
  switch (normalizePatchPath(path)) {
    case "response/status":
    case "status":
    case "response/quasi_status":
    case "quasi_status":
      setContinueStatus(state, value);
      break;
    case "response/auto_continue":
    case "auto_continue":
      if (value === true) {
        state.lastStatus = "AUTO_CONTINUE";
      }
      break;
    default:
      break;
  }
}

function observeContinueResponseObject(state, response) {
  if (!state || !response || typeof response !== "object") {
    return;
  }
  const messageID = numberValue(response.message_id);
  if (messageID > 0) {
    state.responseMessageID = messageID;
  }
  setContinueStatus(state, response.status);
  if (response.auto_continue === true) {
    state.lastStatus = "AUTO_CONTINUE";
  }
}

function observeContinueBatchPatches(state, parentPath, raw) {
  if (!state || !Array.isArray(raw)) {
    return;
  }
  const parent = normalizePatchPath(parentPath);

  for (const patch of raw) {
    if (!patch || typeof patch !== "object") {
      continue;
    }
    const path = asString(patch.p);
    if (!path) {
      continue;
    }
    const fullPath = parent && !path.includes("/") ? `${parent}/${path}` : path;
    switch (normalizePatchPath(fullPath)) {
      case "response/status":
      case "status":
      case "response/quasi_status":
      case "quasi_status":
        setContinueStatus(state, patch.v);
        break;
      case "response/auto_continue":
      case "auto_continue":
        if (patch.v === true) {
          state.lastStatus = "AUTO_CONTINUE";
        }
        break;
      default:
        break;
    }
  }
}

function setContinueStatus(state, status) {
  const normalized = asString(status);
  if (!normalized) {
    return;
  }
  state.lastStatus = normalized;
  if (["FINISHED", "CONTENT_FILTER"].includes(normalized.toUpperCase())) {
    state.finished = true;
  }
}

function normalizePatchPath(path) {
  return asString(path).replace(/^\/+|\/+$/g, "");
}

function stripThinkTags(text) {
  if (typeof text !== "string" || !text) {
    return text;
  }
  return text.replace(/<\/?\s*think\s*>/gi, "");
}

function splitThinkingParts(parts) {
  const out = [];
  let thinkingDone = false;

  for (const part of parts) {
    if (!part) continue;

    if (thinkingDone && part.type === "thinking") {
      const cleaned = stripThinkTags(part.text);
      if (cleaned) {
        out.push({ text: cleaned, type: "text" });
      }
      continue;
    }

    if (part.type !== "thinking") {
      const cleaned = stripThinkTags(part.text);
      if (cleaned) {
        out.push({ text: cleaned, type: part.type });
      }
      continue;
    }

    const match = /<\/\s*think\s*>/i.exec(part.text);
    if (!match) {
      out.push(part);
      continue;
    }

    thinkingDone = true;
    const before = part.text.slice(0, match.index);
    const after = stripThinkTags(part.text.slice(match.index + match[0].length));

    if (before) {
      out.push({ text: before, type: "thinking" });
    }
    if (after) {
      out.push({ text: after, type: "text" });
    }
  }

  return { parts: out, transitioned: thinkingDone };
}

function dropThinkingParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    return parts;
  }
  return parts.filter((part) => part && part.type !== "thinking");
}

function finalizeThinkingParts(parts, thinkingEnabled, newType) {
  const splitResult = splitThinkingParts(parts);
  let finalType = newType;
  let finalParts = splitResult.parts;

  if (splitResult.transitioned) {
    finalType = "text";
  }

  if (!thinkingEnabled) {
    finalParts = dropThinkingParts(finalParts);
  }

  return { parts: finalParts, newType: finalType };
}

export function parseDeepSeekChunkForContent(chunk, thinkingEnabled, currentType, stripReferenceMarkers = true) {
  if (!chunk || typeof chunk !== "object") {
    return {
      parsed: false,
      parts: [],
      finished: false,
      contentFilter: false,
      errorMessage: "",
      newType: currentType,
    };
  }

  if (Object.prototype.hasOwnProperty.call(chunk, "error")) {
    return {
      parsed: true,
      parts: [],
      finished: true,
      contentFilter: false,
      errorMessage: formatErrorMessage(chunk.error),
      newType: currentType,
    };
  }

  const pathValue = asString(chunk.p);

  if (hasContentFilterStatus(chunk)) {
    return {
      parsed: true,
      parts: [],
      finished: true,
      contentFilter: true,
      errorMessage: "",
      newType: currentType,
    };
  }

  if (shouldSkipPath(pathValue)) {
    return {
      parsed: true,
      parts: [],
      finished: false,
      contentFilter: false,
      errorMessage: "",
      newType: currentType,
    };
  }

  if (isStatusPath(pathValue)) {
    return {
      parsed: true,
      parts: [],
      finished: isFinishedStatus(chunk.v),
      contentFilter: false,
      errorMessage: "",
      newType: currentType,
    };
  }

  if (!Object.prototype.hasOwnProperty.call(chunk, "v")) {
    return {
      parsed: true,
      parts: [],
      finished: false,
      contentFilter: false,
      errorMessage: "",
      newType: currentType,
    };
  }

  let newType = currentType;
  const parts = [];

  if (pathValue === "response/fragments" && asString(chunk.o).toUpperCase() === "APPEND" && Array.isArray(chunk.v)) {
    for (const fragment of chunk.v) {
      if (!fragment || typeof fragment !== "object") {
        continue;
      }
      const fragmentType = asString(fragment.type).toUpperCase();
      const content = asContentString(fragment.content, stripReferenceMarkers);
      if (!content) {
        continue;
      }
      if (fragmentType === "THINK" || fragmentType === "THINKING") {
        newType = "thinking";
        parts.push({ text: content, type: "thinking" });
      } else if (fragmentType === "RESPONSE") {
        newType = "text";
        parts.push({ text: content, type: "text" });
      } else {
        parts.push({ text: content, type: "text" });
      }
    }
  }

  if (pathValue === "response" && Array.isArray(chunk.v)) {
    for (const item of chunk.v) {
      if (!item || typeof item !== "object") {
        continue;
      }
      if (item.p === "fragments" && item.o === "APPEND" && Array.isArray(item.v)) {
        for (const fragment of item.v) {
          const fragmentType = asString(fragment?.type).toUpperCase();
          if (fragmentType === "THINK" || fragmentType === "THINKING") {
            newType = "thinking";
          } else if (fragmentType === "RESPONSE") {
            newType = "text";
          }
        }
      }
    }
  }

  if (pathValue === "response/content") {
    newType = "text";
  } else if (pathValue === "response/thinking_content" && (!thinkingEnabled || newType !== "text")) {
    newType = "thinking";
  }

  let partType = "text";
  if (pathValue === "response/thinking_content") {
    partType = !thinkingEnabled || newType !== "text" ? "thinking" : "text";
  } else if (pathValue.includes("response/fragments") && pathValue.includes("/content")) {
    partType = newType;
  } else if (!pathValue) {
    partType = newType || "text";
  }

  const value = chunk.v;
  if (typeof value === "string") {
    const content = asContentString(value, stripReferenceMarkers);
    const finalized = finalizeThinkingParts(
      filterLeakedContentFilterParts(content ? [{ text: content, type: partType }] : []),
      thinkingEnabled,
      newType,
    );
    return {
      parsed: true,
      parts: finalized.parts,
      finished: false,
      contentFilter: false,
      errorMessage: "",
      newType: finalized.newType,
    };
  }

  if (Array.isArray(value)) {
    const extracted = extractContentRecursive(value, partType, stripReferenceMarkers);
    if (extracted.finished) {
      return {
        parsed: true,
        parts: [],
        finished: true,
        contentFilter: false,
        errorMessage: "",
        newType,
      };
    }
    parts.push(...extracted.parts);
    const finalized = finalizeThinkingParts(
      filterLeakedContentFilterParts(parts),
      thinkingEnabled,
      newType,
    );
    return {
      parsed: true,
      parts: finalized.parts,
      finished: false,
      contentFilter: false,
      errorMessage: "",
      newType: finalized.newType,
    };
  }

  if (value && typeof value === "object") {
    const directContent = asContentString(value, stripReferenceMarkers);
    if (directContent) {
      parts.push({ text: directContent, type: partType });
    }

    const response = value.response && typeof value.response === "object" ? value.response : value;
    if (Array.isArray(response.fragments)) {
      for (const fragment of response.fragments) {
        if (!fragment || typeof fragment !== "object") {
          continue;
        }
        const content = asContentString(fragment.content, stripReferenceMarkers);
        if (!content) {
          continue;
        }
        const fragmentType = asString(fragment.type).toUpperCase();
        if (fragmentType === "THINK" || fragmentType === "THINKING") {
          newType = "thinking";
          parts.push({ text: content, type: "thinking" });
        } else if (fragmentType === "RESPONSE") {
          newType = "text";
          parts.push({ text: content, type: "text" });
        } else {
          parts.push({ text: content, type: partType });
        }
      }
    }
  }

  const finalized = finalizeThinkingParts(
    filterLeakedContentFilterParts(parts),
    thinkingEnabled,
    newType,
  );
  return {
    parsed: true,
    parts: finalized.parts,
    finished: false,
    contentFilter: false,
    errorMessage: "",
    newType: finalized.newType,
  };
}

function extractContentRecursive(items, defaultType, stripReferenceMarkers = true) {
  const parts = [];

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(item, "v")) {
      continue;
    }

    const itemPath = asString(item.p);
    const itemValue = item.v;

    if (isStatusPath(itemPath)) {
      if (isFinishedStatus(itemValue)) {
        return { parts: [], finished: true };
      }
      continue;
    }

    if (shouldSkipPath(itemPath)) {
      continue;
    }

    const content = asContentString(item.content, stripReferenceMarkers);
    if (content) {
      const typeName = asString(item.type).toUpperCase();
      if (typeName === "THINK" || typeName === "THINKING") {
        parts.push({ text: content, type: "thinking" });
      } else if (typeName === "RESPONSE") {
        parts.push({ text: content, type: "text" });
      } else {
        parts.push({ text: content, type: defaultType });
      }
      continue;
    }

    let partType = defaultType;
    if (itemPath.includes("thinking")) {
      partType = "thinking";
    } else if (itemPath.includes("content") || itemPath === "response" || itemPath === "fragments") {
      partType = "text";
    }

    if (typeof itemValue === "string") {
      const stringContent = asContentString(itemValue, stripReferenceMarkers);
      if (stringContent) {
        parts.push({ text: stringContent, type: partType });
      }
      continue;
    }

    if (!Array.isArray(itemValue)) {
      continue;
    }

    for (const inner of itemValue) {
      if (typeof inner === "string") {
        const innerContent = asContentString(inner, stripReferenceMarkers);
        if (innerContent) {
          parts.push({ text: innerContent, type: partType });
        }
        continue;
      }

      if (!inner || typeof inner !== "object") {
        continue;
      }

      const innerContent = asContentString(inner.content, stripReferenceMarkers);
      if (!innerContent) {
        continue;
      }

      const typeName = asString(inner.type).toUpperCase();
      if (typeName === "THINK" || typeName === "THINKING") {
        parts.push({ text: innerContent, type: "thinking" });
      } else if (typeName === "RESPONSE") {
        parts.push({ text: innerContent, type: "text" });
      } else {
        parts.push({ text: innerContent, type: partType });
      }
    }
  }

  return { parts, finished: false };
}

function isStatusPath(pathValue) {
  return pathValue === "response/status" || pathValue === "status";
}

function isFinishedStatus(value) {
  return asString(value).toUpperCase() === "FINISHED";
}

function filterLeakedContentFilterParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    return parts;
  }

  const out = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") {
      continue;
    }
    const { text, stripped } = stripLeakedContentFilterSuffix(part.text);
    if (stripped && shouldDropCleanedLeakedChunk(text)) {
      continue;
    }
    out.push(stripped ? { ...part, text } : part);
  }
  return out;
}

function stripLeakedContentFilterSuffix(text) {
  if (typeof text !== "string" || text === "") {
    return { text, stripped: false };
  }
  const idx = text.toUpperCase().indexOf("CONTENT_FILTER");
  if (idx < 0) {
    return { text, stripped: false };
  }
  return {
    text: text.slice(0, idx).replace(/[ \t\r]+$/g, ""),
    stripped: true,
  };
}

function shouldDropCleanedLeakedChunk(cleaned) {
  if (cleaned === "") {
    return true;
  }
  if (typeof cleaned === "string" && cleaned.includes("\n")) {
    return false;
  }
  return asString(cleaned) === "";
}

function hasContentFilterStatus(chunk) {
  if (!chunk || typeof chunk !== "object") {
    return false;
  }
  if (asString(chunk.code).toLowerCase() === "content_filter") {
    return true;
  }
  return hasContentFilterStatusValue(chunk);
}

function hasContentFilterStatusValue(value) {
  if (Array.isArray(value)) {
    return value.some((item) => hasContentFilterStatusValue(item));
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  const pathValue = asString(value.p);
  if (pathValue.toLowerCase().includes("status") && asString(value.v).toLowerCase() === "content_filter") {
    return true;
  }

  if (asString(value.code).toLowerCase() === "content_filter") {
    return true;
  }

  return Object.values(value).some((item) => hasContentFilterStatusValue(item));
}

function formatErrorMessage(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function shouldSkipPath(pathValue) {
  if (isFragmentStatusPath(pathValue)) {
    return true;
  }
  if (SKIP_EXACT_PATHS.has(pathValue)) {
    return true;
  }
  return SKIP_PATTERNS.some((pattern) => pathValue.includes(pattern));
}

function isFragmentStatusPath(pathValue) {
  if (!pathValue || pathValue === "response/status") {
    return false;
  }
  return /^response\/fragments\/-?\d+\/status$/i.test(pathValue);
}

export function isDeepSeekCitation(text) {
  return asString(text).startsWith("[citation:");
}

function asContentString(value, stripReferenceMarkers = true) {
  if (typeof value === "string") {
    return stripReferenceMarkers ? stripReferenceMarkersText(value) : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => asContentString(item, stripReferenceMarkers)).join("");
  }

  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "content")) {
      return asContentString(value.content, stripReferenceMarkers);
    }
    if (Object.prototype.hasOwnProperty.call(value, "v")) {
      return asContentString(value.v, stripReferenceMarkers);
    }
    if (Object.prototype.hasOwnProperty.call(value, "text")) {
      return asContentString(value.text, stripReferenceMarkers);
    }
    if (Object.prototype.hasOwnProperty.call(value, "value")) {
      return asContentString(value.value, stripReferenceMarkers);
    }
    return "";
  }

  if (value == null) {
    return "";
  }

  const text = String(value);
  return stripReferenceMarkers ? stripReferenceMarkersText(text) : text;
}

function stripReferenceMarkersText(text) {
  if (!text) {
    return text;
  }
  return text
    .replace(/\[(?:citation|reference):\s*\d+\]/gi, "")
    .replace(LEAKED_BOS_MARKER_PATTERN, "")
    .replace(LEAKED_THOUGHT_MARKER_PATTERN, "")
    .replace(LEAKED_META_MARKER_PATTERN, "");
}
