import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenAIRequest,
  DEFAULT_LLM_SETTINGS,
  extractOpenAIText,
  normalizeLlmSettings,
  requestLlm
} from "../src/llm.js";

test("LLM settings default to OpenAI and gpt-5.5", () => {
  assert.deepEqual(normalizeLlmSettings(), DEFAULT_LLM_SETTINGS);
  assert.deepEqual(normalizeLlmSettings({ vendor: "unknown", model: "" }), DEFAULT_LLM_SETTINGS);
});

test("OpenAI request uses the Responses API and bearer authentication", () => {
  const signal = new AbortController().signal;
  const { url, options } = buildOpenAIRequest({
    apiKey: "sk-test",
    model: "gpt-5.5",
    input: "Hello",
    signal
  });

  assert.equal(url, "https://api.openai.com/v1/responses");
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Authorization, "Bearer sk-test");
  assert.equal(options.signal, signal);
  assert.deepEqual(JSON.parse(options.body), {
    model: "gpt-5.5",
    input: "Hello"
  });
});

test("OpenAI output parser supports output_text and structured output", () => {
  assert.equal(extractOpenAIText({ output_text: " Direct answer " }), "Direct answer");
  assert.equal(
    extractOpenAIText({
      output: [
        { content: [{ text: "First" }, { text: { value: "Second" } }] }
      ]
    }),
    "First\n\nSecond"
  );
});

test("requestLlm returns text and does not expose the key in errors", async () => {
  const calls = [];
  const text = await requestLlm({
    vendor: "openai",
    apiKey: "sk-secret",
    model: "gpt-5.5",
    input: "Hello",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { output_text: "Hi there" };
        }
      };
    }
  });

  assert.equal(text, "Hi there");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, "Bearer sk-secret");
});

test("requestLlm surfaces vendor errors", async () => {
  await assert.rejects(
    requestLlm({
      vendor: "openai",
      apiKey: "sk-secret",
      model: "gpt-5.5",
      input: "Hello",
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        async json() {
          return { error: { message: "Invalid API key" } };
        }
      })
    }),
    /Invalid API key/
  );
});
