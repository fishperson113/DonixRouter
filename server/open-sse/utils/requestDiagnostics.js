function itemRole(item) {
  if (typeof item !== "object" || item === null) return undefined;
  if ("role" in item) return item.role;
  if ("type" in item) return item.type;
  return undefined;
}

function byteSize(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function buildRequestDiagnostics(options) {
  const requestBody = options.requestBody || {};
  const payloadBytes = byteSize(requestBody);
  const inputItems = Array.isArray(requestBody.input) ? requestBody.input.length : 0;
  const instrLen = Buffer.byteLength(requestBody.instructions || "", "utf8");
  const toolsCount = Array.isArray(requestBody.tools) ? requestBody.tools.length : 0;
  const affinityHit = !!(options.preferredConnectionId && options.entryId === options.preferredConnectionId);
  const reasoning = requestBody.reasoning
    ? `effort=${requestBody.reasoning.effort || "none"} summary=${requestBody.reasoning.summary || "none"}`
    : "off";
  const prevSource = options.explicitPrevRespId
    ? "explicit"
    : options.implicitPrevRespId
      ? "implicit"
      : null;
  const prevField = prevSource && options.prevRespId
    ? `${prevSource}:${options.prevRespId.slice(-8)}`
    : "none";
  const convField = options.conversationId ? options.conversationId.slice(0, 8) : "none";
  const keyField = options.promptCacheKey ? options.promptCacheKey.slice(0, 8) : "none";
  const resumeField = options.explicitPrevRespId
    ? "explicit"
    : options.implicitPrevRespId
      ? (options.resumeActive ? "on" : `off:${options.resumeReason || "unknown"}`)
      : null;

  const summary =
    `[${options.tag}] Account ${options.entryId} | model=${options.model} | rid=${options.requestId.slice(0, 8)} conv=${convField} key=${keyField} vh=${options.variantHash} prev=${prevField}` +
    (resumeField ? ` resume=${resumeField}` : "") +
    ` | input_items=${inputItems} tools=${toolsCount} instr=${instrLen}B payload=${payloadBytes}B reasoning=[${reasoning}]` +
    (options.prevRespId ? ` | affinity=${affinityHit ? "hit" : "miss"}` : "");

  if (payloadBytes <= 50_000) {
    return { summary, payloadBytes };
  }

  const itemSizes = (requestBody.input || []).map((item, index) => {
    const size = Buffer.byteLength(JSON.stringify(item), "utf8");
    return `  [${index}] ${itemRole(item)} ${size}B`;
  });

  return {
    summary,
    payloadBytes,
    largePayloadWarning:
      `[${options.tag}] Large payload (${(payloadBytes / 1024).toFixed(1)}KB) | input_items=${inputItems} instr=${instrLen}B\n` +
      `  instructions: ${instrLen}B\n` +
      itemSizes.join("\n"),
  };
}

export function logRequestDiagnostics(options) {
  const { log = console.log, warn = console.warn, ...rest } = options;
  const diagnostics = buildRequestDiagnostics(rest);
  log(diagnostics.summary);
  if (diagnostics.largePayloadWarning) warn(diagnostics.largePayloadWarning);
  return diagnostics;
}
