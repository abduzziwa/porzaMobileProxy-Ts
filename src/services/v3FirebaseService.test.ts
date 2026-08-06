import { test } from "node:test";
import assert from "node:assert/strict";
import { isPermanentlyInvalidTokenError } from "./v3FirebaseService.js";

// sendPushNotifications itself calls the real firebase-admin SDK and is not covered
// here — this Node/test-runner version has no built-in module-mocking support, and a
// real call would require live credentials and would send a real notification, which
// this task explicitly forbids. The token-validity classification below is the piece
// of business logic that decides whether a token gets written back as 'invalid', so
// it is covered directly and does not touch the network.

test("marks 'registration-token-not-registered' as permanently invalid", () => {
  assert.equal(isPermanentlyInvalidTokenError("messaging/registration-token-not-registered"), true);
});

test("marks 'invalid-registration-token' as permanently invalid", () => {
  assert.equal(isPermanentlyInvalidTokenError("messaging/invalid-registration-token"), true);
});

test("does not mark network/unavailable errors as invalid", () => {
  assert.equal(isPermanentlyInvalidTokenError("messaging/server-unavailable"), false);
});

test("does not mark internal errors as invalid", () => {
  assert.equal(isPermanentlyInvalidTokenError("messaging/internal-error"), false);
});

test("does not mark quota errors as invalid", () => {
  assert.equal(isPermanentlyInvalidTokenError("messaging/quota-exceeded"), false);
});

test("does not mark unknown error codes as invalid", () => {
  assert.equal(isPermanentlyInvalidTokenError("messaging/some-other-error"), false);
});
