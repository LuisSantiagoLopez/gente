// Copyright 2026 DeskHead Inc. New file in Gente (a fork of Rakazo, Apache-2.0).
// Records this computer's microphone (left) and the sound it plays, the call (right), at 16 kHz,
// until main asks to stop. Audio stays in memory here and goes only to Gente's main process.
"use strict";
const RATE = 16000;
let stopRequested = false;

async function record() {
  const ctx = new AudioContext({ sampleRate: RATE });
  const merger = ctx.createChannelMerger(2);
  const streams = [];
  let mic = false;
  let call = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    streams.push(stream);
    ctx.createMediaStreamSource(stream).connect(merger, 0, 0);
    mic = true;
  } catch {}
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    for (const track of stream.getVideoTracks()) track.stop();
    const audio = stream.getAudioTracks();
    if (audio.length) {
      streams.push(stream);
      ctx.createMediaStreamSource(new MediaStream(audio)).connect(merger, 0, 1);
      call = true;
    }
  } catch {}
  window.genteMeeting.started({ mic, call });
  if (!mic && !call) return;
  const node = ctx.createScriptProcessor(4096, 2, 2);
  const left = [];
  const right = [];
  node.onaudioprocess = (event) => {
    left.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    right.push(new Float32Array(event.inputBuffer.getChannelData(1)));
  };
  merger.connect(node);
  node.connect(ctx.destination);
  while (!stopRequested) await new Promise((resolve) => setTimeout(resolve, 500));
  node.disconnect();
  for (const stream of streams) for (const track of stream.getTracks()) track.stop();
  await ctx.close();
  window.genteMeeting.finished(interleave(left, right));
}

/** 16-bit stereo samples, left then right; main wraps them in a WAV header. */
function interleave(left, right) {
  const frames = left.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Int16Array(frames * 2);
  let at = 0;
  for (let c = 0; c < left.length; c++) {
    for (let i = 0; i < left[c].length; i++) {
      out[at++] = Math.max(-1, Math.min(1, left[c][i])) * 32767;
      out[at++] = Math.max(-1, Math.min(1, right[c][i])) * 32767;
    }
  }
  return out.buffer;
}

window.genteMeeting.onStop(() => {
  stopRequested = true;
});
void record();
