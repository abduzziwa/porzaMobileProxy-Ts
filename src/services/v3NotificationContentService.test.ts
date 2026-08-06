import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToNotificationText } from "./v3NotificationContentService.js";

test("strips tags and keeps plain text", () => {
  assert.equal(htmlToNotificationText("<p>Uw bestelling is succesvol ontvangen.</p>"), "Uw bestelling is succesvol ontvangen.");
});

test("removes script blocks and their contents", () => {
  const html = "<p>Hello</p><script>alert('x')</script><p>World</p>";
  assert.equal(htmlToNotificationText(html), "Hello World");
});

test("removes style blocks and their contents", () => {
  const html = "<style>.a{color:red}</style><p>Visible text</p>";
  assert.equal(htmlToNotificationText(html), "Visible text");
});

test("decodes common HTML entities", () => {
  const html = "Tom &amp; Jerry &lt;3 &quot;cats&quot; &#39;n&#39; &nbsp; dogs &gt; fish";
  assert.equal(htmlToNotificationText(html), 'Tom & Jerry <3 "cats" \'n\' dogs > fish');
});

test("collapses repeated whitespace and trims", () => {
  const html = "<div>  Hello   \n\n   World  </div>";
  assert.equal(htmlToNotificationText(html), "Hello World");
});

test("truncates to ~220 characters and appends an ellipsis", () => {
  const longText = "A".repeat(500);
  const result = htmlToNotificationText(`<p>${longText}</p>`);
  assert.ok(result.length <= 221, "result should be capped near 220 chars plus ellipsis");
  assert.ok(result.endsWith("…"));
});

test("does not truncate text shorter than the limit", () => {
  const html = "<p>Short message.</p>";
  const result = htmlToNotificationText(html);
  assert.equal(result, "Short message.");
  assert.ok(!result.endsWith("…"));
});
