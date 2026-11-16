import type { Settings } from '../core/settings';
import { saveSettings } from '../core/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  private hintTimer: number | null = null;
  private hpFill = $('hp-fill');
  private stFill = $('st-fill');
  private fpsEl = $('fps');
  private hintEl = $('hint');

  constructor(
    private readonly settings: Settings,
    hooks: {
      onScheme: (s: Settings['scheme']) => void;
      onTime: (h: number) => void;
      onPause: (paused: boolean) => void;
      rendererLabel: string;
      tierLabel: string;
    },
  ) {
    const hud = $('hud');
    hud.hidden = false;
    this.applyScheme();

    const panel = $('settings');
    const scheme = $<HTMLSelectElement>('set-scheme');
    const quality = $<HTMLSelectElement>('set-quality');
    const renderer = $<HTMLSelectElement>('set-renderer');
    const time = $<HTMLInputElement>('set-time');
    const battery = $<HTMLInputElement>('set-battery');
    const fps = $<HTMLInputElement>('set-fps');
    const timeLabel = $('time-label');
    const help = $('help-text');

    scheme.value = settings.scheme;
    quality.value = settings.quality;
    renderer.value = settings.renderer;
    time.value = String(settings.timeOfDay);
    battery.checked = settings.battery;
    fps.checked = settings.showFps;
    const fmt = (h: number) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')} Uhr`;
    timeLabel.textContent = fmt(settings.timeOfDay);
    help.textContent = `Läuft mit ${hooks.rendererLabel}, Grafikstufe ${hooks.tierLabel}. Grafik- und Renderer-Wechsel laden das Spiel neu.`;

    $('btn-settings').addEventListener('click', () => {
      panel.hidden = false;
      hooks.onPause(true);
    });
    $('btn-close-settings').addEventListener('click', () => {
      panel.hidden = true;
      hooks.onPause(false);
    });
    scheme.addEventListener('change', () => {
      settings.scheme = scheme.value as Settings['scheme'];
      saveSettings(settings);
      this.applyScheme();
      hooks.onScheme(settings.scheme);
      this.showControlsHint();
    });
    const reload = () => {
      saveSettings(settings);
      location.reload();
    };
    quality.addEventListener('change', () => {
      settings.quality = quality.value as Settings['quality'];
      reload();
    });
    renderer.addEventListener('change', () => {
      settings.renderer = renderer.value as Settings['renderer'];
      reload();
    });
    time.addEventListener('input', () => {
      settings.timeOfDay = parseFloat(time.value);
      timeLabel.textContent = fmt(settings.timeOfDay);
      hooks.onTime(settings.timeOfDay);
    });
    time.addEventListener('change', () => saveSettings(settings));
    battery.addEventListener('change', () => {
      settings.battery = battery.checked;
      saveSettings(settings);
    });
    fps.addEventListener('change', () => {
      settings.showFps = fps.checked;
      if (!fps.checked) this.fpsEl.textContent = '';
      saveSettings(settings);
    });

    // Hinweis zur Web-App-Installation (nur iPhone/iPad im Browser)
    const standalone =
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: standalone)').matches;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (ios && !standalone && !settings.installHintSeen) {
      const ins = $('install');
      ins.hidden = false;
      $('btn-close-install').addEventListener('click', () => {
        ins.hidden = true;
        settings.installHintSeen = true;
        saveSettings(settings);
        this.showControlsHint();
      });
    } else {
      this.showControlsHint();
    }
  }

  onCheer(fn: () => void): void {
    $('btn-cheer').addEventListener('click', fn);
  }

  private applyScheme(): void {
    $('hud').classList.toggle('scheme-buttons', this.settings.scheme === 'buttons');
  }

  showControlsHint(): void {
    if (this.settings.scheme === 'gestures') {
      this.hint('Links ziehen: laufen · Rechts tippen: Schlag · Halten: schwerer Schlag', 4.5);
      window.setTimeout(() => this.hint('Wischen: Rolle · nach oben: Schildstoß · Zwei Finger: Block', 4.5), 4800);
    } else {
      this.hint('Links ziehen: laufen · Rechts wischen: Kamera · Tasten: kämpfen', 5);
    }
  }

  setBars(hp: number, st: number): void {
    this.hpFill.style.width = `${hp}%`;
    this.stFill.style.width = `${st}%`;
  }

  setFps(fps: number): void {
    if (this.settings.showFps) this.fpsEl.textContent = `${Math.round(fps)} FPS`;
  }

  hint(text: string, seconds = 2): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.add('show');
    if (this.hintTimer !== null) window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hintEl.classList.remove('show'), seconds * 1000);
  }
}
