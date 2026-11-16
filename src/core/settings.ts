export type Scheme = 'gestures' | 'buttons';
export type QualityChoice = 'auto' | 'ultra' | 'high' | 'medium' | 'low';
export type RendererChoice = 'webgl2' | 'webgpu';

export interface Settings {
  scheme: Scheme;
  quality: QualityChoice;
  renderer: RendererChoice;
  timeOfDay: number; // Stunden, 6.0 – 20.5
  battery: boolean;
  showFps: boolean;
  installHintSeen: boolean;
}

const KEY = 'seg.settings.v1';

const DEFAULTS: Settings = {
  scheme: 'gestures',
  quality: 'auto',
  renderer: 'webgl2',
  timeOfDay: 16.5,
  battery: false,
  showFps: false,
  installHintSeen: false,
};

// localStorage kann in manchen Kontexten werfen (privater Modus) -> immer abfangen
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* Standardwerte nutzen */
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* nicht speicherbar, egal */
  }
}
