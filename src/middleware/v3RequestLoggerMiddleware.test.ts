import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequestLogEntry } from "./v3RequestLoggerMiddleware.js";

test("redacts body and response for the internal notifications route", () => {
  const entry = buildRequestLogEntry(
    "/v1/internal/notifications/email-copy",
    "POST",
    "/v1/internal/notifications/email-copy",
    { recipients: ["a@example.com"], title: "t", content: "<p>c</p>" },
    { accepted: true }
  );
  assert.equal(entry.body, "[redacted]");
  assert.equal(entry.response, "[redacted]");
});

test("does not redact unrelated routes", () => {
  const entry = buildRequestLogEntry("/v3/products", "POST", "/v3/products", { q: "brake" }, { results: [] });
  assert.notEqual(entry.body, "[redacted]");
  assert.notEqual(entry.response, "[redacted]");
  assert.deepEqual(entry.body, { q: "brake" });
});

test("preserves method and url unchanged even when redacting", () => {
  const entry = buildRequestLogEntry(
    "/v1/internal/notifications/email-copy",
    "POST",
    "/v1/internal/notifications/email-copy",
    {},
    {}
  );
  assert.equal(entry.method, "POST");
  assert.equal(entry.url, "/v1/internal/notifications/email-copy");
});
