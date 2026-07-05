import test from "node:test";
import assert from "node:assert/strict";
import { movementProfile, normalizeSettings } from "../src/shared/settings.js";

test("settings are clamped to safe ranges", () => {
  const settings = normalizeSettings({
    intensity: 999,
    sensitivity: -3,
    beatBoost: "40",
    screen: { width: 10, height: 50000 }
  });

  assert.equal(settings.intensity, 100);
  assert.equal(settings.sensitivity, 1);
  assert.equal(settings.beatBoost, 40);
  assert.equal(settings.screen.width, 640);
  assert.equal(settings.screen.height, 10000);
});

test("only extreme profiles may leave the screen", () => {
  assert.equal(movementProfile(87).offscreenEnabled, false);
  assert.equal(movementProfile(88).offscreenEnabled, true);
  assert.ok(movementProfile(100).jumpRadius > movementProfile(20).jumpRadius * 10);
});
