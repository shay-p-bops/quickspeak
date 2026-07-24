import test from "node:test";
import assert from "node:assert/strict";
import {
  appendTranscript,
  applySpokenDictationFormatting,
  formatDictationText,
  parseLiteralModePreference
} from "../src/text.js";

test("appendTranscript adds a new paragraph", () => {
  assert.equal(
    appendTranscript("First thought.", "Second thought."),
    "First thought.\n\nSecond thought."
  );
});

test("appendTranscript preserves existing text when the new transcript is empty", () => {
  assert.equal(appendTranscript("Edited text  ", "   "), "Edited text  ");
});

test("appendTranscript handles an empty editor", () => {
  assert.equal(appendTranscript("", "  Hello there. "), "Hello there.");
});

test("literal mode is enabled when no preference has been stored", () => {
  assert.equal(parseLiteralModePreference(null), true);
});

test("literal mode preference restores the saved choice", () => {
  assert.equal(parseLiteralModePreference("true"), true);
  assert.equal(parseLiteralModePreference("false"), false);
});

test("literal mode preserves punctuation words exactly as transcribed", () => {
  const spoken = "Hello comma world question mark.";
  assert.equal(formatDictationText(spoken, true), spoken);
});

test("punctuation mode converts spoken punctuation and removes Whisper cleanup periods", () => {
  assert.equal(
    formatDictationText("Hello comma world question mark.", false),
    "Hello, world?"
  );
});

test("punctuation mode converts spacing, brackets, and symbols", () => {
  assert.equal(
    applySpokenDictationFormatting(
      "open parenthesis test close parenthesis new line hash topic slash notes"
    ),
    "(test)\n#topic/notes"
  );
});

test("punctuation conversion only matches complete spoken phrases", () => {
  assert.equal(
    applySpokenDictationFormatting("A periodic update and a starred result."),
    "A periodic update and a starred result."
  );
});
