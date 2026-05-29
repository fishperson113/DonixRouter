import test from "node:test";
import assert from "node:assert/strict";

import { buildCodexPoolKey } from "./codexPoolKey.js";

test("buildCodexPoolKey isolates explicit prompt cache variants by first user anchor", () => {
  const base = {
    model: "gpt-5.5",
    instructions: "same instructions",
    tools: [{ type: "function", name: "run" }],
    prompt_cache_key: "shared-session",
  };

  const first = buildCodexPoolKey({
    connectionId: "conn-1",
    conversationId: "shared-session",
    codexRequest: {
      ...base,
      input: [{ role: "user", content: "subagent A task" }],
    },
  });

  const second = buildCodexPoolKey({
    connectionId: "conn-1",
    conversationId: "shared-session",
    codexRequest: {
      ...base,
      input: [{ role: "user", content: "subagent B task" }],
    },
  });

  assert.notEqual(first.poolKey, second.poolKey);
  assert.notEqual(first.variantHash, second.variantHash);
});

test("buildCodexPoolKey returns null key when conversation id is missing", () => {
  const result = buildCodexPoolKey({
    connectionId: "conn-1",
    conversationId: null,
    codexRequest: { model: "gpt-5.5", instructions: "", input: [] },
  });

  assert.equal(result.poolKey, null);
  assert.equal(result.variantHash, null);
});
