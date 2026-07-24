import { decodeRecording, WHISPER_SAMPLE_RATE } from "./audio.js";
import {
  getModelLoadingStatus,
  LazyModelWorker,
  MODEL_CACHE_MARKER_KEY,
  parseModelCacheMarker
} from "./model-worker.js";
import {
  appendTranscript,
  formatDictationText,
  LITERAL_MODE_STORAGE_KEY,
  parseLiteralModePreference
} from "./text.js";

const recordButton = document.querySelector("#record-button");
const recordLabel = document.querySelector("#record-label");
const copyButton = document.querySelector("#copy-button");
const transcript = document.querySelector("#transcript");
const statusText = document.querySelector("#status-text");
const statusIndicator = document.querySelector("#status-indicator");
const timer = document.querySelector("#timer");
const progressTrack = document.querySelector("#progress-track");
const progressBar = document.querySelector("#progress-bar");
const characterCount = document.querySelector("#character-count");
const literalModeToggle = document.querySelector("#literal-mode-toggle");
const literalModeDescription = document.querySelector("#literal-mode-description");

const pendingRequests = new Map();
const modelWorker = new LazyModelWorker(() => {
  const worker = new Worker(chrome.runtime.getURL("transcription-worker.js"), {
    type: "module"
  });
  worker.addEventListener("message", handleWorkerMessage);
  return worker;
});

let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let recordingStartedAt = 0;
let timerInterval = null;
let mode = "idle";
let modelReady = false;
let modelCacheKnown = restoreModelCacheMarker();
let literalModeForRecording = true;

function setStatus(message, state = "neutral") {
  statusText.textContent = message;
  statusIndicator.className = "status-indicator";
  if (state !== "neutral") {
    statusIndicator.classList.add(state);
  }
}

function setMode(nextMode) {
  mode = nextMode;
  const recording = nextMode === "recording";
  const processing = nextMode === "processing";

  recordButton.classList.toggle("recording", recording);
  recordButton.setAttribute("aria-pressed", String(recording));
  recordLabel.textContent = recording ? "Stop recording" : "Record";
  recordButton.disabled = processing;
  literalModeToggle.disabled = recording || processing;
  timer.hidden = !recording;
}

function updateCharacterCount() {
  const count = transcript.value.length;
  characterCount.textContent = `${count.toLocaleString()} ${count === 1 ? "character" : "characters"}`;
  copyButton.disabled = count === 0;
}

function updateTimer() {
  const elapsedSeconds = Math.floor((Date.now() - recordingStartedAt) / 1000);
  const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
  const seconds = String(elapsedSeconds % 60).padStart(2, "0");
  timer.textContent = `${minutes}:${seconds}`;
}

function restoreLiteralModePreference() {
  try {
    return parseLiteralModePreference(window.localStorage.getItem(LITERAL_MODE_STORAGE_KEY));
  } catch {
    return true;
  }
}

function saveLiteralModePreference(enabled) {
  try {
    window.localStorage.setItem(LITERAL_MODE_STORAGE_KEY, String(enabled));
  } catch {
    // Extension storage can be unavailable in unusual private browsing setups.
  }
}

function restoreModelCacheMarker() {
  try {
    return parseModelCacheMarker(window.localStorage.getItem(MODEL_CACHE_MARKER_KEY));
  } catch {
    return false;
  }
}

function saveModelCacheMarker() {
  try {
    window.localStorage.setItem(MODEL_CACHE_MARKER_KEY, "true");
  } catch {
    // This marker only improves status messaging; Transformers.js owns the real cache.
  }
}

function updateLiteralModeDescription() {
  literalModeDescription.textContent = literalModeToggle.checked
    ? "Punctuation words stay exactly as spoken."
    : "Spoken punctuation and symbols are converted into characters.";
}

function findSupportedMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus"
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function stopTracks() {
  for (const track of mediaStream?.getTracks() ?? []) {
    track.stop();
  }
  mediaStream = null;
}

function beginModelLoading() {
  modelWorker.load();
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setStatus("Microphone recording is not supported in this browser.", "error");
    return;
  }

  literalModeForRecording = literalModeToggle.checked;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    const mimeType = findSupportedMimeType();
    mediaRecorder = new MediaRecorder(
      mediaStream,
      mimeType ? { mimeType } : undefined
    );
    audioChunks = [];

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("stop", () => {
      void processRecording(mimeType || mediaRecorder?.mimeType || "audio/webm");
    }, { once: true });

    mediaRecorder.start(250);
    recordingStartedAt = Date.now();
    updateTimer();
    timerInterval = window.setInterval(updateTimer, 250);
    setMode("recording");
    setStatus("Listening… press Stop recording when finished.", "recording");
    beginModelLoading();
  } catch (error) {
    stopTracks();
    const denied = error instanceof DOMException && error.name === "NotAllowedError";
    setStatus(
      denied
        ? "Microphone access was blocked. Allow it for Quickspeak and try again."
        : `Could not start recording: ${error instanceof Error ? error.message : String(error)}`,
      "error"
    );
    setMode("idle");
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    return;
  }

  window.clearInterval(timerInterval);
  timerInterval = null;
  mediaRecorder.stop();
  stopTracks();
  setMode("processing");
  setStatus("Preparing audio for transcription…");
}

function requestTranscription(audio) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    modelWorker.transcribe(
      { type: "transcribe", requestId, audio },
      [audio.buffer]
    );
  });
}

async function processRecording(mimeType) {
  try {
    const blob = new Blob(audioChunks, { type: mimeType });
    audioChunks = [];
    if (blob.size === 0) {
      throw new Error("No audio was captured.");
    }

    const audio = await decodeRecording(blob);
    if (audio.length < WHISPER_SAMPLE_RATE / 4) {
      throw new Error("The recording was too short. Try speaking for a little longer.");
    }

    setStatus(modelReady ? "Transcribing locally…" : getModelLoadingStatus({ cached: modelCacheKnown }));
    const rawText = await requestTranscription(audio);
    const text = formatDictationText(rawText, literalModeForRecording);
    transcript.value = appendTranscript(transcript.value, text);
    updateCharacterCount();

    if (text) {
      setStatus("Transcription ready. Review it or copy the full text.", "ready");
      transcript.focus();
      transcript.setSelectionRange(transcript.value.length, transcript.value.length);
    } else {
      setStatus("No speech was detected. Try recording again.", "error");
    }
  } catch (error) {
    setStatus(
      `Transcription failed: ${error instanceof Error ? error.message : String(error)}`,
      "error"
    );
  } finally {
    mediaRecorder = null;
    setMode("idle");
  }
}

recordButton.addEventListener("click", () => {
  if (mode === "recording") {
    stopRecording();
  } else if (mode !== "processing") {
    void startRecording();
  }
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(transcript.value);
    setStatus("Copied the full transcript.", "ready");
  } catch (error) {
    setStatus(
      `Could not copy: ${error instanceof Error ? error.message : String(error)}`,
      "error"
    );
  }
});

literalModeToggle.addEventListener("change", () => {
  saveLiteralModePreference(literalModeToggle.checked);
  updateLiteralModeDescription();
});

transcript.addEventListener("input", updateCharacterCount);

function handleWorkerMessage(event) {
  const message = event.data;

  if (message?.type === "model-loading") {
    progressTrack.hidden = false;
    setStatus(
      getModelLoadingStatus({
        cached: modelCacheKnown,
        recording: mode === "recording"
      }),
      mode === "recording" ? "recording" : "neutral"
    );
    return;
  }

  if (message?.type === "model-progress") {
    progressTrack.hidden = false;
    progressBar.style.width = `${message.progress}%`;
    setStatus(
      getModelLoadingStatus({
        cached: modelCacheKnown,
        progress: message.progress,
        recording: mode === "recording"
      }),
      mode === "recording" ? "recording" : "neutral"
    );
    return;
  }

  if (message?.type === "model-ready") {
    modelReady = true;
    modelCacheKnown = true;
    saveModelCacheMarker();
    progressBar.style.width = "100%";
    window.setTimeout(() => {
      progressTrack.hidden = true;
      progressBar.style.width = "0";
    }, 350);

    if (mode === "recording") {
      setStatus("Listening… cached speech model is ready.", "recording");
    } else if (mode === "processing") {
      setStatus("Transcribing locally…");
    } else {
      setStatus("Ready to record. Speech model is cached locally.", "ready");
    }
    return;
  }

  if (message?.type === "transcript") {
    const pending = pendingRequests.get(message.requestId);
    pendingRequests.delete(message.requestId);
    pending?.resolve(message.text);
    return;
  }

  if (message?.type === "error") {
    if (message.requestId) {
      const pending = pendingRequests.get(message.requestId);
      pendingRequests.delete(message.requestId);
      pending?.reject(new Error(message.message));
      return;
    }

    modelReady = false;
    setStatus(
      "The speech model could not be loaded. Check your connection for the first download and try recording again.",
      "error"
    );
  }
}

window.addEventListener("beforeunload", () => {
  window.clearInterval(timerInterval);
  stopTracks();
  modelWorker.terminate();
});

literalModeToggle.checked = restoreLiteralModePreference();
updateLiteralModeDescription();
updateCharacterCount();
setMode("idle");
setStatus(
  modelCacheKnown
    ? "Ready to record. The cached speech model will load when needed."
    : "Ready to record. The speech model will download only when first needed.",
  "ready"
);
