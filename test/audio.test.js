import test from "node:test";
import assert from "node:assert/strict";
import { mixToMono, resampleAudio } from "../src/audio.js";

function closeTo(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} was not close to ${expected}`);
}

test("mixToMono averages channels", () => {
  const result = mixToMono([
    new Float32Array([1, 0, -1]),
    new Float32Array([-1, 1, 1])
  ]);

  assert.equal(result.length, 3);
  closeTo(result[0], 0);
  closeTo(result[1], 0.5);
  closeTo(result[2], 0);
});

test("resampleAudio returns a copy when rates match", () => {
  const input = new Float32Array([0.1, 0.2, 0.3]);
  const result = resampleAudio(input, 16000, 16000);

  assert.deepEqual([...result], [...input]);
  assert.notEqual(result, input);
});

test("resampleAudio downsamples using bucket averages", () => {
  const input = new Float32Array([0, 2, 4, 6]);
  const result = resampleAudio(input, 4, 2);

  assert.deepEqual([...result], [1, 5]);
});

test("resampleAudio rejects invalid sample rates", () => {
  assert.throws(() => resampleAudio(new Float32Array([1]), 0), RangeError);
});
