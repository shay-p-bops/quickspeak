export const MODEL_CACHE_MARKER_KEY = "quickspeak.modelCached.v1";

export function parseModelCacheMarker(storedValue) {
  return storedValue === "true";
}

export function getModelLoadingStatus({ cached = false, progress = null, recording = false } = {}) {
  const action = cached
    ? "loading the cached speech model"
    : "downloading the speech model for first use";
  const percentage = Number.isFinite(progress)
    ? ` ${Math.max(0, Math.min(100, Math.round(progress)))}%`
    : "";

  if (recording) {
    return `Listening… ${action} in the background${percentage}.`;
  }

  return `${action[0].toUpperCase()}${action.slice(1)}…${percentage}`;
}

export class LazyModelWorker {
  constructor(createWorker) {
    if (typeof createWorker !== "function") {
      throw new TypeError("createWorker must be a function.");
    }

    this.createWorker = createWorker;
    this.worker = null;
    this.loadRequested = false;
  }

  get isCreated() {
    return this.worker !== null;
  }

  ensure() {
    if (!this.worker) {
      this.worker = this.createWorker();
    }
    return this.worker;
  }

  load() {
    const worker = this.ensure();
    if (!this.loadRequested) {
      this.loadRequested = true;
      worker.postMessage({ type: "load" });
    }
    return worker;
  }

  transcribe(message, transfer = []) {
    const worker = this.load();
    worker.postMessage(message, transfer);
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.loadRequested = false;
  }
}
