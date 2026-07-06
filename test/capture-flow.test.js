import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("desktop picker runs in an extension page, not the service worker", async () => {
  const [worker, popup, capture] = await Promise.all([
    readFile(new URL("../src/background/service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../src/popup/popup.js", import.meta.url), "utf8"),
    readFile(new URL("../src/capture/capture.js", import.meta.url), "utf8")
  ]);

  assert.equal(worker.includes("desktopCapture.chooseDesktopMedia"), false);
  assert.equal(popup.includes("src/capture/capture.html"), true);
  assert.equal(capture.includes("desktopCapture.chooseDesktopMedia"), true);
  assert.equal(capture.includes("chrome.runtime.lastError"), true);
});

test("audio analyser stays connected to a silent output sink", async () => {
  const engine = await readFile(
    new URL("../src/offscreen/audio-engine.js", import.meta.url),
    "utf8"
  );

  assert.equal(engine.includes("analyser.connect(outputGain)"), true);
  assert.equal(engine.includes("outputGain.connect(audioContext.destination)"), true);
  assert.equal(engine.includes("outputGain.gain.value = playThrough ? 1 : 0"), true);
});

test("capture start waits for the offscreen result before reporting success", async () => {
  const [worker, engine] = await Promise.all([
    readFile(new URL("../src/background/service-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../src/offscreen/audio-engine.js", import.meta.url), "utf8")
  ]);

  // Service worker must inspect the offscreen response, not optimistically return ok.
  assert.equal(worker.includes("if (!result?.ok)"), true);
  // Offscreen must reply with the real getUserMedia outcome so failures surface in the UI.
  assert.equal(engine.includes("sendResponse({ ok: true })"), true);
  assert.equal(engine.includes("sendResponse({ ok: false, error: readable })"), true);
});
