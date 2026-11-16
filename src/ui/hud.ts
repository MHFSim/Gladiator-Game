import type { Vector3 } from '@babylonjs/core';
import type { Settings } from '../core/settings';
import type { GuardInfo } from '../game/game';
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
    private readonly hooks: {
      onScheme: (s: Settings['scheme']) => void;
      onTime: (h: number) => void;
      onPause: (paused: boolean) => void;
      onAssist: (m: Settings['blockAssist']) => void;
      project: (world: Vector3) => { x: number; y: number } | null;
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
    const assist = $<HTMLSelectElement>('set-assist');
    assist.value = settings.blockAssist;
    assist.addEventListener('change', () => {
      settings.blockAssist = assist.value as Settings['blockAssist'];
      saveSettings(settings);
      hooks.onAssist(settings.blockAssist);
    });
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
      });
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
      this.hint('Rechts Daumen schieben: Deckung · tippen: Schlag · halten: schwer', 5);
      window.setTimeout(() => this.hint('Schnell wischen: Parade · nach unten: Rolle · zwei Finger: Deckung brechen', 5), 5200);
      window.setTimeout(() => this.hint('Roter Ring = Angriff kommt · grün = du blockst · JETZT = parieren', 5), 10400);
    } else {
      this.hint('Pfeile: Deckung · Schlag tippen/halten · Parade im richtigen Moment', 5);
      window.setTimeout(() => this.hint('Roter Ring = Angriff kommt · grün = du blockst · JETZT = parieren', 5), 5200);
    }
  }

  setBars(hp: number, st: number, exhausted: boolean): void {
    this.hpFill.style.width = `${hp}%`;
    this.stFill.style.width = `${st}%`;
    this.stFill.style.opacity = exhausted ? String(0.4 + 0.4 * Math.abs(Math.sin(performance.now() / 120))) : '1';
  }

  private gw = $('guard-widget');
  private gwParts = {
    top: this.gw.querySelector<HTMLElement>('.gw-top')!,
    left: this.gw.querySelector<HTMLElement>('.gw-left')!,
    right: this.gw.querySelector<HTMLElement>('.gw-right')!,
  };
  private ring = this.gw.querySelector<HTMLElement>('.gw-ring')!;
  private foeHp = $('foe-hp-fill');
  private foeSt = $('foe-st-fill');
  private dirButtons = {
    top: document.getElementById('btn-g-top'),
    left: document.getElementById('btn-g-left'),
    right: document.getElementById('btn-g-right'),
  };

  guard(info: GuardInfo | null): void {
    if (!info) {
      this.gw.hidden = true;
      return;
    }
    const p = this.hooks.project(info.anchor);
    if (!p) {
      this.gw.hidden = true;
      return;
    }
    this.gw.hidden = false;
    this.gw.style.transform = `translate(${p.x}px, ${p.y}px)`;
    for (const k of ['top', 'left', 'right'] as const) {
      const el = this.gwParts[k];
      el.classList.toggle('mine', info.mine === k);
      el.classList.toggle('foe', info.foe === k);
      el.classList.toggle('incoming', info.incoming === k);
      el.classList.toggle('heavy', info.incoming === k && info.heavy);
      this.dirButtons[k]?.classList.toggle('active', info.mine === k);
    }
    // Ring schrumpft bis zum Treffer: rot = falsche Deckung, grün = wird geblockt, gold = jetzt parieren
    if (info.incoming && info.impactIn !== null) {
      const pos = { top: [62, 13], left: [13, 62], right: [111, 62] }[info.incoming];
      const k = Math.max(0, Math.min(1, info.impactIn / info.windup));
      this.ring.hidden = false;
      this.ring.style.left = `${pos[0]}px`;
      this.ring.style.top = `${pos[1]}px`;
      this.ring.style.transform = `scale(${0.8 + 1.8 * k})`;
      this.ring.classList.toggle('covered', info.mine === info.incoming);
      this.ring.classList.toggle('now', info.impactIn <= info.parryWindow);
    } else {
      this.ring.hidden = true;
    }
    this.foeHp.style.width = `${info.foeHp}%`;
    this.foeSt.style.width = `${info.foeSt}%`;
  }

  floatText(world: Vector3, text: string, kind: 'good' | 'bad' | 'big' | '' = ''): void {
    const p = this.hooks.project(world);
    if (!p) return;
    const el = document.createElement('div');
    el.className = 'float ' + kind + (kind === 'big' ? ' good' : '');
    el.textContent = text;
    el.style.left = `${p.x + (Math.random() - 0.5) * 30}px`;
    el.style.top = `${p.y}px`;
    $('float-layer').appendChild(el);
    window.setTimeout(() => el.remove(), 1000);
  }

  score(player: number, foe: number): void {
    $('score').textContent = player + foe > 0 ? `${player} : ${foe}` : '';
  }

  foeName(text: string): void {
    $('foe-name').textContent = text;
  }

  setLocked(on: boolean): void {
    $('btn-lock').classList.toggle('on', on);
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
