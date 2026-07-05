import test from "node:test";
import assert from "node:assert/strict";
import { MotionEngine } from "../src/background/motion-engine.js";

const browserWindow = { id: 7, left: 300, top: 160, width: 600, height: 500 };
const screen = { width: 1440, height: 900, availLeft: 0, availTop: 0 };

test("moderate beat jumps stay fully on screen", () => {
  const engine = new MotionEngine({ random: () => 0.99 });
  engine.start(browserWindow, { intensity: 60, beatBoost: 100, screen });
  const operation = engine.step({ energy: 1, bass: 1, beat: true }, 1000);

  assert.ok(operation.left >= 0);
  assert.ok(operation.left <= screen.width - browserWindow.width);
  assert.ok(operation.top >= 0);
  assert.ok(operation.top <= screen.height - browserWindow.height);
});

test("right drift wraps only after the window is fully outside", () => {
  const engine = new MotionEngine({ random: () => 0.1 });
  engine.start(
    { id: 7, left: 700, top: 100, width: 200, height: 300 },
    { intensity: 100, driftEnabled: true, screen: { ...screen, width: 800 } }
  );

  const positions = [];
  for (let index = 1; index <= 20; index += 1) {
    const operation = engine.step({ energy: 1, bass: 1, beat: false }, index * 100);
    if (operation) positions.push(operation.left);
  }

  assert.ok(positions.some((left) => left > 800));
  assert.ok(positions.some((left) => left < 0));
});

test("stop operation restores original bounds", () => {
  const engine = new MotionEngine();
  engine.start(browserWindow, { intensity: 90, screen });
  assert.deepEqual(engine.getRestoreOperation(), {
    windowId: 7,
    left: 300,
    top: 160,
    width: 600,
    height: 500
  });
});
