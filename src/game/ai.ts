import { Vector3 } from '@babylonjs/core';
import { blockSideFor, COMBAT, type ActiveAttack, type Dir, type Fighter } from './fighter';

export interface AiLevel {
  name: string;
  react: number;
  block: number;
  parry: number;
  aggression: number;
  feint: number;
  bash: number;
  dodge: number;
  exploit: number;
}

const DIRS: Dir[] = ['top', 'left', 'right'];
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

/**
 * KI-Gegner: hält Abstand, umkreist, greift mit Ankündigung an, reagiert mit menschlicher Verzögerung.
 * Spielt nach denselben Regeln wie der Spieler.
 */
export class AiController {
  level: AiLevel;
  private nextAttack = 2;
  private nextGuard = 1;
  private pending: { at: number; fn: () => void }[] = [];
  private strafe = 1;
  private nextStrafe = 2;
  private foeGuardSince = 0;
  private lastFoeGuard: Dir = 'top';

  constructor(
    private readonly self: Fighter,
    private readonly foe: Fighter,
    levelIndex: number,
  ) {
    this.level = COMBAT.ai[Math.max(0, Math.min(COMBAT.ai.length - 1, levelIndex))];
  }

  setLevel(i: number): void {
    this.level = COMBAT.ai[Math.max(0, Math.min(COMBAT.ai.length - 1, i))];
  }

  private schedule(at: number, fn: () => void): void {
    this.pending.push({ at, fn });
  }

  reset(now: number): void {
    this.pending = [];
    this.nextAttack = now + 1.5 + Math.random();
  }

  /** Der Spieler beginnt einen Angriff: reagieren wie ein Mensch, also mit Verzögerung */
  onFoeAttack(a: ActiveAttack, now: number): void {
    const L = this.level;
    const need = blockSideFor(a.dir);
    const react = L.react * (0.8 + Math.random() * 0.45);
    const r = Math.random();
    const timeLeft = a.impactAt - now;
    if (r < L.parry && timeLeft > react + 0.1) {
      // Parade kurz vor dem Treffer
      const at = a.impactAt - 0.1 - Math.random() * 0.08;
      // Einmal entschieden, wird pariert – auch wenn der Spieler eine Finte macht
      this.schedule(at, () => this.self.parry(need));
    } else if (r < L.parry + L.block) {
      this.schedule(now + react, () => this.self.setGuard(need));
    } else if (r < L.parry + L.block + L.dodge && timeLeft > react) {
      this.schedule(now + react, () => {
        if (this.foe.attack !== a) return;
        const away = this.self.pos.subtract(this.foe.pos).normalize();
        const side = new Vector3(away.z, 0, -away.x).scale(Math.random() < 0.5 ? 1 : -1);
        this.self.roll(side.add(away.scale(0.4)));
      });
    }
  }

  onFoeFeint(): void {
    // Eine geplante Parade läuft ins Leere – die Strafe dafür ist die Sperrzeit der Parade
  }

  /** Liefert die gewünschte Bewegung (Richtung, Geschwindigkeit) */
  update(now: number): { dir: Vector3; speed: number } {
    const self = this.self;
    const foe = this.foe;
    const L = this.level;
    // Geplante Reaktionen ausführen
    const due = this.pending.filter((p) => p.at <= now);
    this.pending = this.pending.filter((p) => p.at > now);
    for (const p of due) p.fn();

    if (self.mode === 'dead' || foe.mode === 'dead') return { dir: Vector3.Zero(), speed: 0 };

    const toFoe = foe.pos.subtract(self.pos);
    toFoe.y = 0;
    const dist = toFoe.length();
    const fwd = dist > 1e-3 ? toFoe.scale(1 / dist) : new Vector3(0, 0, 1);
    const side = new Vector3(fwd.z, 0, -fwd.x);

    // Merken, wie lange der Spieler dieselbe Deckung hält (Verteidiger, die nur blocken, werden gebrochen)
    if (foe.guard !== this.lastFoeGuard) {
      this.lastFoeGuard = foe.guard;
      this.foeGuardSince = now;
    }

    // Bestrafen: Gegner wankt oder ist gebrochen -> sofort schwer zuschlagen
    if ((foe.mode === 'stagger' || foe.mode === 'hit' || foe.mode === 'parry') && self.canAct && dist < 2.4 && Math.random() < L.exploit * 0.08) {
      this.attackSmart(true);
    }

    // Deckung wechseln, wenn nichts los ist
    if (now >= this.nextGuard && self.mode === 'free' && !foe.attack) {
      self.setGuard(pick(DIRS));
      this.nextGuard = now + 1.2 + Math.random() * 2.2;
    }

    // Angreifen
    const tired = self.g.stamina < 25;
    if (!tired && now >= this.nextAttack && self.canAct && dist < 2.6) {
      const turtle = now - this.foeGuardSince > 1.6 && foe.mode === 'free';
      if (turtle && Math.random() < L.bash * 2) self.bash();
      else this.attackSmart(Math.random() < 0.3);
      this.nextAttack = now + (1.0 + Math.random() * 2.2) * (1.35 - L.aggression);
    }

    // Abstand halten und umkreisen
    if (now >= this.nextStrafe) {
      this.strafe = Math.random() < 0.5 ? -1 : 1;
      this.nextStrafe = now + 1.5 + Math.random() * 2.5;
    }
    let dir = Vector3.Zero();
    let speed = 0;
    if (dist > 2.7) {
      dir = fwd;
      speed = dist > 5 ? 3.2 : 1.6;
    } else if (dist < 1.5 || tired) {
      dir = fwd.scale(-1).add(side.scale(this.strafe * 0.4)).normalize();
      speed = tired ? 1.6 : 1.0;
    } else if (self.mode === 'free') {
      dir = side.scale(this.strafe);
      speed = 0.75;
    }
    return { dir, speed };
  }

  private attackSmart(heavy: boolean): void {
    const L = this.level;
    // Richtung bevorzugt dort, wo der Spieler gerade NICHT blockt
    let dir: Dir = pick(DIRS);
    if (Math.random() < L.exploit) {
      const open = DIRS.filter((d) => blockSideFor(d) !== this.foe.guard);
      dir = pick(open);
    }
    if (!this.self.startAttack(dir, heavy)) return;
    const a = this.self.attack;
    if (a && heavy && Math.random() < L.feint) {
      // Finte: kurz vor dem Treffer abbrechen und schnell leicht nachsetzen
      this.schedule(a.impactAt - COMBAT.feint.latest - 0.12, () => {
        if (this.self.feint()) {
          this.schedule(this.self.now + 0.12, () => this.self.startAttack(pick(DIRS), false));
        }
      });
    }
  }
}
