import { env, pipeline } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL("ort/", `${self.location.origin}/`).href;
env.backends.onnx.wasm.numThreads = 1;

const MODEL_ID = "onnx-community/whisper-tiny.en";
let transcriberPromise = null;
let inferenceQueue = Promise.resolve();

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function reportModelProgress(data) {
  if (data?.status === "progress" && Number.isFinite(data.progress)) {
    self.postMessage({
      type: "model-progress",
      progress: Math.max(0, Math.min(100, Math.round(data.progress))),
      file: data.file ?? ""
    });
    return;
  }

  if (data?.status === "initiate") {
    self.postMessage({ type: "model-loading" });
  }
}

function getTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = pipeline(
      "automatic-speech-recognition",
      MODEL_ID,
      {
        dtype: "q8",
        progress_callback: reportModelProgress
      }
    )
      .then((transcriber) => {
        self.postMessage({ type: "model-ready" });
        return transcriber;
      })
      .catch((error) => {
        transcriberPromise = null;
        throw error;
      });
  }

  return transcriberPromise;
}

async function transcribe(requestId, audio) {
  const transcriber = await getTranscriber();
  const result = await transcriber(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: false
  });

  self.postMessage({
    type: "transcript",
    requestId,
    text: result?.text?.trim() ?? ""
  });
}

self.addEventListener("message", (event) => {
  const message = event.data;

  if (message?.type === "load") {
    void getTranscriber().catch((error) => {
      self.postMessage({
        type: "error",
        phase: "model",
        message: formatError(error)
      });
    });
    return;
  }

  if (message?.type !== "transcribe") {
    return;
  }

  const { requestId, audio } = message;
  inferenceQueue = inferenceQueue
    .catch(() => undefined)
    .then(() => transcribe(requestId, audio))
    .catch((error) => {
      self.postMessage({
        type: "error",
        phase: "transcription",
        requestId,
        message: formatError(error)
      });
    });
});
