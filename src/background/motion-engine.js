import { movementProfile, normalizeSettings } from "../shared/settings.js";

// chrome.windows.update 는 창이 화면 안에 최소 50% 이상 있어야 위치를 바꿔준다.
// 모서리에서 두 축이 동시에 벗어나도 넉넉히 보이도록 축당 최대 이탈 비율은 25%로 둔다.
const OFFSCREEN_FRACTION = 0.25;

export class MotionEngine {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.reset();
  }

  start(browserWindow, settings) {
    if (!browserWindow?.id) throw new Error("움직일 Chrome 창을 찾지 못했습니다.");

    this.windowId = browserWindow.id;
    this.original = boundsOf(browserWindow);
    this.bounds = boundsOf(browserWindow);
    this.baseW = this.bounds.width;
    this.baseH = this.bounds.height;
    this.home = { x: this.bounds.left, y: this.bounds.top };
    this.pos = { x: this.bounds.left, y: this.bounds.top };
    this.vel = { x: 0, y: 0 };
    this.waypoint = { x: this.bounds.left, y: this.bounds.top };
    this.settings = normalizeSettings(settings);
    this.lastUpdateAt = 0;
    this.swim = 0;
    this.level = 0;
    this.surge = 0;
    this.scale = 1;
    this.angle = 0;
    this.driftX = 0;
    this.driftDir = 1;
    this.nextDartAt = 0;
    this.settledEmitted = false;
  }

  updateSettings(settings) {
    this.settings = normalizeSettings({ ...this.settings, ...settings });
  }

  step(frame, now = Date.now()) {
    if (!this.windowId || !this.bounds || !this.settings) return null;

    const profile = movementProfile(this.settings.intensity);
    if (now - this.lastUpdateAt < profile.updateInterval) return null;

    const dt = this.lastUpdateAt
      ? clamp((now - this.lastUpdateAt) / 1000, 0.001, 0.12)
      : profile.updateInterval / 1000;
    this.lastUpdateAt = now;

    const energy = clamp(Number(frame?.energy) || 0, 0, 1);
    const bass = clamp(Number(frame?.bass) || 0, 0, 1);
    const beat = Boolean(frame?.beat);
    const activity = Math.max(energy, bass * 0.85);

    this.level = approach(this.level, activity, 6, dt);
    if (beat) {
      const kick = 0.45 + this.settings.beatBoost / 100 * 0.6;
      this.surge = Math.min(1.6, this.surge + kick);
    }
    this.surge = approach(this.surge, 0, 3.2, dt);

    const heat = Math.min(1, this.level + this.surge);
    // 소리가 나면 계속 돌고, 조용해지면 가장 가까운 정방향(똑바로)으로 되돌아온다.
    if (heat < 0.03) {
      this.angle = approach(this.angle, Math.round(this.angle / 360) * 360, 4, dt);
    } else {
      this.angle += profile.spin * heat * dt;
    }

    const operation = this.settings.driftEnabled
      ? this.driftFlight(profile, dt, now)
      : this.freeFlight(profile, dt, beat, now);

    if (operation && this.settings.rotationEnabled) {
      operation.rotation = Math.round(this.angle);
    }
    return operation;
  }

  // 관성을 가지고 목표점을 향해 날아가되 지나쳐 휘어지고, 벽에 부딪히면 튕겨 나가며 화면을 돌아다닌다.
  freeFlight(profile, dt, beat, now) {
    this.applyPulse(profile, dt, now);
    const heat = Math.min(1, this.level + this.surge);
    const quiet = this.level < 0.03 && this.surge < 0.03;
    const box = this.safeBox(profile);

    if (quiet) {
      this.waypoint.x = this.home.x;
      this.waypoint.y = this.home.y;
    } else {
      this.settledEmitted = false;
      if (beat || now >= this.nextDartAt) {
        this.waypoint.x = box.minX + this.random() * (box.maxX - box.minX);
        this.waypoint.y = box.minY + this.random() * (box.maxY - box.minY);
        this.nextDartAt = now + profile.dartMs * (0.5 + this.random());
      }
    }

    const swirl = profile.swimSpeed * (0.3 + heat);
    const ax = (this.waypoint.x - this.pos.x) * profile.follow - this.vel.y * swirl;
    const ay = (this.waypoint.y - this.pos.y) * profile.follow + this.vel.x * swirl;
    this.vel.x += ax * dt;
    this.vel.y += ay * dt;

    const drag = quiet ? 6 : 0.9;
    this.vel.x -= this.vel.x * drag * dt;
    this.vel.y -= this.vel.y * drag * dt;

    const maxSpeed = profile.reach * 7 * (0.4 + heat);
    const speed = Math.hypot(this.vel.x, this.vel.y);
    if (speed > maxSpeed && speed > 0) {
      const scale = maxSpeed / speed;
      this.vel.x *= scale;
      this.vel.y *= scale;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.bounce(box);

    if (quiet && this.atRest(box)) {
      this.pos.x = this.home.x;
      this.pos.y = this.home.y;
      this.vel.x = 0;
      this.vel.y = 0;
      if (this.settledEmitted) return null;
      this.settledEmitted = true;
    }

    return this.finishOp();
  }

  // 드리프트: 화면을 좌우로 크게 휩쓸며 위아래로 굽이친다(가장자리에서 방향 반전).
  driftFlight(profile, dt, now) {
    this.applyPulse(profile, dt, now);
    const box = this.safeBox(profile);
    this.driftX += this.driftDir * profile.driftSpeed * (0.45 + this.level) * dt;
    this.swim += profile.swimSpeed * 0.4 * (0.4 + this.level) * dt;

    this.pos.x = this.home.x + this.driftX;
    this.pos.y = this.home.y + Math.sin(this.swim) * profile.reach * 0.4 * (0.3 + this.level);

    if (this.pos.x < box.minX) {
      this.pos.x = box.minX;
      this.driftX = box.minX - this.home.x;
      this.driftDir = 1;
    } else if (this.pos.x > box.maxX) {
      this.pos.x = box.maxX;
      this.driftX = box.maxX - this.home.x;
      this.driftDir = -1;
    }
    this.pos.y = clamp(this.pos.y, box.minY, box.maxY);

    return this.finishOp();
  }

  // 소리에 맞춰 창 크기를 부풀렸다 줄인다(비트에 크게 반응).
  applyPulse(profile, dt, now) {
    if (!this.settings.pulseEnabled) return;
    const breathe = Math.sin(now * 0.004) * 0.1 * this.level;
    const target = 1 + breathe + this.surge * 0.22;
    this.scale = approach(this.scale, target, 8, dt);
    this.bounds.width = Math.round(clamp(this.baseW * this.scale, this.baseW * 0.6, this.settings.screen.width));
    this.bounds.height = Math.round(clamp(this.baseH * this.scale, this.baseH * 0.6, this.settings.screen.height));
  }

  finishOp() {
    const op = {
      windowId: this.windowId,
      left: Math.round(this.pos.x),
      top: Math.round(this.pos.y)
    };
    if (this.settings.pulseEnabled) {
      op.width = this.bounds.width;
      op.height = this.bounds.height;
    }
    return op;
  }

  // 창이 완전히 제자리로(위치·크기·각도) 돌아왔는지.
  atRest(box) {
    const homeDist = Math.hypot(this.pos.x - this.home.x, this.pos.y - this.home.y);
    if (homeDist >= 4 || Math.hypot(this.vel.x, this.vel.y) >= 60) return false;
    if (this.settings.rotationEnabled &&
      Math.abs(this.angle - Math.round(this.angle / 360) * 360) >= 1) return false;
    if (this.settings.pulseEnabled && Math.abs(this.scale - 1) >= 0.02) return false;
    return true;
  }

  bounce(box) {
    const restitution = 0.82;
    if (this.pos.x < box.minX) {
      this.pos.x = box.minX;
      this.vel.x = Math.abs(this.vel.x) * restitution;
    } else if (this.pos.x > box.maxX) {
      this.pos.x = box.maxX;
      this.vel.x = -Math.abs(this.vel.x) * restitution;
    }
    if (this.pos.y < box.minY) {
      this.pos.y = box.minY;
      this.vel.y = Math.abs(this.vel.y) * restitution;
    } else if (this.pos.y > box.maxY) {
      this.pos.y = box.maxY;
      this.vel.y = -Math.abs(this.vel.y) * restitution;
    }
  }

  // 창이 항상 화면 안에 충분히 남도록 허용 이동 범위를 계산한다(현재 크기 기준).
  safeBox(profile) {
    const offX = profile.offscreenEnabled ? this.bounds.width * OFFSCREEN_FRACTION : 0;
    const offY = profile.offscreenEnabled ? this.bounds.height * OFFSCREEN_FRACTION : 0;
    const minX = this.screenLeft - offX;
    const maxX = Math.max(minX, this.screenRight - this.bounds.width + offX);
    const minY = this.screenTop - offY;
    const maxY = Math.max(minY, this.screenBottom - this.bounds.height + offY);
    return { minX, maxX, minY, maxY };
  }

  // chrome.windows.update 가 경계 오류를 낸 뒤, 다음 프레임이 확실히 유효하도록 창을 화면 안으로 당긴다.
  pullInside() {
    if (!this.pos || !this.settings || !this.bounds) return;
    const maxX = Math.max(this.screenLeft, this.screenRight - this.bounds.width);
    const maxY = Math.max(this.screenTop, this.screenBottom - this.bounds.height);
    this.pos.x = clamp(this.pos.x, this.screenLeft, maxX);
    this.pos.y = clamp(this.pos.y, this.screenTop, maxY);
    if (this.vel) {
      this.vel.x = 0;
      this.vel.y = 0;
    }
    if (this.home) {
      this.driftX = clamp(this.driftX, this.screenLeft - this.home.x, maxX - this.home.x);
    }
  }

  getRestoreOperation() {
    if (!this.windowId || !this.original) return null;
    return { windowId: this.windowId, ...this.original };
  }

  reset() {
    this.windowId = null;
    this.original = null;
    this.bounds = null;
    this.baseW = null;
    this.baseH = null;
    this.home = null;
    this.pos = null;
    this.vel = null;
    this.waypoint = null;
    this.settings = null;
    this.lastUpdateAt = 0;
    this.swim = 0;
    this.level = 0;
    this.surge = 0;
    this.scale = 1;
    this.angle = 0;
    this.driftX = 0;
    this.driftDir = 1;
    this.nextDartAt = 0;
    this.settledEmitted = false;
  }

  get screenLeft() {
    return this.settings.screen.availLeft;
  }

  get screenTop() {
    return this.settings.screen.availTop;
  }

  get screenRight() {
    return this.screenLeft + this.settings.screen.width;
  }

  get screenBottom() {
    return this.screenTop + this.settings.screen.height;
  }
}

function boundsOf(browserWindow) {
  return {
    left: Number(browserWindow.left) || 0,
    top: Number(browserWindow.top) || 0,
    width: Number(browserWindow.width) || 1000,
    height: Number(browserWindow.height) || 700
  };
}

// 프레임 간격(dt)에 무관하게 일정한 속도로 목표에 수렴하는 지수 감쇠 보간.
function approach(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
