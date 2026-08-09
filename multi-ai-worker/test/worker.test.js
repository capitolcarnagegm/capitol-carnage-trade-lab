import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/worker.js";

const allowedOrigin = "https://gmslocker.com";

test("health reports configured bindings without exposing secret values", async () => {
  const response = await worker.fetch(new Request("https://worker.example/health"), {
    DB: {},
    OPENAI_API_KEY: "test-only"
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.providers.openai, true);
  assert.equal(body.providers.claude, false);
  assert.equal(body.persistentMemory, true);
  assert.equal(JSON.stringify(body).includes("test-only"), false);
});

test("preflight rejects an unapproved origin", async () => {
  const response = await worker.fetch(new Request("https://worker.example/gm-chat", {
    method: "OPTIONS",
    headers: { Origin: "https://attacker.example" }
  }), {});

  assert.equal(response.status, 403);
});

test("chat rejects an unknown provider before calling an external API", async () => {
  const response = await worker.fetch(new Request("https://worker.example/gm-chat", {
    method: "POST",
    headers: {
      Origin: allowedOrigin,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      provider: "unknown",
      messages: [{ role: "user", content: "Test" }]
    })
  }), {});
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /Unknown provider mode/);
});

test("chat rejects malformed JSON", async () => {
  const response = await worker.fetch(new Request("https://worker.example/gm-chat", {
    method: "POST",
    headers: {
      Origin: allowedOrigin,
      "Content-Type": "application/json"
    },
    body: "{"
  }), {});
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "Request body must be valid JSON");
});
