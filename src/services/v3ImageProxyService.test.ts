import { test } from "node:test";
import assert from "node:assert/strict";

// Env vars must be set before the module under test is imported (its base URL
// and allowlist are read once at module load time), hence the dynamic import.
process.env.PUBLIC_API_BASE_URL = "https://zagsdev.nl";
process.env.IMAGE_PROXY_ALLOWED_DOMAINS = "";

const { cleanImageUrl, cleanImagesDeep } = await import("./v3ImageProxyService.js");

const PROXY_PREFIX = "https://zagsdev.nl/v3/images/proxy?url=";

test("cleanImageUrl wraps a normal external image URL from an allowlisted domain", () => {
  const original = "https://de.zoekonderdeel.nl/assets/modules/mod_ecommerce/prod_images/380480/foo.webp";
  const result = cleanImageUrl(original);
  assert.equal(result, `${PROXY_PREFIX}${encodeURIComponent(original)}`);
});

test("cleanImageUrl leaves a disallowed domain untouched", () => {
  const original = "https://evil.example.com/steal.jpg";
  assert.equal(cleanImageUrl(original), original);
});

test("cleanImageUrl leaves a non-image (relative) URL untouched", () => {
  const original = "/local/relative/path.png";
  assert.equal(cleanImageUrl(original), original);
});

test("cleanImageUrl leaves a null value unchanged", () => {
  assert.equal(cleanImageUrl(null), null);
});

test("cleanImageUrl leaves undefined unchanged", () => {
  assert.equal(cleanImageUrl(undefined), undefined);
});

test("cleanImageUrl leaves an empty string unchanged", () => {
  assert.equal(cleanImageUrl(""), "");
});

test("cleanImageUrl leaves a data: URL unchanged", () => {
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA";
  assert.equal(cleanImageUrl(dataUrl), dataUrl);
});

test("cleanImageUrl does not double-proxy an already-proxied URL", () => {
  const already = `${PROXY_PREFIX}${encodeURIComponent("https://zoekonderdeel.nl/x.png")}`;
  assert.equal(cleanImageUrl(already), already);
});

test("cleanImagesDeep transforms a single image field on a flat object", () => {
  const input = { id: 1, image: "https://zoekonderdeel.nl/logo.png" };
  const output = cleanImagesDeep(input) as typeof input;
  assert.equal(output.image, `${PROXY_PREFIX}${encodeURIComponent("https://zoekonderdeel.nl/logo.png")}`);
  assert.equal(output.id, 1);
});

test("cleanImagesDeep transforms an array of image URL strings", () => {
  const input = {
    thumbnails: "ignored-not-a-recognised-key",
    images: [
      "https://zoekonderdeel.nl/a.jpg",
      "https://zoekonderdeel.nl/b.jpg",
    ],
  };
  const output = cleanImagesDeep(input) as typeof input;
  assert.deepEqual(output.images, [
    `${PROXY_PREFIX}${encodeURIComponent("https://zoekonderdeel.nl/a.jpg")}`,
    `${PROXY_PREFIX}${encodeURIComponent("https://zoekonderdeel.nl/b.jpg")}`,
  ]);
});

test("cleanImagesDeep transforms nested product data (array of image objects, brand.logo, filter icons)", () => {
  const product = {
    product_id: 380480,
    seo_url: "https://porza.nl/brake-disc", // NOT a recognised field — must stay untouched
    brand: { id: 958, name: "MEYLE", logo: "https://zoekonderdeel.nl/brand/958.png" },
    image: "https://de.zoekonderdeel.nl/thumb.webp",
    images: [
      { id: 1, url: "https://de.zoekonderdeel.nl/full.webp", url_thumb: "https://de.zoekonderdeel.nl/thumb.webp" },
    ],
    favourite: false,
  };
  const response = { success: true, products: [product] };

  const output = cleanImagesDeep(response) as typeof response;
  const outProduct = output.products[0];

  assert.equal(outProduct.seo_url, product.seo_url, "non-image field must be untouched");
  assert.equal(outProduct.brand.logo, `${PROXY_PREFIX}${encodeURIComponent(product.brand.logo)}`);
  assert.equal(outProduct.image, `${PROXY_PREFIX}${encodeURIComponent(product.image)}`);
  assert.equal(outProduct.images[0].url, `${PROXY_PREFIX}${encodeURIComponent(product.images[0].url)}`);
  assert.equal(outProduct.images[0].url_thumb, `${PROXY_PREFIX}${encodeURIComponent(product.images[0].url_thumb)}`);
  assert.equal(outProduct.favourite, false, "non-string, non-image values pass through unchanged");
});

test("cleanImagesDeep leaves a null image field unchanged inside an object", () => {
  const input = { id: 1, image: null };
  const output = cleanImagesDeep(input) as typeof input;
  assert.equal(output.image, null);
});

test("cleanImagesDeep leaves a data: URL unchanged even under a recognised key", () => {
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA";
  const input = { logo: dataUrl };
  const output = cleanImagesDeep(input) as typeof input;
  assert.equal(output.logo, dataUrl);
});

test("cleanImagesDeep leaves a Date object unchanged instead of collapsing it to {}", () => {
  const createdAt = new Date("2026-08-02T13:08:45.369Z");
  const input = { id: 1, created_at: createdAt };
  const output = cleanImagesDeep(input) as typeof input;
  assert.ok(output.created_at instanceof Date, "created_at must still be a Date instance");
  assert.equal(output.created_at.toISOString(), "2026-08-02T13:08:45.369Z");
  assert.equal(JSON.stringify(output.created_at), '"2026-08-02T13:08:45.369Z"');
});
