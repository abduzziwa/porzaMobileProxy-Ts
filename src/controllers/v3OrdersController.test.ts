import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFormattedAmount } from "./v3OrdersController.js";

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
