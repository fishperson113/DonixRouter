import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCodexWsErrorEvent,
  classifyUpstreamError,
  isModelCapacityError,
} from "./errorClassification.js";

test("classifyCodexWsErrorEvent detects overloaded message", () => {
  const msg = {
    type: "response.failed",
    error: {
      type: "server_error",
      message: "Our servers are currently overloaded. Please try again later.",
    },
  };
  const result = classifyCodexWsErrorEvent(msg);
  assert.equal(result?.status, 503);
});

test("classifyUpstreamError marks model_capacity with shouldRetry", () => {
  const body = JSON.stringify({
    error: { message: "Our servers are currently overloaded. Please try again later." },
  });
  const result = classifyUpstreamError(503, body);
  assert.equal(result.type, "model_capacity");
  assert.equal(result.shouldRetry, true);
  assert.equal(result.shouldFallback, true);
});

test("isModelCapacityError matches 529 status", () => {
  const err = Object.assign(new Error("overloaded"), { status: 529, body: "" });
  assert.equal(isModelCapacityError(err), true);
});
