import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTEXT_MENU_ID,
  getContextMenuDefinition,
  getUiWindowOptions
} from "../src/background-logic.js";

test("context menu is available in every context with the requested title", () => {
  assert.deepEqual(getContextMenuDefinition(), {
    id: CONTEXT_MENU_ID,
    title: "quickspeak",
    contexts: ["all"]
  });
});

test("UI opens as a focused popup window", () => {
  assert.deepEqual(getUiWindowOptions("chrome-extension://test/ui.html"), {
    url: "chrome-extension://test/ui.html",
    type: "popup",
    width: 560,
    height: 720,
    focused: true
  });
});
