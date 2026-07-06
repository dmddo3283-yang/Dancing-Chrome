import { movementProfile, normalizeSettings } from "../shared/settings.js";

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
    this.home = { x: this.bounds.left, y: this.bounds.top };
    this.pos = { x: this.bounds.left, y: this.bounds.top };
    this.vel = { x: 0, y: 0 };
    this.waypoint = { x: this.bounds.left, y: this.bounds.top };
    this.settings = normalizeSettings(settings);
    this.lastUpdateAt = 0;
    this.swim = 0;
    this.level = 0;
    this.surge = 0;
    this.driftX = 0;
    this.nextDartAt = 0;
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

    if (this.settings.driftEnabled) {
      return this.driftFlight(profile, dt);
    }

    return this.freeFlight(profile, dt, beat, now);
  }

  // 관성을 가지고 목표점을 향해 날아가되 지나쳐 휘어지고, 벽에 부딪히면 튕겨 나가며 화면을 돌아다닌다.
  freeFlight(profile, dt, beat, now) {
    const heat = Math.min(1, this.level + this.surge);
    const quiet = this.level < 0.03 && this.surge < 0.03;

    if (quiet) {
      this.waypoint.x = this.home.x;
      this.waypoint.y = this.home.y;
    } else if (beat || now >= this.nextDartAt) {
      this.pickWaypoint(profile);
      this.nextDartAt = now + profile.dartMs * (0.5 + this.random());
    }

    // 목표점으로 향하는 가속 + 속도에 수직인 소용돌이 성분(휘어지는 비행).
    const swirl = profile.swimSpeed * (0.3 + heat);
    const ax = (this.waypoint.x - this.pos.x) * profile.follow - this.vel.y * swirl;
    const ay = (this.waypoint.y - this.pos.y) * profile.follow + this.vel.x * swirl;
    this.vel.x += ax * dt;
    this.vel.y += ay * dt;

    // 항력: 날 때는 약하게(관성 유지), 조용할 때는 강하게(제자리로 착지).
    const drag = quiet ? 6 : 0.9;
    this.vel.x -= this.vel.x * drag * dt;
    this.vel.y -= this.vel.y * drag * dt;

    // 소리가 나는 동안은 항상 시원하게, 클수록 더 빠르게 난다.
    const maxSpeed = profile.reach * 7 * (0.4 + heat);
    const speed = Math.hypot(this.vel.x, this.vel.y);
    if (speed > maxSpeed && speed > 0) {
      const scale = maxSpeed / speed;
      this.vel.x *= scale;
      this.vel.y *= scale;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    this.bounce(profile);

    if (quiet) {
      const homeDist = Math.hypot(this.pos.x - this.home.x, this.pos.y - this.home.y);
      if (homeDist < 4 && Math.hypot(this.vel.x, this.vel.y) < 60) {
        const wasHome = Math.round(this.pos.x) === Math.round(this.home.x) &&
          Math.round(this.pos.y) === Math.round(this.home.y);
        this.pos.x = this.home.x;
        this.pos.y = this.home.y;
        this.vel.x = 0;
        this.vel.y = 0;
        if (wasHome) return null;
      }
    }

    return { windowId: this.windowId, left: Math.round(this.pos.x), top: Math.round(this.pos.y) };
  }

  pickWaypoint(profile) {
    const marginX = profile.offscreenEnabled ? this.bounds.width * 0.5 : 0;
    const marginY = profile.offscreenEnabled ? this.bounds.height * 0.4 : 0;
    const minX = this.screenLeft - marginX;
    const maxX = Math.max(minX, this.screenRight - this.bounds.width + marginX);
    const minY = this.screenTop - marginY;
    const maxY = Math.max(minY, this.screenBottom - this.bounds.height + marginY);
    this.waypoint.x = minX + this.random() * (maxX - minX);
    this.waypoint.y = minY + this.random() * (maxY - minY);
  }

  bounce(profile) {
    const restitution = 0.82;
    const allowX = profile.offscreenEnabled ? this.bounds.width * 0.5 : 0;
    const allowY = profile.offscreenEnabled ? this.bounds.height * 0.4 : 0;
    const minX = this.screenLeft - allowX;
    const maxX = Math.max(minX, this.screenRight - this.bounds.width + allowX);
    const minY = this.screenTop - allowY;
    const maxY = Math.max(minY, this.screenBottom - this.bounds.height + allowY);

    if (this.pos.x < minX) {
      this.pos.x = minX;
      this.vel.x = Math.abs(this.vel.x) * restitution;
    } else if (this.pos.x > maxX) {
      this.pos.x = maxX;
      this.vel.x = -Math.abs(this.vel.x) * restitution;
    }
    if (this.pos.y < minY) {
      this.pos.y = minY;
      this.vel.y = Math.abs(this.vel.y) * restitution;
    } else if (this.pos.y > maxY) {
      this.pos.y = maxY;
      this.vel.y = -Math.abs(this.vel.y) * restitution;
    }
  }

  // 드리프트: 화면을 가로질러 날아가며 위아래로 굽이치다, 완전히 사라지면 반대편에서 다시 날아 들어온다.
  driftFlight(profile, dt) {
    this.driftX += profile.driftSpeed * (0.45 + this.level) * dt;
    this.swim += profile.swimSpeed * 0.4 * (0.4 + this.level) * dt;

    this.pos.x = this.home.x + this.driftX;
    this.pos.y = this.home.y + Math.sin(this.swim) * profile.reach * 0.4 * (0.3 + this.level);

    const lap = this.settings.screen.width + this.bounds.width;
    if (this.pos.x > this.screenRight) {
      this.pos.x -= lap;
      this.driftX -= lap;
    } else if (this.pos.x + this.bounds.width < this.screenLeft) {
      this.pos.x += lap;
      this.driftX += lap;
    }
    this.pos.y = clamp(this.pos.y, this.screenTop, Math.max(this.screenTop, this.screenBottom - this.bounds.height));

    return { windowId: this.windowId, left: Math.round(this.pos.x), top: Math.round(this.pos.y) };
  }

  getRestoreOperation() {
    if (!this.windowId || !this.original) return null;
    return { windowId: this.windowId, ...this.original };
  }

  reset() {
    this.windowId = null;
    this.original = null;
    this.bounds = null;
    this.home = null;
    this.pos = null;
    this.vel = null;
    this.waypoint = null;
    this.settings = null;
    this.lastUpdateAt = 0;
    this.swim = 0;
    this.level = 0;
    this.surge = 0;
    this.driftX = 0;
    this.nextDartAt = 0;
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
