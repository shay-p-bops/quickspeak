export const WHISPER_SAMPLE_RATE = 16_000;

export function mixToMono(channels) {
  if (!Array.isArray(channels) || channels.length === 0) {
    return new Float32Array();
  }

  const length = Math.min(...channels.map((channel) => channel.length));
  const mono = new Float32Array(length);

  for (const channel of channels) {
    for (let index = 0; index < length; index += 1) {
      mono[index] += channel[index] / channels.length;
    }
  }

  return mono;
}

export function resampleAudio(input, sourceRate, targetRate = WHISPER_SAMPLE_RATE) {
  if (!(input instanceof Float32Array)) {
    throw new TypeError("Audio input must be a Float32Array.");
  }
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) {
    throw new RangeError("Source sample rate must be greater than zero.");
  }
  if (!Number.isFinite(targetRate) || targetRate <= 0) {
    throw new RangeError("Target sample rate must be greater than zero.");
  }
  if (input.length === 0) {
    return new Float32Array();
  }
  if (sourceRate === targetRate) {
    return input.slice();
  }

  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  if (ratio > 1) {
    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
      const start = Math.floor(outputIndex * ratio);
      const end = Math.min(input.length, Math.max(start + 1, Math.floor((outputIndex + 1) * ratio)));
      let sum = 0;
      for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
        sum += input[inputIndex];
      }
      output[outputIndex] = sum / (end - start);
    }
    return output;
  }

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const sourcePosition = outputIndex * ratio;
    const lowerIndex = Math.floor(sourcePosition);
    const upperIndex = Math.min(input.length - 1, lowerIndex + 1);
    const weight = sourcePosition - lowerIndex;
    output[outputIndex] =
      input[lowerIndex] * (1 - weight) + input[upperIndex] * weight;
  }

  return output;
}

export async function decodeRecording(blob) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("This browser does not support audio decoding.");
  }

  const audioContext = new AudioContextClass();
  try {
    const encodedAudio = await blob.arrayBuffer();
    const decodedAudio = await audioContext.decodeAudioData(encodedAudio.slice(0));
    const channels = Array.from(
      { length: decodedAudio.numberOfChannels },
      (_, index) => decodedAudio.getChannelData(index)
    );
    const mono = mixToMono(channels);
    return resampleAudio(mono, decodedAudio.sampleRate);
  } finally {
    await audioContext.close();
  }
}
