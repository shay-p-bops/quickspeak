import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const uiHtml = readFileSync(new URL("../src/ui.html", import.meta.url), "utf8");
const uiJs = readFileSync(new URL("../src/ui.js", import.meta.url), "utf8");
const manifest = JSON.parse(
  readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8")
);

test("UI contains separate Dictation and LLM tab panels", () => {
  assert.match(uiHtml, /id="dictation-tab"/);
  assert.match(uiHtml, /id="llm-tab"/);
  assert.match(uiHtml, /id="dictation-panel"/);
  assert.match(uiHtml, /id="llm-panel"/);
});

test("all text areas have clear and copy controls", () => {
  for (const id of [
    "clear-transcript-button",
    "copy-button",
    "clear-prompt-button",
    "copy-prompt-button",
    "clear-response-button",
    "copy-response-button"
  ]) {
    assert.match(uiHtml, new RegExp(`id="${id}"`));
  }
});

test("button feedback and cancellation handlers are wired", () => {
  assert.match(uiJs, /button-pressed/);
  assert.match(uiJs, /flashButtonFeedback/);
  assert.match(uiJs, /llm:cancel/);
});

test("manifest grants storage and OpenAI host access", () => {
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.host_permissions.includes("https://api.openai.com/*"));
});
