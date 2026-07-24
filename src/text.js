export const LITERAL_MODE_STORAGE_KEY = "quickspeak.literalMode";

const SPOKEN_DICTATION_REPLACEMENTS = [
  [["new paragraph"], "\n\n"],
  [["new line", "newline"], "\n"],
  [["question mark"], "?"],
  [["exclamation mark", "exclamation point"], "!"],
  [["semicolon"], ";"],
  [["colon"], ":"],
  [["full stop", "period"], "."],
  [["comma"], ","],
  [["tab"], "\t"],
  [["open parenthesis", "open parentheses", "open paren", "left parenthesis", "left paren"], "("],
  [["close parenthesis", "close parentheses", "close paren", "right parenthesis", "right paren"], ")"],
  [["open brace", "open curly brace", "left brace", "left curly brace"], "{"],
  [["close brace", "close curly brace", "right brace", "right curly brace"], "}"],
  [["open bracket", "open square bracket", "left bracket", "left square bracket"], "["],
  [["close bracket", "close square bracket", "right bracket", "right square bracket"], "]"],
  [["less than", "open angle bracket", "left angle bracket"], "<"],
  [["greater than", "close angle bracket", "right angle bracket"], ">"],
  [["apostrophe", "single quote"], "'"],
  [["slash", "forward slash"], "/"],
  [["underscore"], "_"],
  [["plus", "plus sign"], "+"],
  [["equals", "equal sign", "equals sign"], "="],
  [["asterisk", "star"], "*"],
  [["ampersand"], "&"],
  [["caret"], "^"],
  [["percent", "percent sign"], "%"],
  [["dollar", "dollar sign"], "$"],
  [["hash", "pound", "number sign"], "#"],
  [["dash", "hyphen", "minus"], "-"]
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const COMPILED_SPOKEN_DICTATION_REPLACEMENTS = SPOKEN_DICTATION_REPLACEMENTS.map(
  ([phrases, replacement]) => {
    const orderedPhrases = [...phrases].sort((left, right) => right.length - left.length);
    const alternatives = orderedPhrases.map(escapeRegExp).join("|");
    return [new RegExp(`(?<!\\w)(?:${alternatives})(?!\\w)`, "gi"), replacement];
  }
);

export function parseLiteralModePreference(storedValue) {
  return storedValue === null ? true : storedValue !== "false";
}

export function applySpokenDictationFormatting(text) {
  let formatted = String(text ?? "");

  for (const [pattern, replacement] of COMPILED_SPOKEN_DICTATION_REPLACEMENTS) {
    formatted = formatted.replace(pattern, () => replacement);
  }

  formatted = formatted.replace(/ *\t */g, "\t");
  formatted = formatted.replace(/ *\n */g, "\n");
  formatted = formatted.replace(/\n{3,}/g, "\n\n");
  formatted = formatted.replace(/[ ]+([,.;:?!)}\]])/g, "$1");
  formatted = formatted.replace(/([({\[]) +/g, "$1");
  formatted = formatted.replace(/[ ]*([/%^&*'_+=<>-])[ ]*/g, "$1");
  formatted = formatted.replace(/([#$])[ ]+/g, "$1");
  formatted = formatted.replace(/ {2,}/g, " ");
  formatted = formatted.replace(/([?!,:;#$%^&*(){}\[\]'<>/\-_=+])\./g, "$1");
  return formatted.replace(/^ +| +$/g, "");
}

export function formatDictationText(text, literalMode = true) {
  const value = String(text ?? "");
  return literalMode ? value : applySpokenDictationFormatting(value);
}

export function appendTranscript(existingText, newText) {
  const next = String(newText ?? "").trim();
  if (!next) {
    return String(existingText ?? "");
  }

  const existing = String(existingText ?? "").trimEnd();
  return existing ? `${existing}\n\n${next}` : next;
}
