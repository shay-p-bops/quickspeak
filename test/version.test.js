import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
);
const manifest = JSON.parse(
  readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8")
);
const uiHtml = readFileSync(new URL("../src/ui.html", import.meta.url), "utf8");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("version is synchronized across package, manifest, and title bar", () => {
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, packageJson.version);
  assert.match(
    uiHtml,
    new RegExp(`<title>Quickspeak v${escapeRegExp(packageJson.version)}</title>`)
  );
});
