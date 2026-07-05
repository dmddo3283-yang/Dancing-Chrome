export const DEFAULT_SETTINGS = Object.freeze({
  intensity: 42,
  sensitivity: 55,
  beatBoost: 70,
  driftEnabled: false,
  restoreOnStop: true,
  screen: {
    width: 1440,
    height: 900,
    availLeft: 0,
    availTop: 0
  }
});

export function normalizeSettings(input = {}) {
  const screen = input.screen ?? {};

  return {
    intensity: clampNumber(input.intensity, 1, 100, DEFAULT_SETTINGS.intensity),
    sensitivity: clampNumber(input.sensitivity, 1, 100, DEFAULT_SETTINGS.sensitivity),
    beatBoost: clampNumber(input.beatBoost, 0, 100, DEFAULT_SETTINGS.beatBoost),
    driftEnabled: Boolean(input.driftEnabled),
    restoreOnStop: input.restoreOnStop !== false,
    screen: {
      width: clampNumber(screen.width, 640, 10000, DEFAULT_SETTINGS.screen.width),
      height: clampNumber(screen.height, 480, 10000, DEFAULT_SETTINGS.screen.height),
      availLeft: clampNumber(screen.availLeft, -10000, 10000, 0),
      availTop: clampNumber(screen.availTop, -10000, 10000, 0)
    }
  };
}

export function movementProfile(intensity) {
  const amount = clampNumber(intensity, 1, 100, DEFAULT_SETTINGS.intensity) / 100;
  const eased = amount ** 2.15;

  return {
    amount,
    shakeRadius: 2 + eased * 92,
    jumpRadius: 8 + eased * 620,
    driftSpeed: 0.5 + eased * 15,
    offscreenEnabled: intensity >= 88,
    updateInterval: intensity >= 75 ? 28 : intensity >= 35 ? 42 : 58
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
