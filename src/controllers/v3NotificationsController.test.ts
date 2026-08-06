import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePagination, toPublicNotification } from "./v3NotificationsController.js";

test("parsePagination defaults to limit 20, offset 0 when omitted", () => {
  assert.deepEqual(parsePagination(undefined, undefined), { limit: 20, offset: 0 });
});

test("parsePagination accepts a valid custom limit and offset", () => {
  assert.deepEqual(parsePagination(10, 40), { limit: 10, offset: 40 });
});

test("parsePagination rejects a limit above the maximum of 50", () => {
  assert.equal(parsePagination(51, 0), null);
});

test("parsePagination accepts exactly the maximum limit of 50", () => {
  assert.deepEqual(parsePagination(50, 0), { limit: 50, offset: 0 });
});

test("parsePagination rejects a negative offset", () => {
  assert.equal(parsePagination(20, -1), null);
});

test("parsePagination rejects a non-integer limit", () => {
  assert.equal(parsePagination(1.5, 0), null);
});

test("parsePagination rejects a limit of zero", () => {
  assert.equal(parsePagination(0, 0), null);
});

test("toPublicNotification never includes recipient_email or user_id even if present on the row", () => {
  const row = {
    id: 1,
    title: "t",
    body: "b",
    source: "corenio-email-copy",
    read_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    // extra fields that must never leak through, even if a future query
    // accidentally selects them onto the row
    recipient_email: "leak@example.com",
    user_id: 999,
  } as unknown as Parameters<typeof toPublicNotification>[0];

  const result = toPublicNotification(row);

  assert.equal((result as unknown as Record<string, unknown>).recipient_email, undefined);
  assert.equal((result as unknown as Record<string, unknown>).user_id, undefined);
  assert.deepEqual(Object.keys(result).sort(), ["body", "created_at", "id", "is_read", "read_at", "source", "title"]);
});

test("toPublicNotification sets is_read true when read_at is set", () => {
  const result = toPublicNotification({
    id: 1,
    title: "t",
    body: "b",
    source: "corenio-email-copy",
    read_at: "2026-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(result.is_read, true);
});

test("toPublicNotification sets is_read false when read_at is null", () => {
  const result = toPublicNotification({
    id: 1,
    title: "t",
    body: "b",
    source: "corenio-email-copy",
    read_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(result.is_read, false);
});
