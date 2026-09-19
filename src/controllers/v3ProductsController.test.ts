import { test } from "node:test";
import assert from "node:assert/strict";
import { extractProductProperties, productSortPriority } from "./v3ProductsController.js";

const RAW_PROPERTIES = [
  {
    name: "fitting position",
    value: "front axle",
    units: "",
    icon: "https://de.zoekonderdeel.nl/assets/modules/mod_ecommerce/prop_icons/3629.png",
    description: "<p>several KB of generic marketing HTML...</p>",
  },
  { name: "material", value: "low-metallic", units: "" },
  { name: "thickness", value: "17.7", units: "mm" },
];

test("extractProductProperties: pulls fitting position out as its own field", () => {
  const result = extractProductProperties(RAW_PROPERTIES);
  assert.equal(result.fitting_position, "front axle");
});

test("extractProductProperties: fitting position is excluded from the general properties list (no duplication)", () => {
  const result = extractProductProperties(RAW_PROPERTIES);
  assert.deepEqual(
    result.properties.map((p) => p.name),
    ["material", "thickness"]
  );
});

test("extractProductProperties: description is never forwarded, even for fitting position", () => {
  const result = extractProductProperties(RAW_PROPERTIES);
  const json = JSON.stringify(result);
  assert.equal(json.includes("marketing HTML"), false);
});

test("extractProductProperties: no fitting position present returns null, not undefined or empty string", () => {
  const result = extractProductProperties([{ name: "material", value: "ceramic", units: "" }]);
  assert.equal(result.fitting_position, null);
});

test("extractProductProperties: undefined input (no properties option requested) returns null + empty list", () => {
  assert.deepEqual(extractProductProperties(undefined), { fitting_position: null, properties: [] });
});

test("extractProductProperties: missing units/icon default to empty string, not undefined", () => {
  const result = extractProductProperties([{ name: "material", value: "steel" } as never]);
  assert.deepEqual(result.properties, [{ name: "material", value: "steel", units: "", icon: "" }]);
});

test("extractProductProperties: matches 'fitting position' case-insensitively", () => {
  const result = extractProductProperties([{ name: "Fitting Position", value: "rear axle", units: "" }]);
  assert.equal(result.fitting_position, "rear axle");
});

// Regression coverage for a real bug: Corenio fully localizes property
// NAMES (not just values), confirmed live against the same product in all
// 3 supported app languages — matching on the English string alone
// silently returned null for every nl/de request.
test("extractProductProperties: matches the Dutch translation ('passende positie')", () => {
  const result = extractProductProperties([{ name: "passende positie", value: "vooras", units: "" }]);
  assert.equal(result.fitting_position, "vooras");
});

test("extractProductProperties: matches the German translation ('Einbaulage')", () => {
  const result = extractProductProperties([{ name: "Einbaulage", value: "Vorderachse", units: "" }]);
  assert.equal(result.fitting_position, "Vorderachse");
});

test("extractProductProperties: localized fitting position is excluded from the general properties list too", () => {
  const result = extractProductProperties([
    { name: "passende positie", value: "vooras", units: "" },
    { name: "materiaal", value: "staal", units: "" },
  ]);
  assert.deepEqual(result.properties.map((p) => p.name), ["materiaal"]);
});

test("productSortPriority: in-stock with fitting position ranks highest (0)", () => {
  assert.equal(productSortPriority({ in_stock: true, fitting_position: "front axle" }), 0);
});

test("productSortPriority: in-stock without fitting position ranks second (1)", () => {
  assert.equal(productSortPriority({ in_stock: true, fitting_position: null }), 1);
});

test("productSortPriority: out-of-stock with fitting position ranks third (2)", () => {
  assert.equal(productSortPriority({ in_stock: false, fitting_position: "front axle" }), 2);
});

test("productSortPriority: out-of-stock without fitting position ranks last (3)", () => {
  assert.equal(productSortPriority({ in_stock: false, fitting_position: null }), 3);
});

test("productSortPriority: sorting a mixed list produces the correct tier order", () => {
  const products = [
    { name: "d", in_stock: false, fitting_position: null },
    { name: "a", in_stock: true, fitting_position: "front axle" },
    { name: "c", in_stock: false, fitting_position: "rear axle" },
    { name: "b", in_stock: true, fitting_position: null },
  ];
  products.sort((x, y) => productSortPriority(x) - productSortPriority(y));
  assert.deepEqual(products.map((p) => p.name), ["a", "b", "c", "d"]);
});

test("productSortPriority: stable sort preserves original relative order within a tier", () => {
  const products = [
    { name: "first", in_stock: true, fitting_position: null },
    { name: "second", in_stock: true, fitting_position: null },
    { name: "third", in_stock: true, fitting_position: null },
  ];
  products.sort((x, y) => productSortPriority(x) - productSortPriority(y));
  assert.deepEqual(products.map((p) => p.name), ["first", "second", "third"]);
});
