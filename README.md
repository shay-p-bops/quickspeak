# Quickspeak

Quickspeak is a Chromium browser extension that turns microphone audio into editable text using local Whisper inference.

## Phase 1 features

- Adds a **quickspeak** item to the browser context menu on web pages and browser-viewed local files.
- Opens a dedicated Quickspeak window from the context menu or extension toolbar button.
- Records microphone audio with a clear start/stop control and elapsed timer.
- Transcribes speech on-device with Whisper through Transformers.js.
- Loads the speech model only after recording starts. The first download is cached by the browser, and later sessions load the cached files without downloading them again.
- Keeps the transcript editable and appends later recordings without replacing manual corrections.
- Includes a persisted **Literal mode** toggle. It is enabled by default and keeps punctuation words exactly as spoken. Turn it off to convert phrases such as “comma,” “question mark,” “new line,” brackets, and common symbols.
- Copies the complete editor contents with one **Copy all** button.

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

## Dictation modes

**Literal mode** is on by default. Quickspeak preserves phrases such as “question mark” or “new line” as ordinary words. The toggle choice is remembered when the Quickspeak window is reopened.

Turn Literal mode off to interpret spoken punctuation and symbols. Supported phrases include punctuation, new line/new paragraph, tabs, brackets, braces, parentheses, slash, dash, hash, dollar, percent, underscore, plus, equals, and common aliases.

## Speech model caching

Opening Quickspeak does not create the transcription worker or load the model. Model loading starts only after the user begins recording, and it runs in parallel with the recording.

The first transcription downloads the quantized `onnx-community/whisper-tiny.en` model. Transformers.js stores the model files in the browser Cache API. Later Quickspeak windows reinitialize the in-memory model from those cached files rather than downloading the model again. Browser storage cleanup or manually clearing site data can remove the cache and require another download.

## Commands

```bash
npm run build   # production extension bundle
npm run dev     # rebuild on source changes
npm test        # unit tests for audio, text, model loading, and extension configuration logic
```

## Architecture

- `src/background.js` registers the context menu and opens/focuses the extension window.
- `src/ui.js` handles recording, dictation mode persistence, editing, copy behavior, and UI state.
- `src/model-worker.js` creates the transcription worker lazily and prevents duplicate load requests.
- `src/transcription-worker.js` loads Whisper and runs transcription away from the UI thread.
- `src/audio.js` decodes, mixes, and resamples captured audio to 16 kHz mono.
- `src/text.js` appends transcripts and applies optional spoken punctuation formatting.

## Privacy

Recorded audio is sent only to the local transcription worker. Quickspeak does not include a backend, analytics, page injection, or remote JavaScript. ONNX Runtime's executable JavaScript and WebAssembly assets are bundled with the extension. The model files are downloaded from Hugging Face on first use and then cached locally by the browser.
