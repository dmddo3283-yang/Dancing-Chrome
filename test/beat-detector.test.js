import test from "node:test";
import assert from "node:assert/strict";
import {
  BeatDetector,
  calculateBandEnergy,
  calculateRms,
  calculateSpectralFlux
} from "../src/offscreen/beat-detector.js";

test("RMS distinguishes silence from a loud waveform", () => {
  assert.equal(calculateRms(Uint8Array.from([128, 128, 128])), 0);
  assert.ok(calculateRms(Uint8Array.from([0, 255, 0, 255])) > 0.9);
});

test("band energy and spectral flux react to stronger bins", () => {
  const spectrum = new Uint8Array(16);
  spectrum[2] = 255;
  spectrum[3] = 255;
  assert.ok(calculateBandEnergy(spectrum, 1600, 32, 90, 160) >= 0.5);
  assert.ok(calculateSpectralFlux(spectrum, new Uint8Array(16)) > 0);
});

test("detector emits an onset after the cooldown", () => {
  const detector = new BeatDetector({ sampleRate: 48000, fftSize: 32 });
  const quietTime = new Uint8Array(32).fill(128);
  const loudTime = Uint8Array.from({ length: 32 }, (_, index) => index % 2 ? 255 : 0);
  const quietSpectrum = new Uint8Array(16);
  const loudSpectrum = new Uint8Array(16).fill(255);

  detector.analyse(quietTime, quietSpectrum, 0, 80);
  const result = detector.analyse(loudTime, loudSpectrum, 500, 80);
  assert.equal(result.beat, true);
  assert.ok(result.energy > 0.9);
});
