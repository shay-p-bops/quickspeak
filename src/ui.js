import { decodeRecording, WHISPER_SAMPLE_RATE } from "./audio.js";
import { appendTranscript } from "./text.js";

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

const worker = new Worker(chrome.runtime.getURL("transcription-worker.js"), {
  type: "module"
});

const pendingRequests = new Map();
let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let recordingStartedAt = 0;
let timerInterval = null;
let mode = "loading";
let modelReady = false;

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

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setStatus("Microphone recording is not supported in this browser.", "error");
    return;
  }

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
    worker.postMessage(
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

    setStatus(modelReady ? "Transcribing locally…" : "Loading the speech model, then transcribing…");
    const text = await requestTranscription(audio);
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

transcript.addEventListener("input", updateCharacterCount);

worker.addEventListener("message", (event) => {
  const message = event.data;

  if (message?.type === "model-loading") {
    if (mode === "loading" || mode === "idle") {
      setStatus("Downloading the local speech model…");
    }
    progressTrack.hidden = false;
    return;
  }

  if (message?.type === "model-progress") {
    progressTrack.hidden = false;
    progressBar.style.width = `${message.progress}%`;
    if (mode === "loading" || mode === "idle") {
      setStatus(`Downloading the local speech model… ${message.progress}%`);
    }
    return;
  }

  if (message?.type === "model-ready") {
    modelReady = true;
    progressBar.style.width = "100%";
    window.setTimeout(() => {
      progressTrack.hidden = true;
      progressBar.style.width = "0";
    }, 350);
    if (mode === "loading" || mode === "idle") {
      setStatus("Ready to record.", "ready");
      setMode("idle");
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

    setStatus(
      "The local speech model could not be loaded. Check your connection for the first download and reopen Quickspeak.",
      "error"
    );
    setMode("idle");
  }
});

window.addEventListener("beforeunload", () => {
  window.clearInterval(timerInterval);
  stopTracks();
  worker.terminate();
});

updateCharacterCount();
setMode("loading");
worker.postMessage({ type: "load" });
