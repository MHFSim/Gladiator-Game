import type { Scheme } from '../core/settings';

export type Action =
  | { type: 'light' }
  | { type: 'heavy' }
  | { type: 'blockStart' }
  | { type: 'blockEnd' }
  | { type: 'roll'; dir: 'left' | 'right' | 'back' | 'forward' }
  | { type: 'bash' }
  | { type: 'cheer' };

/**
 * Touch-Steuerung für das Querformat.
 * Linke Hälfte: schwebender Stick. Rechte Hälfte: Kamera + Gesten (Schema A) oder Kamera (Schema B, Tasten im HUD).
 */
export class TouchInput {
  move = { x: 0, y: 0 }; // x = rechts, y = vorwärts, Länge 0..1
  camDelta = { x: 0, y: 0 };
  private queue: Action[] = [];
  scheme: Scheme;

  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private readonly stickRadius = 58;

  private right = new Map<number, { x0: number; y0: number; x: number; y: number; t0: number; drag: boolean; heavyFired: boolean }>();
  private blocking = false;
  private heavyTimer: number | null = null;

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
    // Tastatur nur fürs Testen am Rechner
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
      if (k === 'j') this.push({ type: 'light' });
      if (k === 'k') this.push({ type: 'heavy' });
      if (k === 'l') this.push({ type: 'blockStart' });
      if (k === ' ') this.push({ type: 'roll', dir: 'back' });
      if (k === 'e') this.push({ type: 'bash' });
      updateKeys();
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      keys.delete(k);
      if (k === 'l') this.push({ type: 'blockEnd' });
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

  private down(e: PointerEvent): void {
    e.preventDefault();
    if (this.isLeft(e.clientX) && this.stickId === null) {
      this.stickId = e.pointerId;
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stickBase.style.left = `${e.clientX}px`;
      this.stickBase.style.top = `${e.clientY}px`;
      this.stickKnob.style.transform = 'translate(0px, 0px)';
      this.stickBase.classList.add('on');
      return;
    }
    if (this.isLeft(e.clientX)) return;
    const now = performance.now();
    this.right.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: now, drag: false, heavyFired: false });
    if (this.scheme !== 'gestures') {
      // Schema B: rechte Fläche nur Kamera
      this.right.get(e.pointerId)!.drag = true;
      return;
    }
    // Zwei Finger rechts = Block halten
    if (this.right.size === 2 && !this.blocking) {
      this.blocking = true;
      this.clearHeavy();
      this.push({ type: 'blockStart' });
      for (const p of this.right.values()) p.heavyFired = true;
      return;
    }
    // Halten = schwerer Angriff
    this.clearHeavy();
    const id = e.pointerId;
    this.heavyTimer = window.setTimeout(() => {
      const p = this.right.get(id);
      if (p && !p.drag && !this.blocking && Math.hypot(p.x - p.x0, p.y - p.y0) < 16) {
        p.heavyFired = true;
        this.push({ type: 'heavy' });
      }
    }, 320);
  }

  private clearHeavy(): void {
    if (this.heavyTimer !== null) window.clearTimeout(this.heavyTimer);
    this.heavyTimer = null;
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
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    const total = Math.hypot(p.x - p.x0, p.y - p.y0);
    const age = performance.now() - p.t0;
    if (!p.drag && total > 16 && age > 170) p.drag = true;
    if (p.drag && !this.blocking) {
      this.camDelta.x += dx;
      this.camDelta.y += dy;
    } else if (p.drag && this.blocking) {
      this.camDelta.x += dx * 0.6;
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
    if (this.scheme !== 'gestures') return;
    if (this.blocking) {
      if (this.right.size === 0) {
        this.blocking = false;
        this.push({ type: 'blockEnd' });
      }
      return;
    }
    this.clearHeavy();
    if (p.heavyFired) return;
    const dx = p.x - p.x0;
    const dy = p.y - p.y0;
    const dist = Math.hypot(dx, dy);
    const age = performance.now() - p.t0;
    if (!p.drag && dist < 16) {
      // Kurz = leicht. Lang gehalten, aber der Halte-Timer kam (z. B. bei Rucklern) nicht dran = schwer
      this.push({ type: age < 320 ? 'light' : 'heavy' });
    } else if (age < 300 && dist > 45) {
      // Wischen
      if (Math.abs(dx) > Math.abs(dy)) this.push({ type: 'roll', dir: dx > 0 ? 'right' : 'left' });
      else if (dy > 0) this.push({ type: 'roll', dir: 'back' });
      else this.push({ type: 'bash' });
    }
  }
}

/** Tasten für Schema B */
export function bindButtons(root: HTMLElement, input: TouchInput): void {
  const attack = root.querySelector<HTMLButtonElement>('#btn-attack')!;
  let attackT = 0;
  let heavyTimer: number | null = null;
  let heavyFired = false;
  attack.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    attack.classList.add('pressed');
    attackT = performance.now();
    heavyFired = false;
    heavyTimer = window.setTimeout(() => {
      heavyFired = true;
      input.push({ type: 'heavy' });
    }, 320);
  });
  const attackUp = () => {
    if (!attack.classList.contains('pressed')) return;
    attack.classList.remove('pressed');
    if (heavyTimer !== null) window.clearTimeout(heavyTimer);
    if (!heavyFired && performance.now() - attackT < 320) input.push({ type: 'light' });
  };
  attack.addEventListener('pointerup', attackUp);
  attack.addEventListener('pointercancel', attackUp);
  attack.addEventListener('pointerleave', attackUp);

  const block = root.querySelector<HTMLButtonElement>('#btn-block')!;
  block.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    block.classList.add('pressed');
    input.push({ type: 'blockStart' });
  });
  const blockUp = () => {
    if (!block.classList.contains('pressed')) return;
    block.classList.remove('pressed');
    input.push({ type: 'blockEnd' });
  };
  block.addEventListener('pointerup', blockUp);
  block.addEventListener('pointercancel', blockUp);
  block.addEventListener('pointerleave', blockUp);

  const simple = (sel: string, a: Action) => {
    const b = root.querySelector<HTMLButtonElement>(sel)!;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      input.push(a);
    });
  };
  simple('#btn-roll', { type: 'roll', dir: 'back' });
  simple('#btn-bash', { type: 'bash' });
}
