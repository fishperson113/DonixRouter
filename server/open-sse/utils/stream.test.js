import test from "node:test";
import assert from "node:assert/strict";

import { collectResponsesMetadata } from "./stream.js";

test("collectResponsesMetadata tracks response ids from terminal and non-terminal response events", () => {
  const callIds = new Set();

  let state = collectResponsesMetadata({
    type: "response.created",
    response: { id: "resp_123" }
  }, null, callIds);

  assert.equal(state.responseId, "resp_123");
  assert.equal(state.functionCallIds.size, 0);

  state = collectResponsesMetadata({
    type: "response.completed",
    response: { id: "resp_456" }
  }, state.responseId, state.functionCallIds);

  assert.equal(state.responseId, "resp_456");
});

test("collectResponsesMetadata accumulates function call ids from output_item.done", () => {
  const callIds = new Set();

  const state = collectResponsesMetadata({
    type: "response.output_item.done",
    item: {
      type: "function_call",
      call_id: "call_abc",
      name: "read_file",
      arguments: "{}"
    }
  }, "resp_123", callIds);

  assert.equal(state.responseId, "resp_123");
  assert.deepEqual([...state.functionCallIds], ["call_abc"]);
});
