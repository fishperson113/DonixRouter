import test from "node:test";
import assert from "node:assert/strict";

import { buildRequestDiagnostics } from "./requestDiagnostics.js";

test("buildRequestDiagnostics includes resume and affinity context", () => {
  const diagnostics = buildRequestDiagnostics({
    tag: "Responses",
    entryId: "entry-1",
    requestId: "rid-12345678",
    model: "gpt-5.5",
    requestBody: {
      instructions: "Use tools carefully",
      input: [{ role: "user", content: "hello" }],
      tools: [{ type: "function", name: "run" }],
      reasoning: { effort: "high", summary: "auto" },
    },
    conversationId: "conversation-1234",
    promptCacheKey: "prompt-cache-5678",
    variantHash: "abc123def456",
    explicitPrevRespId: null,
    implicitPrevRespId: "resp_implicit_12345678",
    prevRespId: "resp_implicit_12345678",
    resumeActive: true,
    resumeReason: null,
    preferredConnectionId: "entry-1",
  });

  assert.match(diagnostics.summary, /\[Responses\] Account entry-1/);
  assert.match(diagnostics.summary, /resume=on/);
  assert.match(diagnostics.summary, /affinity=hit/);
  assert.equal(diagnostics.largePayloadWarning, undefined);
});

test("buildRequestDiagnostics emits large payload warning with item sizes", () => {
  const bigText = "A".repeat(60_000);
  const diagnostics = buildRequestDiagnostics({
    tag: "Responses",
    entryId: "entry-2",
    requestId: "rid-abcdef12",
    model: "gpt-5.5",
    requestBody: {
      instructions: "brief",
      input: [{ role: "user", content: bigText }],
      tools: [],
    },
    conversationId: "conv-2",
    promptCacheKey: "key-2",
    variantHash: "hash-2",
    explicitPrevRespId: null,
    implicitPrevRespId: null,
    prevRespId: null,
    resumeActive: false,
    resumeReason: null,
    preferredConnectionId: null,
  });

  assert.ok(diagnostics.payloadBytes > 50_000);
  assert.match(diagnostics.largePayloadWarning, /Large payload/);
  assert.match(diagnostics.largePayloadWarning, /\[0\] user/);
});
