export const LLM_SETTINGS_STORAGE_KEY = "quickspeak.llm.settings.v1";
export const DEFAULT_LLM_SETTINGS = Object.freeze({
  vendor: "openai",
  model: "gpt-5.5"
});

export function normalizeLlmSettings(value = {}) {
  const vendor = value?.vendor === "openai" ? "openai" : DEFAULT_LLM_SETTINGS.vendor;
  const model = String(value?.model ?? "").trim() || DEFAULT_LLM_SETTINGS.model;
  return { vendor, model };
}

export function buildOpenAIRequest({ apiKey, model, input, signal } = {}) {
  const secret = String(apiKey ?? "").trim();
  const modelName = String(model ?? "").trim();
  const prompt = String(input ?? "").trim();

  if (!secret) {
    throw new Error("An OpenAI API key is required.");
  }
  if (!modelName) {
    throw new Error("A model name is required.");
  }
  if (!prompt) {
    throw new Error("A prompt is required.");
  }

  return {
    url: "https://api.openai.com/v1/responses",
    options: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelName,
        input: prompt
      }),
      signal
    }
  };
}

export function extractOpenAIText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const parts = [];
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      const text = typeof content?.text === "string"
        ? content.text
        : typeof content?.text?.value === "string"
          ? content.text.value
          : "";
      if (text.trim()) {
        parts.push(text.trim());
      }
    }
  }

  return parts.join("\n\n");
}

function getOpenAIError(payload, status) {
  const message = payload?.error?.message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }
  return `OpenAI request failed with status ${status}.`;
}

export async function requestLlm({
  fetchImpl = globalThis.fetch,
  vendor,
  apiKey,
  model,
  input,
  signal
} = {}) {
  if (vendor !== "openai") {
    throw new Error(`Unsupported LLM vendor: ${String(vendor ?? "")}`);
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch is not available in this environment.");
  }

  const { url, options } = buildOpenAIRequest({ apiKey, model, input, signal });
  const response = await fetchImpl(url, options);
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(getOpenAIError(payload, response.status));
  }

  const text = extractOpenAIText(payload);
  if (!text) {
    throw new Error("OpenAI returned no text output.");
  }
  return text;
}
