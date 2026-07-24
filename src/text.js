export function appendTranscript(existingText, newText) {
  const next = String(newText ?? "").trim();
  if (!next) {
    return String(existingText ?? "");
  }

  const existing = String(existingText ?? "").trimEnd();
  return existing ? `${existing}\n\n${next}` : next;
}
