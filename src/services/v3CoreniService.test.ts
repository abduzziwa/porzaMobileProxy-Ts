import { test } from "node:test";
import assert from "node:assert/strict";
import { reorderByRequestedIds } from "./v3CoreniService.js";

test("reorderByRequestedIds: preserves the caller's requested order, not the map's key order", () => {
  // Object keys with integer-like names iterate in ascending numeric order
  // in JS regardless of insertion order — this must NOT leak through.
  const byId = { "394": "d", "390": "a", "397": "g" };
  assert.deepEqual(reorderByRequestedIds([397, 390, 394], byId), ["g", "a", "d"]);
});

test("reorderByRequestedIds: drops an id Corenio didn't return instead of leaving a hole", () => {
  const byId = { "1": "a", "3": "c" };
  assert.deepEqual(reorderByRequestedIds([1, 2, 3], byId), ["a", "c"]);
});

test("reorderByRequestedIds: returns an empty array when nothing matches", () => {
  assert.deepEqual(reorderByRequestedIds([1, 2], {}), []);
});

test("reorderByRequestedIds: an empty id list returns an empty array", () => {
  assert.deepEqual(reorderByRequestedIds([], { "1": "a" }), []);
});
