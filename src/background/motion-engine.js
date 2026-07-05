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
    this.anchor = { x: this.bounds.left, y: this.bounds.top };
    this.settings = normalizeSettings(settings);
    this.lastUpdateAt = 0;
    this.escape = null;
  }

  updateSettings(settings) {
    this.settings = normalizeSettings({ ...this.settings, ...settings });
  }

  step(frame, now = Date.now()) {
    if (!this.windowId || !this.bounds || !this.settings) return null;

    const profile = movementProfile(this.settings.intensity);
    if (now - this.lastUpdateAt < profile.updateInterval) return null;
    this.lastUpdateAt = now;

    const energy = clamp(Number(frame?.energy) || 0, 0, 1);
    const bass = clamp(Number(frame?.bass) || 0, 0, 1);
    const beat = Boolean(frame?.beat);
    const activity = Math.max(energy, bass * 0.8);

    if (activity < 0.012 && !this.escape) return null;

    if (this.escape) {
      this.advanceEscape(profile, activity);
    } else {
      if (beat) this.jumpOnBeat(profile, activity);
      if (this.settings.driftEnabled) this.advanceDrift(profile, activity);

      if (
        profile.offscreenEnabled &&
        beat &&
        activity > 0.18 &&
        this.random() < 0.18 + profile.amount * 0.46
      ) {
        this.escape = { direction: this.random() < 0.5 ? -1 : 1, phase: "exit" };
      }
    }

    const shake = profile.shakeRadius * activity;
    const phase = now / 34;
    const next = {
      left: Math.round(this.anchor.x + Math.sin(phase * 1.73) * shake),
      top: Math.round(this.anchor.y + Math.cos(phase * 2.11) * shake * 0.72)
    };

    this.bounds.left = next.left;
    this.bounds.top = next.top;
    return { windowId: this.windowId, ...next };
  }

  jumpOnBeat(profile, activity) {
    const beatScale = 0.25 + this.settings.beatBoost / 100;
    const radius = profile.jumpRadius * beatScale * (0.35 + activity * 0.9);
    const x = this.original.left + signed(this.random) * radius;
    const y = this.original.top + signed(this.random) * radius * 0.56;

    if (profile.offscreenEnabled) {
      const limitX = this.bounds.width * 0.55;
      const limitY = this.bounds.height * 0.35;
      this.anchor.x = clamp(x, this.screenLeft - limitX, this.screenRight - this.bounds.width + limitX);
      this.anchor.y = clamp(y, this.screenTop - limitY, this.screenBottom - this.bounds.height + limitY);
      return;
    }

    this.anchor.x = clamp(x, this.screenLeft, Math.max(this.screenLeft, this.screenRight - this.bounds.width));
    this.anchor.y = clamp(y, this.screenTop, Math.max(this.screenTop, this.screenBottom - this.bounds.height));
  }

  advanceDrift(profile, activity) {
    const outsideRight = this.anchor.x + this.bounds.width > this.screenRight;
    const outsideLeft = this.anchor.x < this.screenLeft;
    const edgeBoost = outsideRight || outsideLeft ? 4.8 : 1;
    this.anchor.x += profile.driftSpeed * (0.45 + activity * 2.8) * edgeBoost;

    if (this.anchor.x > this.screenRight + 24) {
      this.anchor.x = this.screenLeft - this.bounds.width - 24;
    }
  }

  advanceEscape(profile, activity) {
    const speed = 20 + profile.amount * 48 + activity * 54;
    this.anchor.x += this.escape.direction * speed;

    const fullyOutsideRight = this.anchor.x > this.screenRight + 24;
    const fullyOutsideLeft = this.anchor.x + this.bounds.width < this.screenLeft - 24;

    if (this.escape.phase === "exit" && (fullyOutsideRight || fullyOutsideLeft)) {
      this.anchor.x = this.escape.direction > 0
        ? this.screenLeft - this.bounds.width - 24
        : this.screenRight + 24;
      this.escape.phase = "reenter";
      return;
    }

    const visibleFromLeft = this.escape.direction > 0 && this.anchor.x >= this.screenLeft + 24;
    const visibleFromRight = this.escape.direction < 0 && this.anchor.x + this.bounds.width <= this.screenRight - 24;
    if (this.escape.phase === "reenter" && (visibleFromLeft || visibleFromRight)) {
      this.anchor.x = clamp(
        this.anchor.x,
        this.screenLeft,
        Math.max(this.screenLeft, this.screenRight - this.bounds.width)
      );
      this.escape = null;
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
    this.anchor = null;
    this.settings = null;
    this.lastUpdateAt = 0;
    this.escape = null;
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

function signed(random) {
  return random() * 2 - 1;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
