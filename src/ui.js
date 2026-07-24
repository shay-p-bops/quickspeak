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
import { DEFAULT_LLM_SETTINGS, normalizeLlmSettings } from "./llm.js";

const recordButton = document.querySelector("#record-button");
const recordLabel = document.querySelector("#record-label");
const copyButton = document.querySelector("#copy-button");
const clearTranscriptButton = document.querySelector("#clear-transcript-button");
const transcript = document.querySelector("#transcript");
const statusText = document.querySelector("#status-text");
const statusIndicator = document.querySelector("#status-indicator");
const timer = document.querySelector("#timer");
const progressTrack = document.querySelector("#progress-track");
const progressBar = document.querySelector("#progress-bar");
const characterCount = document.querySelector("#character-count");
const literalModeToggle = document.querySelector("#literal-mode-toggle");
const literalModeDescription = document.querySelector("#literal-mode-description");
const dictationTab = document.querySelector("#dictation-tab");
const llmTab = document.querySelector("#llm-tab");
const dictationPanel = document.querySelector("#dictation-panel");
const llmPanel = document.querySelector("#llm-panel");
const llmVendor = document.querySelector("#llm-vendor");
const llmModel = document.querySelector("#llm-model");
const llmApiKey = document.querySelector("#llm-api-key");
const saveLlmSettingsButton = document.querySelector("#save-llm-settings-button");
const llmPrompt = document.querySelector("#llm-prompt");
const llmResponse = document.querySelector("#llm-response");
const sendLlmButton = document.querySelector("#send-llm-button");
const copyPromptButton = document.querySelector("#copy-prompt-button");
const clearPromptButton = document.querySelector("#clear-prompt-button");
const copyResponseButton = document.querySelector("#copy-response-button");
const clearResponseButton = document.querySelector("#clear-response-button");
const responseState = document.querySelector("#response-state");
const actionAnnouncer = document.querySelector("#action-announcer");

const pendingRequests = new Map();
const feedbackTimers = new WeakMap();
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
let activeTab = "dictation";
let modelReady = false;
let modelCacheKnown = restoreModelCacheMarker();
let literalModeForRecording = true;
let llmSettingsLoaded = false;
let activeLlmRequestId = null;

function setStatus(message, state = "neutral") {
  statusText.textContent = message;
  statusIndicator.className = "status-indicator";
  if (state !== "neutral") {
    statusIndicator.classList.add(state);
  }
}

function announce(message) {
  actionAnnouncer.textContent = "";
  window.requestAnimationFrame(() => {
    actionAnnouncer.textContent = message;
  });
}

function getButtonLabel(button) {
  return button.querySelector("[data-button-label]");
}

function restoreButtonLabel(button) {
  const label = getButtonLabel(button);
  if (label?.dataset.defaultLabel) {
    label.textContent = label.dataset.defaultLabel;
  }
}

function flashButtonFeedback(button, message, duration = 1200) {
  const label = getButtonLabel(button);
  if (label && !label.dataset.defaultLabel) {
    label.dataset.defaultLabel = label.textContent;
  }

  window.clearTimeout(feedbackTimers.get(button));
  if (label) {
    label.textContent = message;
  }
  button.classList.add("feedback-success");
  announce(message);

  feedbackTimers.set(button, window.setTimeout(() => {
    restoreButtonLabel(button);
    button.classList.remove("feedback-success");
    feedbackTimers.delete(button);
  }, duration));
}

function setButtonBusy(button, busy, busyLabel) {
  const label = getButtonLabel(button);
  if (label && !label.dataset.defaultLabel) {
    label.dataset.defaultLabel = label.textContent;
  }
  if (label) {
    label.textContent = busy ? busyLabel : label.dataset.defaultLabel;
  }
  button.setAttribute("aria-busy", String(busy));
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "The extension background worker did not return a result."));
        return;
      }
      resolve(response);
    });
  });
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
  llmTab.disabled = recording || processing;
  timer.hidden = !recording;
}

function updateCharacterCount() {
  const count = transcript.value.length;
  characterCount.textContent = `${count.toLocaleString()} ${count === 1 ? "character" : "characters"}`;
  copyButton.disabled = count === 0;
  clearTranscriptButton.disabled = count === 0;
}

function updateLlmActionState() {
  const hasPrompt = llmPrompt.value.trim().length > 0;
  const hasResponse = llmResponse.value.length > 0;
  const hasModel = llmModel.value.trim().length > 0;
  const hasApiKey = llmApiKey.value.trim().length > 0;
  const requesting = activeLlmRequestId !== null;

  copyPromptButton.disabled = !hasPrompt;
  clearPromptButton.disabled = !hasPrompt;
  copyResponseButton.disabled = !hasResponse;
  clearResponseButton.disabled = !hasResponse;
  sendLlmButton.disabled = !hasPrompt || !hasModel || !hasApiKey || requesting;
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

async function copyTextarea(button, textarea, successMessage) {
  if (!textarea.value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(textarea.value);
    flashButtonFeedback(button, "Copied");
    setStatus(successMessage, "ready");
  } catch (error) {
    setStatus(
      `Could not copy: ${error instanceof Error ? error.message : String(error)}`,
      "error"
    );
  }
}

function clearTextarea(button, textarea, successMessage) {
  if (!textarea.value) {
    return;
  }
  textarea.value = "";
  textarea.focus();
  flashButtonFeedback(button, "Cleared");
  setStatus(successMessage, "ready");
  updateCharacterCount();
  updateLlmActionState();
  if (textarea === llmResponse) {
    responseState.textContent = "No response yet";
  }
}

async function loadLlmSettings() {
  if (llmSettingsLoaded) {
    return;
  }

  const response = await sendRuntimeMessage({ type: "llm:get-settings" });
  const settings = normalizeLlmSettings(response.settings);
  llmVendor.value = settings.vendor;
  llmModel.value = settings.model;
  llmSettingsLoaded = true;
  updateLlmActionState();
}

async function saveCurrentLlmSettings({ showFeedback = true, updateStatus = true } = {}) {
  const settings = normalizeLlmSettings({
    vendor: llmVendor.value,
    model: llmModel.value
  });
  llmModel.value = settings.model;

  const response = await sendRuntimeMessage({
    type: "llm:save-settings",
    settings
  });
  const savedSettings = normalizeLlmSettings(response.settings);
  llmVendor.value = savedSettings.vendor;
  llmModel.value = savedSettings.model;
  updateLlmActionState();

  if (showFeedback) {
    flashButtonFeedback(saveLlmSettingsButton, "Saved");
  }
  if (updateStatus) {
    setStatus("Vendor and model settings saved. The API key remains only in this window.", "ready");
  }
}

function cancelActiveLlmRequest() {
  if (!activeLlmRequestId) {
    return;
  }
  const requestId = activeLlmRequestId;
  activeLlmRequestId = null;
  void sendRuntimeMessage({ type: "llm:cancel", requestId }).catch(() => undefined);
  setButtonBusy(sendLlmButton, false, "Sending…");
  updateLlmActionState();
}

async function sendLlmRequest() {
  const prompt = llmPrompt.value.trim();
  const apiKey = llmApiKey.value.trim();
  if (!prompt || activeLlmRequestId) {
    return;
  }
  if (!apiKey) {
    setStatus("Paste an API key before sending a request.", "error");
    llmApiKey.focus();
    return;
  }

  let completed = false;
  try {
    const settings = normalizeLlmSettings({
      vendor: llmVendor.value,
      model: llmModel.value
    });
    llmModel.value = settings.model;

    const requestId = crypto.randomUUID();
    activeLlmRequestId = requestId;
    setButtonBusy(sendLlmButton, true, "Sending…");
    updateLlmActionState();
    responseState.textContent = "Waiting for the model…";
    setStatus(`Sending to ${llmVendor.options[llmVendor.selectedIndex].text} using ${settings.model}…`);

    const response = await sendRuntimeMessage({
      type: "llm:request",
      requestId,
      settings,
      input: prompt,
      apiKey: llmApiKey.value
    });

    llmResponse.value = response.text;
    responseState.textContent = "Response ready";
    setStatus("LLM response ready.", "ready");
    completed = true;
  } catch (error) {
    const cancelled = /cancelled/i.test(error.message);
    responseState.textContent = cancelled ? "Request cancelled" : "Request failed";
    if (activeTab === "llm") {
      setStatus(
        cancelled ? "The LLM request was cancelled." : `LLM request failed: ${error.message}`,
        cancelled ? "neutral" : "error"
      );
    }
  } finally {
    activeLlmRequestId = null;
    setButtonBusy(sendLlmButton, false, "Sending…");
    updateLlmActionState();
    if (completed) {
      flashButtonFeedback(sendLlmButton, "Sent");
    }
  }
}

async function selectTab(nextTab) {
  if (nextTab === activeTab || (nextTab === "llm" && mode !== "idle")) {
    return;
  }

  if (activeTab === "llm") {
    cancelActiveLlmRequest();
  }

  activeTab = nextTab;
  const llmActive = nextTab === "llm";
  dictationTab.classList.toggle("active", !llmActive);
  dictationTab.setAttribute("aria-selected", String(!llmActive));
  llmTab.classList.toggle("active", llmActive);
  llmTab.setAttribute("aria-selected", String(llmActive));
  dictationPanel.hidden = llmActive;
  llmPanel.hidden = !llmActive;

  if (llmActive) {
    try {
      await loadLlmSettings();
      setStatus(
        "LLM mode ready. Paste an API key for this window, then send an explicit request.",
        "ready"
      );
      llmPrompt.focus();
    } catch (error) {
      setStatus(`Could not load LLM settings: ${error.message}`, "error");
    }
  } else {
    setStatus(
      modelCacheKnown
        ? "Ready to record. The cached speech model will load when needed."
        : "Ready to record. The speech model will download only when first needed.",
      "ready"
    );
    recordButton.focus();
  }
}

recordButton.addEventListener("click", () => {
  if (mode === "recording") {
    stopRecording();
  } else if (mode !== "processing") {
    void startRecording();
  }
});

copyButton.addEventListener("click", () => {
  void copyTextarea(copyButton, transcript, "Copied the full transcript.");
});
clearTranscriptButton.addEventListener("click", () => {
  clearTextarea(clearTranscriptButton, transcript, "Transcript cleared.");
});

copyPromptButton.addEventListener("click", () => {
  void copyTextarea(copyPromptButton, llmPrompt, "Copied the full prompt.");
});
clearPromptButton.addEventListener("click", () => {
  clearTextarea(clearPromptButton, llmPrompt, "Prompt cleared.");
});
copyResponseButton.addEventListener("click", () => {
  void copyTextarea(copyResponseButton, llmResponse, "Copied the full LLM response.");
});
clearResponseButton.addEventListener("click", () => {
  clearTextarea(clearResponseButton, llmResponse, "LLM response cleared.");
});

saveLlmSettingsButton.addEventListener("click", () => {
  void saveCurrentLlmSettings().catch((error) => {
    setStatus(`Could not save LLM settings: ${error.message}`, "error");
  });
});
sendLlmButton.addEventListener("click", () => {
  void sendLlmRequest();
});

dictationTab.addEventListener("click", () => {
  void selectTab("dictation");
});
llmTab.addEventListener("click", () => {
  void selectTab("llm");
});

literalModeToggle.addEventListener("change", () => {
  saveLiteralModePreference(literalModeToggle.checked);
  updateLiteralModeDescription();
});

transcript.addEventListener("input", updateCharacterCount);
llmPrompt.addEventListener("input", updateLlmActionState);
llmResponse.addEventListener("input", updateLlmActionState);
llmModel.addEventListener("input", updateLlmActionState);
llmApiKey.addEventListener("input", updateLlmActionState);

// Every clickable button receives immediate visual press feedback, even when the
// action itself completes asynchronously.
document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || button.disabled) {
    return;
  }
  button.classList.remove("button-pressed");
  void button.offsetWidth;
  button.classList.add("button-pressed");
  window.setTimeout(() => button.classList.remove("button-pressed"), 180);
});

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
    } else if (activeTab === "dictation") {
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
  cancelActiveLlmRequest();
  llmApiKey.value = "";
  stopTracks();
  modelWorker.terminate();
});

literalModeToggle.checked = restoreLiteralModePreference();
llmVendor.value = DEFAULT_LLM_SETTINGS.vendor;
llmModel.value = DEFAULT_LLM_SETTINGS.model;
updateLiteralModeDescription();
updateCharacterCount();
updateLlmActionState();
setMode("idle");
setStatus(
  modelCacheKnown
    ? "Ready to record. The cached speech model will load when needed."
    : "Ready to record. The speech model will download only when first needed.",
  "ready"
);
