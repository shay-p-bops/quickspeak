import test from "node:test";
import assert from "node:assert/strict";
import { appendTranscript } from "../src/text.js";

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
