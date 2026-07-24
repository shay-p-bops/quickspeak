import test from "node:test";
import assert from "node:assert/strict";
import {
  getModelLoadingStatus,
  LazyModelWorker,
  parseModelCacheMarker
} from "../src/model-worker.js";

test("model worker is not created until it is needed", () => {
  let creations = 0;
  const messages = [];
  const controller = new LazyModelWorker(() => {
    creations += 1;
    return {
      postMessage(message) {
        messages.push(message);
      },
      terminate() {}
    };
  });

  assert.equal(controller.isCreated, false);
  assert.equal(creations, 0);
  assert.deepEqual(messages, []);

  controller.load();
  assert.equal(controller.isCreated, true);
  assert.equal(creations, 1);
  assert.deepEqual(messages, [{ type: "load" }]);
});

test("repeated load requests reuse one worker and one model load", () => {
  const messages = [];
  const controller = new LazyModelWorker(() => ({
    postMessage(message) {
      messages.push(message);
    },
    terminate() {}
  }));

  controller.load();
  controller.load();
  assert.deepEqual(messages, [{ type: "load" }]);
});

test("transcription starts lazy loading before posting audio", () => {
  const messages = [];
  const controller = new LazyModelWorker(() => ({
    postMessage(message) {
      messages.push(message);
    },
    terminate() {}
  }));

  controller.transcribe({ type: "transcribe", requestId: "one", audio: "samples" });
  assert.deepEqual(messages, [
    { type: "load" },
    { type: "transcribe", requestId: "one", audio: "samples" }
  ]);
});

test("cache marker and status distinguish cached loads from first download", () => {
  assert.equal(parseModelCacheMarker(null), false);
  assert.equal(parseModelCacheMarker("false"), false);
  assert.equal(parseModelCacheMarker("true"), true);
  assert.equal(
    getModelLoadingStatus({ cached: true, progress: 42 }),
    "Loading the cached speech model… 42%"
  );
  assert.equal(
    getModelLoadingStatus({ cached: false, recording: true }),
    "Listening… downloading the speech model for first use in the background."
  );
});
