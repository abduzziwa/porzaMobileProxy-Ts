import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRecipients, computeUserDeliveryOutcome, groupTokensByUserId } from "./v3InternalNotificationsController.js";

test("normalizes and lowercases a valid recipient list", () => {
  assert.deepEqual(normalizeRecipients(["Customer@Example.com"]), ["customer@example.com"]);
});

test("trims whitespace around recipients", () => {
  assert.deepEqual(normalizeRecipients(["  a@example.com  "]), ["a@example.com"]);
});

test("removes duplicate recipients (case-insensitive)", () => {
  assert.deepEqual(normalizeRecipients(["a@example.com", "A@Example.com"]), ["a@example.com"]);
});

test("rejects a non-array value", () => {
  assert.equal(normalizeRecipients("a@example.com"), null);
});

test("rejects an empty array", () => {
  assert.equal(normalizeRecipients([]), null);
});

test("rejects more than 100 recipients", () => {
  const many = Array.from({ length: 101 }, (_, i) => `user${i}@example.com`);
  assert.equal(normalizeRecipients(many), null);
});

test("accepts exactly 100 recipients", () => {
  const hundred = Array.from({ length: 100 }, (_, i) => `user${i}@example.com`);
  const result = normalizeRecipients(hundred);
  assert.equal(result?.length, 100);
});

test("rejects a non-string entry", () => {
  assert.equal(normalizeRecipients(["a@example.com", 123]), null);
});

test("rejects a syntactically invalid email", () => {
  assert.equal(normalizeRecipients(["not-an-email"]), null);
});

// ── computeUserDeliveryOutcome ─────────────────────────────

test("computeUserDeliveryOutcome: no tokens → no_active_devices", () => {
  const result = computeUserDeliveryOutcome([], new Map());
  assert.deepEqual(result, { status: "no_active_devices", successCount: 0, failureCount: 0 });
});

test("computeUserDeliveryOutcome: single token succeeds → sent", () => {
  const result = computeUserDeliveryOutcome(["tokenA"], new Map([["tokenA", true]]));
  assert.deepEqual(result, { status: "sent", successCount: 1, failureCount: 0 });
});

test("computeUserDeliveryOutcome: multiple tokens, all succeed → sent", () => {
  const result = computeUserDeliveryOutcome(
    ["tokenA", "tokenB"],
    new Map([["tokenA", true], ["tokenB", true]])
  );
  assert.deepEqual(result, { status: "sent", successCount: 2, failureCount: 0 });
});

test("computeUserDeliveryOutcome: mixed success/failure → partially_sent", () => {
  const result = computeUserDeliveryOutcome(
    ["tokenA", "tokenB"],
    new Map([["tokenA", true], ["tokenB", false]])
  );
  assert.deepEqual(result, { status: "partially_sent", successCount: 1, failureCount: 1 });
});

test("computeUserDeliveryOutcome: all tokens fail → failed", () => {
  const result = computeUserDeliveryOutcome(
    ["tokenA", "tokenB"],
    new Map([["tokenA", false], ["tokenB", false]])
  );
  assert.deepEqual(result, { status: "failed", successCount: 0, failureCount: 2 });
});

test("computeUserDeliveryOutcome: token missing from result map counts as failure", () => {
  const result = computeUserDeliveryOutcome(["tokenA"], new Map());
  assert.deepEqual(result, { status: "failed", successCount: 0, failureCount: 1 });
});

// ── groupTokensByUserId ─────────────────────────────────────

test("groupTokensByUserId groups rows by user_id", () => {
  const map = groupTokensByUserId([
    { fcm_token: "t1", user_id: 1 },
    { fcm_token: "t2", user_id: 1 },
    { fcm_token: "t3", user_id: 2 },
  ]);
  assert.deepEqual(Array.from(map.get(1) ?? []).sort(), ["t1", "t2"]);
  assert.deepEqual(Array.from(map.get(2) ?? []).sort(), ["t3"]);
});

test("groupTokensByUserId dedupes a repeated token for the same user", () => {
  const map = groupTokensByUserId([
    { fcm_token: "t1", user_id: 1 },
    { fcm_token: "t1", user_id: 1 },
  ]);
  assert.deepEqual(map.get(1), ["t1"]);
});

test("groupTokensByUserId returns an empty map for no rows", () => {
  const map = groupTokensByUserId([]);
  assert.equal(map.size, 0);
});
