import { test } from "node:test";
import assert from "node:assert/strict";
import { findMissingSignupFields, computeDeletionPurgeDate, ACCOUNT_DELETION_GRACE_PERIOD_DAYS } from "./v3AuthController.js";

const COMPLETE_FIELDS = {
  country: "NL",
  state: "Noord-Brabant",
  phone: "+31201234567",
  mobphone: "+31612345678",
  sex: "male",
  companyinfo: "Particulier",
  address: "Teststraat 1",
};

test("findMissingSignupFields: all fields present returns no missing fields", () => {
  assert.deepEqual(findMissingSignupFields(COMPLETE_FIELDS), []);
});

test("findMissingSignupFields: undefined fields are listed by name", () => {
  const { state, mobphone, ...rest } = COMPLETE_FIELDS;
  assert.deepEqual(findMissingSignupFields(rest), ["state", "mobphone"]);
});

test("findMissingSignupFields: an empty string counts as missing, not just undefined", () => {
  assert.deepEqual(findMissingSignupFields({ ...COMPLETE_FIELDS, companyinfo: "" }), ["companyinfo"]);
});

test("findMissingSignupFields: every field missing returns every field name in check order", () => {
  assert.deepEqual(findMissingSignupFields({}), ["country", "state", "phone", "mobphone", "sex", "companyinfo", "address"]);
});

test("computeDeletionPurgeDate: adds exactly the grace period, 30 days", () => {
  const requestedAt = new Date("2026-01-01T00:00:00.000Z");
  const purgeAt = computeDeletionPurgeDate(requestedAt);
  assert.equal(ACCOUNT_DELETION_GRACE_PERIOD_DAYS, 30);
  assert.equal(purgeAt.toISOString(), "2026-01-31T00:00:00.000Z");
});

test("computeDeletionPurgeDate: correctly crosses a month boundary", () => {
  const requestedAt = new Date("2026-01-15T12:00:00.000Z");
  const purgeAt = computeDeletionPurgeDate(requestedAt);
  assert.equal(purgeAt.toISOString(), "2026-02-14T12:00:00.000Z");
});

test("computeDeletionPurgeDate: does not mutate the input date", () => {
  const requestedAt = new Date("2026-01-01T00:00:00.000Z");
  const original = requestedAt.toISOString();
  computeDeletionPurgeDate(requestedAt);
  assert.equal(requestedAt.toISOString(), original);
});
