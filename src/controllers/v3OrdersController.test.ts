import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFormattedAmount, normalizePaymentStatus, resolveNewestOrderId } from "./v3OrdersController.js";

test("parses a Euro-formatted amount with comma decimal separator", () => {
  assert.equal(parseFormattedAmount("€ 97,05"), 97.05);
});

test("parses an amount with no currency symbol", () => {
  assert.equal(parseFormattedAmount("7,00"), 7);
});

test("parses a whole-number amount", () => {
  assert.equal(parseFormattedAmount("€ 125"), 125);
});

test("returns null for an unparsable string", () => {
  assert.equal(parseFormattedAmount("n/a"), null);
});

test("returns null for an empty string", () => {
  assert.equal(parseFormattedAmount(""), null);
});

// ── normalizePaymentStatus ──────────────────────────────────

test("normalizePaymentStatus: null order (not found) is unknown, never failed", () => {
  assert.equal(normalizePaymentStatus(null), "unknown");
});

test("normalizePaymentStatus: total_paid >= total is paid", () => {
  assert.equal(normalizePaymentStatus({ status: "new_order", total: 49.97, total_paid: 49.97 }), "paid");
});

test("normalizePaymentStatus: total_paid slightly over total still counts as paid", () => {
  assert.equal(normalizePaymentStatus({ status: "new_order", total: 49.97, total_paid: 50 }), "paid");
});

test("normalizePaymentStatus: total_paid 0 with a real total is pending", () => {
  assert.equal(normalizePaymentStatus({ status: "new_order", total: 49.97, total_paid: 0 }), "pending");
});

test("normalizePaymentStatus: status containing 'cancel' is cancelled", () => {
  assert.equal(normalizePaymentStatus({ status: "order_canceled", total: 49.97, total_paid: 0 }), "cancelled");
});

test("normalizePaymentStatus: status containing 'expir' is expired", () => {
  assert.equal(normalizePaymentStatus({ status: "payment_expired", total: 49.97, total_paid: 0 }), "expired");
});

test("normalizePaymentStatus: status containing 'fail' is failed", () => {
  assert.equal(normalizePaymentStatus({ status: "payment_failed", total: 49.97, total_paid: 0 }), "failed");
});

test("normalizePaymentStatus: unrecognised status defaults to pending, not failed", () => {
  assert.equal(normalizePaymentStatus({ status: "some_new_status_we_have_never_seen", total: 49.97, total_paid: 0 }), "pending");
});

test("normalizePaymentStatus: zero total never counts as paid even if total_paid is also 0", () => {
  assert.equal(normalizePaymentStatus({ status: "new_order", total: 0, total_paid: 0 }), "pending");
});

// ── resolveNewestOrderId ─────────────────────────────────────

test("resolveNewestOrderId: picks the highest numeric key regardless of object insertion order", () => {
  // Object keys are inserted out of numeric order on purpose — JS would
  // normally iterate integer-like keys ascending regardless, so this also
  // guards against relying on iteration order instead of an explicit max.
  const orders = { "390": {}, "397": {}, "394": {} };
  assert.equal(resolveNewestOrderId(orders), 397);
});

test("resolveNewestOrderId: a single order returns that order's id", () => {
  assert.equal(resolveNewestOrderId({ "42": {} }), 42);
});

test("resolveNewestOrderId: returns null for an empty orders object", () => {
  assert.equal(resolveNewestOrderId({}), null);
});
