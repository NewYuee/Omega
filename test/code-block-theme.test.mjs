import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("code blocks use calm surfaces without inline-code backing", async () => {
  const [baseCss, productCss] = await Promise.all([
    readFile(new URL("../public/style.css", import.meta.url), "utf8"),
    readFile(new URL("../client/src/product.css", import.meta.url), "utf8"),
  ]);

  assert.match(baseCss, /\.code-block\{[^}]*background:#edf2ef/);
  assert.match(baseCss, /\.markdown-body pre code\{[^}]*background:transparent[^}]*color:inherit/);
  assert.match(productCss, /body\.omega-product \.code-block\{[^}]*background:#20241f/);
  assert.match(productCss, /body\.omega-product \.markdown-body pre code\{[^}]*background:transparent[^}]*color:inherit/);
});
