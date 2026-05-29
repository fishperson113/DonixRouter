import test from "node:test";
import assert from "node:assert/strict";

import { buildKiroPayload, KIRO_SOFT_PAYLOAD_BYTES } from "./openai-to-kiro.js";

test("buildKiroPayload keeps system prompt on the current user turn instead of history", () => {
  const payload = buildKiroPayload("claude-opus-4.6", {
    messages: [
      { role: "system", content: "You are an exact coding assistant." },
      { role: "user", content: "First request" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second request" }
    ]
  }, true, {
    providerSpecificData: {
      profileArn: "arn:test"
    }
  });

  const currentContent = payload.conversationState.currentMessage.userInputMessage.content;
  const history = payload.conversationState.history;

  assert.match(currentContent, /\[System\]\nYou are an exact coding assistant\./);
  assert.match(currentContent, /Second request/);
  assert.equal(history.length, 2);
  assert.equal(history[0].userInputMessage.content, "First request");
  assert.equal(history[1].assistantResponseMessage.content, "First answer");
});

test("buildKiroPayload uses a fresh conversation id even when sessionId is reused", () => {
  const body = {
    _sessionId: "shared-session",
    messages: [
      { role: "user", content: "Hello" }
    ]
  };

  const first = buildKiroPayload("claude-opus-4.6", body, true, { providerSpecificData: {} });
  const second = buildKiroPayload("claude-opus-4.6", body, true, { providerSpecificData: {} });

  assert.notEqual(
    first.conversationState.conversationId,
    second.conversationState.conversationId
  );
});

test("buildKiroPayload respects explicit max_tokens from the client", () => {
  const payload = buildKiroPayload("claude-opus-4.6", {
    max_tokens: 2048,
    messages: [
      { role: "user", content: "Keep it short" }
    ]
  }, true, { providerSpecificData: {} });

  assert.equal(payload.inferenceConfig.maxTokens, 2048);
});

test("buildKiroPayload trims large history before reaching the hard payload limit", () => {
  const longText = "A".repeat(6000);
  const messages = [{ role: "user", content: `Initial ${longText}` }];

  for (let i = 0; i < 80; i++) {
    messages.push({ role: "assistant", content: `Assistant ${i} ${longText}` });
    messages.push({ role: "user", content: `User ${i} ${longText}` });
  }

  const payload = buildKiroPayload("claude-opus-4.6", { messages }, true, {
    providerSpecificData: {}
  });

  const payloadSize = Buffer.byteLength(JSON.stringify(payload), "utf8");

  assert.ok(payloadSize <= KIRO_SOFT_PAYLOAD_BYTES, `expected payload <= soft cap, got ${payloadSize}`);
  assert.ok(payload.conversationState.history.length < 160, "expected old history to be trimmed");
  assert.match(payload.conversationState.currentMessage.userInputMessage.content, /User 79/);
});
