import type { QualityChoice } from './settings';

export type Tier = 'ultra' | 'high' | 'medium' | 'low';

export interface QualityProfile {
  tier: Tier;
  /** Renderauflösung relativ zu CSS-Pixeln (Handys haben DPR 3, wir rendern weniger) */
  renderScale: number;
  shadowMapSize: number;
  cascades: number; // 1 = einfacher Schatten
  bloom: boolean;
  grain: boolean;
  dust: number; // Anzahl Staubpartikel
  fireParticles: number;
}

export const PROFILES: Record<Tier, QualityProfile> = {
  ultra: { tier: 'ultra', renderScale: 2.0, shadowMapSize: 2048, cascades: 2, bloom: true, grain: true, dust: 600, fireParticles: 260 },
  high: { tier: 'high', renderScale: 1.6, shadowMapSize: 2048, cascades: 2, bloom: true, grain: true, dust: 350, fireParticles: 180 },
  medium: { tier: 'medium', renderScale: 1.25, shadowMapSize: 1024, cascades: 2, bloom: false, grain: false, dust: 150, fireParticles: 110 },
  low: { tier: 'low', renderScale: 1.0, shadowMapSize: 1024, cascades: 1, bloom: false, grain: false, dust: 0, fireParticles: 60 },
};

export const TIER_ORDER: Tier[] = ['low', 'medium', 'high', 'ultra'];

/** Erste Schätzung, bevor die Bildrate gemessen ist. */
export function guessTier(choice: QualityChoice): Tier {
  if (choice !== 'auto') return choice;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 6;
  let t: Tier = 'low';
  if (mem >= 8 && cores >= 6) t = 'ultra';
  else if (mem >= 6) t = 'high';
  else if (mem >= 4) t = 'medium';
  // Wurde früher gemessen, dass das Gerät zu langsam ist, nicht höher starten
  try {
    const cap = localStorage.getItem('seg.autoTierCap') as Tier | null;
    if (cap && TIER_ORDER.indexOf(cap) < TIER_ORDER.indexOf(t)) t = cap;
  } catch {
    /* egal */
  }
  return t;
}

/**
 * Hält die Bildrate stabil: misst laufend und passt die Renderauflösung an.
 * Senkt zuerst die Auflösung (unsichtbar fast), erst dann die Stufe.
 */
export class DynamicResolution {
  private frames = 0;
  private time = 0;
  scale: number;

  constructor(
    private maxScale: number,
    private readonly minScale: number,
    private target: number,
    private readonly apply: (scale: number) => void,
  ) {
    this.scale = maxScale;
  }

  setLimits(maxScale: number, target: number): void {
    this.maxScale = maxScale;
    this.target = target;
    this.scale = Math.min(this.scale, maxScale);
    this.apply(this.scale);
  }

  /** dt in Sekunden; gibt die gemessene FPS zurück, wenn ein Messfenster fertig ist */
  update(dt: number): number | null {
    this.frames++;
    this.time += dt;
    if (this.time < 2) return null;
    const fps = this.frames / this.time;
    this.frames = 0;
    this.time = 0;
    if (fps < this.target * 0.88 && this.scale > this.minScale) {
      this.scale = Math.max(this.minScale, this.scale - 0.15);
      this.apply(this.scale);
    } else if (fps > this.target * 0.97 && this.scale < this.maxScale) {
      this.scale = Math.min(this.maxScale, this.scale + 0.05);
      this.apply(this.scale);
    }
    return fps;
  }
}
