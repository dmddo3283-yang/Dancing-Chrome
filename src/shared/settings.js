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
  const eased = amount ** 1.9;

  return {
    amount,
    // 비행 반경·최고 속도의 기준(px): 낮으면 좁게, 높으면 화면을 가로질러 쌩쌩.
    reach: 20 + eased * 520,
    // 속도에 수직으로 얹는 소용돌이 성분(rad/s): 클수록 더 크게 휘어져 난다.
    swimSpeed: 1.5 + eased * 5,
    // 목표점을 향한 조향 강도(1/s): 클수록 방향 전환이 날카롭다.
    follow: 6 + eased * 10,
    // 새 목표점(웨이포인트)으로 방향을 트는 간격(ms).
    dartMs: 360 - eased * 260,
    // 드리프트(화면을 가로질러 나는 궤도) 속도(px/s).
    driftSpeed: 60 + eased * 320,
    offscreenEnabled: intensity >= 88,
    // 매끈한 비행 궤적을 위해 짧은 간격으로 갱신한다(ms).
    updateInterval: intensity >= 75 ? 20 : intensity >= 35 ? 26 : 34
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}
