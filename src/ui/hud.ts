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
      onSound: (on: boolean) => void;
      onWeather: (w: Settings['weather']) => void;
      onGore: (g: Settings['gore']) => void;
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
    if (settings.blockAssist === 'auto') settings.blockAssist = 'show';
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
    const gsel = $<HTMLSelectElement>('set-gore');
    gsel.value = settings.gore;
    gsel.addEventListener('change', () => {
      settings.gore = gsel.value as Settings['gore'];
      saveSettings(settings);
      hooks.onGore(settings.gore);
    });
    const wsel = $<HTMLSelectElement>('set-weather');
    wsel.value = settings.weather;
    wsel.addEventListener('change', () => {
      settings.weather = wsel.value as Settings['weather'];
      saveSettings(settings);
      hooks.onWeather(settings.weather);
    });
    const snd = $<HTMLInputElement>('set-sound');
    snd.checked = settings.sound;
    snd.addEventListener('change', () => {
      settings.sound = snd.checked;
      saveSettings(settings);
      hooks.onSound(snd.checked);
    });
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
      this.hint('Rechts tippen: Schlag (3er-Kombo) · halten: Wuchtschlag · wischen: Ausweichen', 5);
      window.setTimeout(() => this.hint('Block halten · bei JETZT drücken = Parade · zwei Finger: Schildstoß', 5), 5200);
      window.setTimeout(() => this.hint('Wuchtschläge brechen den Block – ausweichen oder parieren!', 5), 10400);
    } else {
      this.hint('Schlag tippen: Kombo · halten: Wuchtschlag · Block halten', 5);
      window.setTimeout(() => this.hint('Block bei JETZT drücken = Parade · Stoß bricht jeden Block', 5), 5200);
      window.setTimeout(() => this.hint('Wuchtschläge brechen den Block – ausweichen oder parieren!', 5), 10400);
    }
  }

  setBars(hp: number, st: number, exhausted: boolean): void {
    this.hpFill.style.width = `${hp}%`;
    this.stFill.style.width = `${st}%`;
    this.stFill.style.opacity = exhausted ? String(0.4 + 0.4 * Math.abs(Math.sin(performance.now() / 120))) : '1';
  }

  private gw = $('guard-widget');
  private ring = this.gw.querySelector<HTMLElement>('.gw-ring')!;
  private ringLabel = this.ring.querySelector('span')!;
  private foeHp = $('foe-hp-fill');
  private foeSt = $('foe-st-fill');
  private blockBtn = $('btn-block');

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
    this.blockBtn.classList.toggle('active', info.blocking);
    // Ring schrumpft bis zum Treffer. Gold mit JETZT = Block drücken für die Parade.
    if (info.incoming && info.impactIn !== null) {
      const k = Math.max(0, Math.min(1, info.impactIn / info.windup));
      this.ring.hidden = false;
      this.ring.style.left = '62px';
      this.ring.style.top = '62px';
      this.ring.style.transform = `scale(${0.8 + 1.8 * k})`;
      const now = info.impactIn <= info.parryWindow;
      this.ring.classList.toggle('now', now);
      this.ring.classList.toggle('heavy', info.heavy && !now);
      this.ring.classList.toggle('covered', info.blocking && !info.heavy && !now);
      this.ringLabel.textContent = now ? 'JETZT' : info.heavy ? 'WUCHT' : '';
      this.ring.classList.toggle('label', now || info.heavy);
    } else {
      this.ring.hidden = true;
    }
    this.foeHp.style.width = `${info.foeHp}%`;
    this.foeSt.style.width = `${info.foeSt}%`;
    this.gw.classList.toggle('foe-blocking', info.foeBlocking);
  }

  private specialBtn = $('btn-special');
  special(name: string | null, left: number, total: number): void {
    const b = this.specialBtn;
    if (!name) {
      b.hidden = true;
      return;
    }
    b.hidden = false;
    const ready = left <= 0;
    const label = ready ? name : `${Math.ceil(left)} s`;
    if (b.textContent !== label) b.textContent = label;
    b.classList.toggle('ready', ready);
    b.classList.toggle('cooldown', !ready);
    b.style.setProperty('--cd', `${Math.round((1 - left / total) * 100)}%`);
  }

  private splats: string[] = [];

  /** Bildschirmposition eines Weltpunkts */
  project(world: Vector3): { x: number; y: number } | null {
    return this.hooks.project(world);
  }

  private markEls: HTMLElement[] = [];

  /** Namen und Leben über den anderen Kämpfern (ab 3 Kämpfern) */
  marks(list: { x: number; y: number; hp: number; ally: boolean; name: string }[]): void {
    const box = $('marks');
    while (this.markEls.length < list.length) {
      const el = document.createElement('div');
      el.className = 'mark';
      el.innerHTML = '<span></span><b><i></i></b>';
      box.appendChild(el);
      this.markEls.push(el);
    }
    this.markEls.forEach((el, i) => {
      const m = list[i];
      el.hidden = !m;
      if (!m) return;
      el.style.left = `${m.x}px`;
      el.style.top = `${m.y}px`;
      el.classList.toggle('ally', m.ally);
      const span = el.firstElementChild as HTMLElement;
      if (span.textContent !== m.name) span.textContent = m.name;
      (el.querySelector('i') as HTMLElement).style.width = `${Math.max(0, Math.min(100, m.hp))}%`;
    });
  }

  /** Blutspritzer auf der Kamera (laufen langsam herunter) */
  screenBlood(amount: number): void {
    if (amount <= 0.05) return;
    if (!this.splats.length) this.splats = makeSplats();
    const box = $('screen-blood');
    const n = 1 + Math.round(amount * 2.5);
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'splat';
      const size = 110 + Math.random() * 230 * amount;
      const edge = Math.random();
      const x = edge < 0.5 ? (Math.random() < 0.5 ? -0.1 : 0.75) * window.innerWidth + Math.random() * 120 : Math.random() * window.innerWidth;
      const y = edge >= 0.5 ? (Math.random() < 0.5 ? -0.1 : 0.6) * window.innerHeight + Math.random() * 80 : Math.random() * window.innerHeight * 0.8;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.width = el.style.height = `${size}px`;
      el.style.backgroundImage = `url(${this.splats[Math.floor(Math.random() * this.splats.length)]})`;
      el.style.opacity = String(Math.min(0.92, 0.45 + amount * 0.5));
      el.style.transform = `rotate(${Math.random() * 360}deg)`;
      box.appendChild(el);
      window.setTimeout(() => el.remove(), 3200);
    }
  }

  /** Bildschirm-Blitz und Vibration */
  flash(kind: 'hurt' | 'parry' | 'strike'): void {
    const el = $('hurt-flash');
    el.className = '';
    void el.offsetWidth;
    el.className = kind;
    const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
    try {
      if (kind === 'hurt') nav.vibrate?.(55);
      else if (kind === 'parry') nav.vibrate?.([20, 30, 40]);
      else nav.vibrate?.(25);
    } catch {
      /* nicht unterstützt */
    }
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

  score(text: string): void {
    const el = $('score');
    if (el.textContent !== text) el.textContent = text;
  }

  private favFill = $('fav-fill');
  private favFoe = $('fav-foe');
  favor(mine: number, foe: number): void {
    this.favFill.style.width = `${mine}%`;
    this.favFoe.style.left = `${foe}%`;
    this.favFill.classList.toggle('hot', mine >= 80);
    this.favFill.classList.toggle('cold', mine <= 20);
  }

  vote(p: number | null, label = ''): void {
    const el = $('vote');
    if (p === null) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    $('vote-label').textContent = label;
    // p = Anteil für Gnade: Nadel links (Missio) bei p = 1
    $('vote-needle').style.left = `${(1 - p) * 100}%`;
  }

  thumb(v: 'missio' | 'iugula' | null): void {
    const el = $('thumb');
    if (!v) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.className = v;
    $('thumb-text').textContent = v === 'missio' ? 'MISSIO – Gnade!' : 'IUGULA!';
  }

  cinematic(on: boolean): void {
    $('hud').classList.toggle('cine', on);
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

/** Blutspritzer-Bilder für die Kamera (einmal erzeugt) */
function makeSplats(): string[] {
  const out: string[] = [];
  for (let k = 0; k < 4; k++) {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d')!;
    const blob = (x: number, y: number, r: number, a: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(95,0,0,${a})`);
      g.addColorStop(0.7, `rgba(120,4,4,${a * 0.9})`);
      g.addColorStop(1, 'rgba(120,4,4,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    };
    blob(S / 2, S / 2, S * (0.16 + Math.random() * 0.08), 0.95);
    const dir = Math.random() * Math.PI * 2;
    for (let i = 0; i < 26; i++) {
      const ang = dir + (Math.random() - 0.5) * 2.2;
      const d = S * (0.08 + Math.random() * 0.36);
      blob(S / 2 + Math.cos(ang) * d, S / 2 + Math.sin(ang) * d, S * (0.01 + Math.random() * 0.045), 0.9);
    }
    // Laufspuren nach unten
    for (let i = 0; i < 4; i++) {
      const x = S / 2 + (Math.random() - 0.5) * S * 0.3;
      const y0 = S / 2;
      const len = S * (0.15 + Math.random() * 0.3);
      ctx.fillStyle = 'rgba(105,2,2,0.85)';
      ctx.fillRect(x - 2, y0, 4 + Math.random() * 3, len);
      blob(x, y0 + len, 5, 0.9);
    }
    out.push(c.toDataURL());
  }
  return out;
}
