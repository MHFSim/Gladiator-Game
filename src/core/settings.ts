export type Scheme = 'gestures' | 'buttons';
export type QualityChoice = 'auto' | 'ultra' | 'high' | 'medium' | 'low';
export type RendererChoice = 'webgl2' | 'webgpu';

export interface Settings {
  scheme: Scheme;
  quality: QualityChoice;
  renderer: RendererChoice;
  timeOfDay: number; // Stunden, 6.0 – 20.5
  battery: boolean;
  sound: boolean;
  gore: 'full' | 'reduced' | 'off';
  arena: 'capua' | 'colosseum';
  weather: 'random' | 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';
  showFps: boolean;
  installHintSeen: boolean;
  difficulty: number; // 0..4
  blockAssist: 'off' | 'show' | 'auto';
  /** Arenaleben: Fallen, Ereignisse, Bestien */
  life: boolean;
}

const KEY = 'seg.settings.v1';

const DEFAULTS: Settings = {
  scheme: 'gestures',
  quality: 'auto',
  renderer: 'webgl2',
  timeOfDay: 18.2,
  battery: false,
  sound: true,
  gore: 'full',
  arena: 'capua',
  weather: 'random',
  showFps: false,
  installHintSeen: false,
  difficulty: 1,
  blockAssist: 'show',
  life: true,
};

// localStorage kann in manchen Kontexten werfen (privater Modus) -> immer abfangen
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULTS, ...JSON.parse(raw) } as Settings & { v6?: boolean };
      // Version 6: neuer Standard ist die goldene Abendstunde (nur wenn noch die alte Standardzeit eingestellt war)
      if (!s.v6) {
        if (s.timeOfDay === 16.5) s.timeOfDay = 18.2;
        s.v6 = true;
      }
      return s;
    }
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
