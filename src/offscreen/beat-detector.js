export class BeatDetector {
  constructor({ sampleRate = 48000, fftSize = 2048 } = {}) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.previousSpectrum = null;
    this.energyAverage = 0.02;
    this.fluxAverage = 0.005;
    this.lastBeatAt = 0;
  }

  analyse(timeData, frequencyData, now, sensitivity = 55) {
    const rms = calculateRms(timeData);
    const bass = calculateBandEnergy(
      frequencyData,
      this.sampleRate,
      this.fftSize,
      45,
      190
    );
    const flux = calculateSpectralFlux(frequencyData, this.previousSpectrum);

    this.previousSpectrum = Uint8Array.from(frequencyData);
    this.energyAverage = lerp(this.energyAverage, rms, 0.045);
    this.fluxAverage = lerp(this.fluxAverage, flux, 0.075);

    const sensitivityScale = 1.8 - sensitivity / 100;
    const onsetThreshold = Math.max(0.004, this.fluxAverage * (1.2 + sensitivityScale * 0.62));
    const energyGate = Math.max(0.012, this.energyAverage * (0.85 + sensitivityScale * 0.22));
    const cooldown = 150 + (1 - sensitivity / 100) * 120;
    const beat = now - this.lastBeatAt >= cooldown && flux > onsetThreshold && rms > energyGate;

    if (beat) this.lastBeatAt = now;

    return {
      energy: clamp(rms * 2.35, 0, 1),
      bass: clamp(bass * 1.8, 0, 1),
      flux: clamp(flux * 7, 0, 1),
      beat
    };
  }
}

export function calculateRms(data) {
  let sum = 0;
  for (const value of data) {
    const sample = (value - 128) / 128;
    sum += sample * sample;
  }
  return Math.sqrt(sum / Math.max(1, data.length));
}

export function calculateBandEnergy(data, sampleRate, fftSize, lowHz, highHz) {
  const hzPerBin = sampleRate / fftSize;
  const start = Math.max(0, Math.floor(lowHz / hzPerBin));
  const end = Math.min(data.length - 1, Math.ceil(highHz / hzPerBin));
  let sum = 0;

  for (let index = start; index <= end; index += 1) {
    sum += data[index] / 255;
  }

  return sum / Math.max(1, end - start + 1);
}

export function calculateSpectralFlux(current, previous) {
  if (!previous) return 0;
  let sum = 0;

  for (let index = 0; index < current.length; index += 1) {
    const increase = current[index] - previous[index];
    if (increase > 0) sum += increase / 255;
  }

  return sum / current.length;
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
