# Quickspeak

Quickspeak is a Chromium browser extension that turns microphone audio into editable text using local Whisper inference and can send user-authored prompts to a configured LLM.

## Features

- Adds a **quickspeak** item to the browser context menu on web pages and browser-viewed local files.
- Opens a dedicated Quickspeak window from the context menu or extension toolbar button.
- Provides separate **Dictation** and **LLM** tabs.
- Records microphone audio with a clear start/stop control and elapsed timer.
- Transcribes speech on-device with Whisper through Transformers.js.
- Loads the speech model only after recording starts. The first download is cached by the browser, and later sessions load the cached files without downloading them again.
- Keeps the transcript editable and appends later recordings without replacing manual corrections.
- Includes a persisted **Literal mode** toggle. It is enabled by default and keeps punctuation words exactly as spoken. Turn it off to convert phrases such as “comma,” “question mark,” “new line,” brackets, and common symbols.
- Adds one-click **Clear** and **Copy all** actions to transcript, prompt, and response text areas.
- Gives immediate press feedback on every button and success feedback for copy, clear, save, and send actions.
- Supports OpenAI as the first LLM vendor, with `gpt-5.5` as the default editable model name.
- Keeps the API key only in the open Quickspeak window. It is never written to extension storage, IndexedDB, or local storage.

No page content is read, injected, or modified. The extension only opens its own UI.

## Development

Requirements:

- Node.js 20 or newer
- npm
- Chrome, Edge, or another Chromium browser with Manifest V3 support

Install dependencies and build:

```bash
npm install
npm run build
```

Load the extension:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the generated `build` directory.

Right-click anywhere in a page and select **quickspeak**. Chrome's context menu API also exposes the item on `file://` documents; no page-access permission is required.

## Dictation mode

**Literal mode** is on by default. Quickspeak preserves phrases such as “question mark” or “new line” as ordinary words. The toggle choice is remembered when the Quickspeak window is reopened.

Turn Literal mode off to interpret spoken punctuation and symbols. Supported phrases include punctuation, new line/new paragraph, tabs, brackets, braces, parentheses, slash, dash, hash, dollar, percent, underscore, plus, equals, and common aliases.

## LLM mode

Open the **LLM** tab, choose the vendor, enter a model name, and paste an API key. Vendor and model preferences can be saved, but the API key is session-only and remains in the password field only while that Quickspeak window is open.

Prompts are sent only after **Send to LLM** is pressed. The API key is passed to the background service worker with that explicit request and is not persisted. Closing Quickspeak discards the field value, so the user must enter the key again the next time the extension window opens. Leaving LLM mode or closing the window cancels an active request.

The first vendor implementation calls the OpenAI Responses API directly from the extension. Use a dedicated, restricted key and monitor its usage. A backend proxy is recommended for shared or production deployments.

## Speech model caching

Opening Quickspeak does not create the transcription worker or load the model. Model loading starts only after the user begins recording, and it runs in parallel with the recording.

The first transcription downloads the quantized `onnx-community/whisper-tiny.en` model. Transformers.js stores the model files in the browser Cache API. Later Quickspeak windows reinitialize the in-memory model from those cached files rather than downloading the model again. Browser storage cleanup or manually clearing site data can remove the cache and require another download.

## Commands

```bash
npm run build   # production extension bundle
npm run dev     # rebuild on source changes
npm test        # unit tests for audio, text, model loading, LLM helpers, and extension configuration
```

## Architecture

- `src/background.js` registers the context menu, opens/focuses the extension window, stores non-secret LLM settings, performs explicit vendor calls, and cancels active requests.
- `src/ui.js` handles tabs, recording, dictation mode persistence, editing, session-only API-key input, LLM controls, copy/clear behavior, and button feedback.
- `src/llm.js` validates LLM settings, builds OpenAI requests, and parses Responses API output.
- `src/model-worker.js` creates the transcription worker lazily and prevents duplicate load requests.
- `src/transcription-worker.js` loads Whisper and runs transcription away from the UI thread.
- `src/audio.js` decodes, mixes, and resamples captured audio to 16 kHz mono.
- `src/text.js` appends transcripts and applies optional spoken punctuation formatting.

## Privacy

Recorded audio is sent only to the local transcription worker. LLM prompt text and the session API key are sent only when the user explicitly presses **Send to LLM**, and only to the selected vendor. The API key is not stored by Quickspeak. Quickspeak does not include analytics, page injection, or remote JavaScript. ONNX Runtime's executable JavaScript and WebAssembly assets are bundled with the extension. The model files are downloaded from Hugging Face on first use and then cached locally by the browser.
