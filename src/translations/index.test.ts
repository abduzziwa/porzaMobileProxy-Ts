import { test } from "node:test";
import assert from "node:assert/strict";
import { translate } from "./index.js";

test("translate: returns English copy for language 'en'", () => {
  const result = translate("account_created", "en", {});
  assert.equal(result.title, "Welcome to Porza");
});

test("translate: returns Dutch copy for language 'nl'", () => {
  const result = translate("account_created", "nl", {});
  assert.equal(result.title, "Welkom bij Porza");
});

test("translate: returns German copy for language 'de'", () => {
  const result = translate("account_created", "de", {});
  assert.equal(result.title, "Willkommen bei Porza");
});

test("translate: falls back to English for an unrecognised language code", () => {
  const result = translate("account_created", "fr", {});
  assert.equal(result.title, "Welcome to Porza");
});

test("translate: falls back to English when language is null", () => {
  const result = translate("account_created", null, {});
  assert.equal(result.title, "Welcome to Porza");
});

test("translate: interpolates params into the body", () => {
  const result = translate("order_created", "en", { orderId: "397" });
  assert.match(result.body, /#397/);
});

test("translate: every language covers every event (no missing translations)", () => {
  const events: Array<Parameters<typeof translate>[0]> = [
    "account_created", "order_created", "order_paid", "order_cancelled",
    "order_expired", "order_failed", "new_device_login", "password_reset_requested",
  ];
  for (const lang of ["en", "nl", "de"] as const) {
    for (const event of events) {
      const result = translate(event, lang, { orderId: "1" });
      assert.ok(result.title.length > 0, `${lang}/${event} has no title`);
      assert.ok(result.body.length > 0, `${lang}/${event} has no body`);
    }
  }
});
