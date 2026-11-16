import type { Scheme } from '../core/settings';
import type { Dir } from '../game/fighter';

export type Action =
  | { type: 'light' }
  | { type: 'heavy' }
  | { type: 'guard'; dir: Dir }
  | { type: 'parry'; dir?: Dir }
  | { type: 'bash' }
  | { type: 'roll'; dir: 'left' | 'right' | 'back' | 'forward' | 'stick' }
  | { type: 'lock' }
  | { type: 'cheer' };

interface RightTouch {
  x0: number;
  y0: number;
  x: number;
  y: number;
  t0: number;
  moved: boolean; // als Richtungs- oder Kamerazug erkannt
  heavyFired: boolean;
  multi: boolean; // Teil einer Zwei-Finger-Geste
  lastGuard: Dir | null;
}

const HOLD_MS = 300;
const FLICK_MS = 200;

/**
 * Touch-Steuerung für das Querformat.
 * Linke Hälfte: schwebender Stick.
 * Rechte Hälfte, Schema A (aufgeschaltet): Daumen schieben = Deckung (oben/links/rechts), tippen = leichter Angriff,
 * halten = schwerer Angriff, schnell wischen = Parade in diese Richtung, nach unten wischen = Ausweichen,
 * zwei Finger tippen = Deckung brechen. Nicht aufgeschaltet: ziehen = Kamera.
 * Schema B: Tasten im HUD, rechte freie Fläche = Kamera.
 */
export class TouchInput {
  move = { x: 0, y: 0 };
  camDelta = { x: 0, y: 0 };
  scheme: Scheme;
  /** wird vom Spiel gesetzt */
  locked = false;
  private queue: Action[] = [];

  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private readonly stickRadius = 58;
  private right = new Map<number, RightTouch>();
  private holdTimer: number | null = null;

  constructor(
    el: HTMLElement,
    private readonly stickBase: HTMLElement,
    private readonly stickKnob: HTMLElement,
    scheme: Scheme,
  ) {
    this.scheme = scheme;
    el.addEventListener('pointerdown', (e) => this.down(e), { passive: false });
    window.addEventListener('pointermove', (e) => this.moveEv(e), { passive: false });
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    this.bindKeyboard();
  }

  /** Tastatur nur zum Testen am Rechner */
  private bindKeyboard(): void {
    const keys = new Set<string>();
    const updateKeys = () => {
      const x = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
      const y = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
      const l = Math.hypot(x, y) || 1;
      const sprint = keys.has('shift') ? 1 : 0.6;
      this.move.x = (x / l) * sprint;
      this.move.y = (y / l) * sprint;
    };
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (e.repeat) return;
      keys.add(k);
      const map: Record<string, Action> = {
        j: { type: 'light' },
        k: { type: 'heavy' },
        i: { type: 'guard', dir: 'top' },
        u: { type: 'guard', dir: 'left' },
        o: { type: 'guard', dir: 'right' },
        l: { type: 'parry' },
        ' ': { type: 'roll', dir: 'stick' },
        e: { type: 'bash' },
        tab: { type: 'lock' },
      };
      if (map[k]) {
        e.preventDefault();
        this.push(map[k]);
      }
      updateKeys();
    });
    window.addEventListener('keyup', (e) => {
      keys.delete(e.key.toLowerCase());
      updateKeys();
    });
  }

  push(a: Action): void {
    this.queue.push(a);
  }

  takeActions(): Action[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  takeCamDelta(): { x: number; y: number } {
    const d = { ...this.camDelta };
    this.camDelta.x = 0;
    this.camDelta.y = 0;
    return d;
  }

  private isLeft(x: number): boolean {
    return x < window.innerWidth * 0.45;
  }

  /** Richtung eines Zugs: oben, links, rechts oder unten */
  private static dirOf(dx: number, dy: number): Dir | 'down' {
    if (dy < 0 && -dy > Math.abs(dx) * 0.75) return 'top';
    if (dy > 0 && dy > Math.abs(dx) * 1.2) return 'down';
    return dx < 0 ? 'left' : 'right';
  }

  private get gestureMode(): boolean {
    return this.scheme === 'gestures';
  }

  private down(e: PointerEvent): void {
    e.preventDefault();
    if (this.isLeft(e.clientX)) {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickBase.style.left = `${e.clientX}px`;
      this.stickBase.style.top = `${e.clientY}px`;
      this.stickKnob.style.transform = 'translate(0px, 0px)';
      this.stickBase.classList.add('on');
      return;
    }
    const now = performance.now();
    const t: RightTouch = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: now, moved: false, heavyFired: false, multi: false, lastGuard: null };
    this.right.set(e.pointerId, t);
    if (!this.gestureMode) {
      t.moved = true; // Schema B: rechte Fläche nur Kamera
      return;
    }
    // Zwei Finger kurz hintereinander = Deckung brechen
    if (this.right.size === 2) {
      const others = [...this.right.values()];
      if (others.every((o) => !o.moved && now - o.t0 < 260)) {
        for (const o of others) o.multi = true;
        this.clearHold();
        this.push({ type: 'bash' });
        return;
      }
    }
    this.clearHold();
    const id = e.pointerId;
    this.holdTimer = window.setTimeout(() => {
      const p = this.right.get(id);
      if (p && !p.moved && !p.multi && Math.hypot(p.x - p.x0, p.y - p.y0) < 16) {
        p.heavyFired = true;
        this.push({ type: 'heavy' });
      }
    }, HOLD_MS);
  }

  private clearHold(): void {
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }

  private moveEv(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      const dx = e.clientX - this.stickOrigin.x;
      const dy = e.clientY - this.stickOrigin.y;
      const l = Math.hypot(dx, dy);
      const k = l > this.stickRadius ? this.stickRadius / l : 1;
      this.stickKnob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const m = Math.min(1, l / this.stickRadius);
      const dead = 0.12;
      const mag = m < dead ? 0 : (m - dead) / (1 - dead);
      this.move.x = l > 0 ? (dx / l) * mag : 0;
      this.move.y = l > 0 ? (-dy / l) * mag : 0;
      return;
    }
    const p = this.right.get(e.pointerId);
    if (!p || p.multi) return;
    const ddx = e.clientX - p.x;
    const ddy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const dx = p.x - p.x0;
    const dy = p.y - p.y0;
    const dist = Math.hypot(dx, dy);
    if (this.gestureMode && this.locked) {
      // Deckung über die Zugrichtung
      if (dist > 22) {
        p.moved = true;
        this.clearHold();
        const d = TouchInput.dirOf(dx, dy);
        if (d !== 'down' && d !== p.lastGuard) {
          p.lastGuard = d;
          this.push({ type: 'guard', dir: d });
        }
      }
      return;
    }
    // Kamera
    if (!p.moved && dist > 16 && (performance.now() - p.t0 > 160 || !this.gestureMode)) {
      p.moved = true;
      this.clearHold();
    }
    if (p.moved) {
      this.camDelta.x += ddx;
      this.camDelta.y += ddy;
    }
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.move.x = 0;
      this.move.y = 0;
      this.stickBase.classList.remove('on');
      return;
    }
    const p = this.right.get(e.pointerId);
    if (!p) return;
    this.right.delete(e.pointerId);
    if (!this.gestureMode || p.multi) return;
    this.clearHold();
    if (p.heavyFired) return;
    const dx = p.x - p.x0;
    const dy = p.y - p.y0;
    const dist = Math.hypot(dx, dy);
    const age = performance.now() - p.t0;
    if (dist < 16) {
      // Tippen = leicht, lange gehalten (falls der Timer nicht dran kam) = schwer
      this.push({ type: age < HOLD_MS ? 'light' : 'heavy' });
      return;
    }
    if (age < FLICK_MS && dist > 50) {
      const d = TouchInput.dirOf(dx, dy);
      if (d === 'down') this.push({ type: 'roll', dir: 'stick' });
      else if (this.locked) this.push({ type: 'parry', dir: d });
      else if (d === 'left' || d === 'right') this.push({ type: 'roll', dir: d });
    }
  }
}

/** Tasten für Schema B und die gemeinsamen Tasten */
export function bindButtons(root: HTMLElement, input: TouchInput): void {
  const btn = (sel: string) => root.querySelector<HTMLButtonElement>(sel);
  const press = (b: HTMLButtonElement, fn: () => void) => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.classList.add('pressed');
      fn();
    });
    const up = () => b.classList.remove('pressed');
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  };

  // Schlag: tippen = leicht, halten = schwer
  const attack = btn('#btn-attack')!;
  let t0 = 0;
  let timer: number | null = null;
  let fired = false;
  attack.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    attack.classList.add('pressed');
    t0 = performance.now();
    fired = false;
    timer = window.setTimeout(() => {
      fired = true;
      input.push({ type: 'heavy' });
    }, HOLD_MS);
  });
  const attackUp = () => {
    if (!attack.classList.contains('pressed')) return;
    attack.classList.remove('pressed');
    if (timer !== null) window.clearTimeout(timer);
    if (!fired) input.push({ type: performance.now() - t0 < HOLD_MS ? 'light' : 'heavy' });
  };
  attack.addEventListener('pointerup', attackUp);
  attack.addEventListener('pointercancel', attackUp);
  attack.addEventListener('pointerleave', attackUp);

  for (const d of ['top', 'left', 'right'] as Dir[]) {
    const b = btn(`#btn-g-${d}`);
    if (b) press(b, () => input.push({ type: 'guard', dir: d }));
  }
  press(btn('#btn-parry')!, () => input.push({ type: 'parry' }));
  press(btn('#btn-bash')!, () => input.push({ type: 'bash' }));
  press(btn('#btn-roll')!, () => input.push({ type: 'roll', dir: 'stick' }));
  const lock = document.getElementById('btn-lock') as HTMLButtonElement | null;
  if (lock) press(lock, () => input.push({ type: 'lock' }));
}
