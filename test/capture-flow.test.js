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
