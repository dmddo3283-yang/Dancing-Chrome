import test from "node:test";
import assert from "node:assert/strict";
import { MotionEngine } from "../src/background/motion-engine.js";

const browserWindow = { id: 7, left: 300, top: 160, width: 600, height: 500 };
const screen = { width: 1440, height: 900, availLeft: 0, availTop: 0 };

test("moderate motion stays fully on screen", () => {
  const engine = new MotionEngine({ random: () => 0.99 });
  engine.start(browserWindow, { intensity: 60, beatBoost: 100, screen });

  for (let index = 1; index <= 40; index += 1) {
    const operation = engine.step({ energy: 1, bass: 1, beat: index % 4 === 0 }, index * 40);
    if (!operation) continue;
    assert.ok(operation.left >= 0);
    assert.ok(operation.left <= screen.width - browserWindow.width);
    assert.ok(operation.top >= 0);
    assert.ok(operation.top <= screen.height - browserWindow.height);
  }
});

test("motion flies across a wide range while music plays", () => {
  let seed = 987654321;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const engine = new MotionEngine({ random });
  engine.start(browserWindow, { intensity: 70, beatBoost: 100, screen });

  const lefts = [];
  const tops = [];
  for (let index = 1; index <= 80; index += 1) {
    const operation = engine.step({ energy: 1, bass: 1, beat: index % 3 === 0 }, index * 30);
    if (!operation) continue;
    lefts.push(operation.left);
    tops.push(operation.top);
    assert.ok(operation.left >= 0 && operation.left <= screen.width - browserWindow.width);
    assert.ok(operation.top >= 0 && operation.top <= screen.height - browserWindow.height);
  }

  const spreadX = Math.max(...lefts) - Math.min(...lefts);
  const spreadY = Math.max(...tops) - Math.min(...tops);
  assert.ok(spreadX > 150, `expected frantic horizontal spread, got ${spreadX}px`);
  assert.ok(spreadY > 80, `expected frantic vertical spread, got ${spreadY}px`);
});

test("silence lets the window settle back home", () => {
  const engine = new MotionEngine();
  engine.start(browserWindow, { intensity: 60, screen });

  let clock = 0;
  // 음악으로 한동안 유영시켜 원위치에서 벗어나게 한다.
  for (let index = 0; index < 40; index += 1) {
    clock += 40;
    engine.step({ energy: 1, bass: 1, beat: index % 4 === 0 }, clock);
  }

  // 무음이 이어지면 부드럽게 원위치로 돌아와 결국 멈춘다.
  let last = null;
  for (let index = 0; index < 400; index += 1) {
    clock += 40;
    const operation = engine.step({ energy: 0, bass: 0, beat: false }, clock);
    if (operation) last = operation;
  }

  assert.ok(last, "engine should emit at least one homing frame");
  assert.ok(Math.abs(last.left - browserWindow.left) <= 2);
  assert.ok(Math.abs(last.top - browserWindow.top) <= 2);
});

test("drift sweeps the window across the screen and stays within Chrome's bounds rule", () => {
  const width = 200;
  const screenWidth = 800;
  const engine = new MotionEngine({ random: () => 0.5 });
  engine.start(
    { id: 7, left: 700, top: 100, width, height: 300 },
    { intensity: 100, driftEnabled: true, screen: { ...screen, width: screenWidth } }
  );

  const positions = [];
  for (let index = 1; index <= 200; index += 1) {
    const operation = engine.step({ energy: 1, bass: 1, beat: false }, index * 50);
    if (operation) positions.push(operation.left);
  }

  const min = Math.min(...positions);
  const max = Math.max(...positions);
  // 좌우로 크게 휩쓴다.
  assert.ok(max - min > 400, `expected a wide sweep, got ${max - min}px`);
  // 그러면서도 창이 항상 최소 50% 이상 화면 안에 남는다(가장자리에서 축당 25% 이내로만 벗어남).
  assert.ok(min >= -width * 0.25 - 1, `left edge went too far off: ${min}`);
  assert.ok(max <= screenWidth - width + width * 0.25 + 1, `right edge went too far off: ${max}`);
});

test("even at max intensity the window stays at least 50% on screen", () => {
  let seed = 24680;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const engine = new MotionEngine({ random });
  const win = { id: 7, left: 400, top: 250, width: 700, height: 500 };
  engine.start(win, { intensity: 100, beatBoost: 100, screen });

  for (let index = 1; index <= 200; index += 1) {
    const operation = engine.step({ energy: 1, bass: 1, beat: index % 3 === 0 }, index * 20);
    if (!operation) continue;
    const visibleX = Math.min(operation.left + win.width, screen.width) - Math.max(operation.left, 0);
    const visibleY = Math.min(operation.top + win.height, screen.height) - Math.max(operation.top, 0);
    assert.ok(visibleX >= win.width * 0.5 - 1, `only ${visibleX}px of width visible at left=${operation.left}`);
    assert.ok(visibleY >= win.height * 0.5 - 1, `only ${visibleY}px of height visible at top=${operation.top}`);
  }
});

test("size pulse resizes the window but keeps it within screen bounds", () => {
  const win = { id: 7, left: 400, top: 250, width: 700, height: 500 };
  const engine = new MotionEngine({ random: () => 0.5 });
  engine.start(win, { intensity: 60, beatBoost: 100, pulseEnabled: true, screen });

  let resized = false;
  for (let index = 1; index <= 80; index += 1) {
    const operation = engine.step({ energy: 1, bass: 1, beat: index % 3 === 0 }, index * 30);
    if (!operation) continue;
    assert.ok(typeof operation.width === "number" && typeof operation.height === "number");
    assert.ok(operation.width >= win.width * 0.6 - 1 && operation.width <= screen.width);
    assert.ok(operation.height >= win.height * 0.6 - 1 && operation.height <= screen.height);
    if (operation.width !== win.width || operation.height !== win.height) resized = true;
  }
  assert.ok(resized, "expected the window to change size with the music");
});

test("rotation is emitted and advances only when spin is enabled", () => {
  const win = { id: 7, left: 400, top: 250, width: 700, height: 500 };

  const off = new MotionEngine({ random: () => 0.5 });
  off.start(win, { intensity: 60, screen });
  const offOp = off.step({ energy: 1, bass: 1, beat: true }, 100);
  assert.equal(offOp.rotation, undefined);

  const on = new MotionEngine({ random: () => 0.5 });
  on.start(win, { intensity: 60, rotationEnabled: true, screen });
  const angles = [];
  for (let index = 1; index <= 40; index += 1) {
    const operation = on.step({ energy: 1, bass: 1, beat: index % 4 === 0 }, index * 30);
    if (operation && operation.rotation != null) angles.push(operation.rotation);
  }
  assert.ok(angles.length > 0);
  assert.ok(Math.max(...angles) > Math.min(...angles), "angle should advance while music plays");
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
