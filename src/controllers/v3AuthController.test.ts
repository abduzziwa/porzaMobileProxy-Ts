import { test } from "node:test";
import assert from "node:assert/strict";
import { findMissingSignupFields } from "./v3AuthController.js";

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
