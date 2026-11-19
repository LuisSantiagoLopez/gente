// Copyright 2026 DeskHead Inc. Licensed under the Apache License, Version 2.0.
// New file in Gente (a fork of Rakazo by Elie Steinbock).
//
// Gente's own UI sounds, synthesized with WebAudio (no audio files): short, soft and quiet.
// Off with the mute toggle in Settings, when the person asks for less motion, and when the page
// is hidden. The operating system's mute is honored by the OS itself (it silences all output).

export type GenteSound = "send" | "arrive" | "error";

const STORAGE_KEY = "gente.sounds";
let context: AudioContext | null = null;

export function soundsEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundsEnabled(enabled: boolean) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Private mode: the toggle lasts for this window only.
  }
}

/** Notes for each sound: [frequency Hz, start s, length s]. */
export const SOUND_NOTES: Record<GenteSound, ReadonlyArray<readonly [number, number, number]>> = {
  // A light upward pluck.
  send: [
    [660, 0, 0.09],
    [990, 0.05, 0.12],
  ],
  // Two warm notes, a soft "hello back".
  arrive: [
    [523.25, 0, 0.16],
    [783.99, 0.09, 0.22],
  ],
  // One low, short, unalarming tone.
  error: [
    [220, 0, 0.18],
    [196, 0.1, 0.22],
  ],
};

export function playSound(sound: GenteSound) {
  if (!soundsEnabled()) return;
  if (globalThis.document?.visibilityState === "hidden") return;
  if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const AudioCtor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return;
  try {
    context ??= new AudioCtor();
    const now = context.currentTime + 0.01;
    for (const [frequency, start, length] of SOUND_NOTES[sound]) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, now + start);
      // Quiet (peak 4%) with a soft attack and a long tail, so it never clicks.
      gain.gain.setValueAtTime(0, now + start);
      gain.gain.linearRampToValueAtTime(0.04, now + start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + length);
      osc.connect(gain).connect(context.destination);
      osc.start(now + start);
      osc.stop(now + start + length + 0.02);
    }
  } catch {
    // Audio is a nicety; never let it break the chat.
  }
}
