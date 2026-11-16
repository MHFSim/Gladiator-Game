import { Vector3 } from '@babylonjs/core';
import { COMBAT, type ActiveAttack, type Fighter } from './fighter';

export interface AiLevel {
  name: string;
  react: number;
  block: number;
  parry: number;
  dodge: number;
  aggression: number;
  combo: number;
  heavy: number;
  bash: number;
  punish: number;
}

/**
 * KI-Gegner nach denselben Regeln wie der Spieler:
 * hält Abstand, umkreist, greift mit Kombos an, blockt, pariert mit menschlicher Verzögerung,
 * bricht Spieler, die nur blocken, mit dem Schildstoß auf und bestraft Fehler.
 */
export class AiController {
  level: AiLevel;
  private nextAttack = 2;
  private pending: { at: number; fn: () => void }[] = [];
  private strafe = 1;
  private nextStrafe = 2;
  private foeBlockSince = -1;
  private comboLeft = 0;
  private releaseBlockAt = 0;
  /** Sonderfähigkeit auslösen (setzt das Spiel) */
  special: (() => void) | null = null;
  specialKind = '';

  constructor(
    private readonly self: Fighter,
    private readonly foeOf: () => Fighter | null,
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
    this.comboLeft = 0;
    this.self.setBlock(false);
    this.nextAttack = now + 1.5 + Math.random();
  }

  /** Ein Gegner beginnt einen Angriff auf diese KI: reagieren wie ein Mensch, also mit Verzögerung */
  onFoeAttack(a: ActiveAttack, now: number, attacker: Fighter): void {
    const L = this.level;
    const foe = attacker;
    const react = L.react * (0.8 + Math.random() * 0.45);
    const timeLeft = a.impactAt - now;
    const r = Math.random();
    // Gegen Wuchtschläge lieber ausweichen oder parieren als blocken (Block bricht)
    const vsHeavy = a.heavy ? 1.6 : 1;
    if (r < L.parry && timeLeft > react) {
      // Parade: Block kurz vor dem Treffer frisch drücken
      const at = a.impactAt - 0.06 - Math.random() * (COMBAT.parryWindow * 0.7);
      this.schedule(at, () => {
        this.self.setBlock(false);
        this.self.setBlock(true);
        this.releaseBlockAt = a.impactAt + 0.35;
      });
    } else if (r < L.parry + L.dodge * vsHeavy && timeLeft > react + 0.05) {
      this.schedule(now + react, () => {
        if (foe.attack !== a) return;
        const away = this.self.pos.subtract(foe.pos).normalize();
        const side = new Vector3(away.z, 0, -away.x).scale(Math.random() < 0.5 ? 1 : -1);
        this.self.setBlock(false);
        this.self.roll(side.add(away.scale(0.5)));
      });
    } else if (r < L.parry + L.dodge * vsHeavy + L.block / vsHeavy && timeLeft > react) {
      this.schedule(now + react, () => {
        if (this.self.mode === 'free' || this.self.mode === 'block') {
          // Halten, ohne zu parieren (Block war schon früh oben)
          this.self.setBlock(true);
          this.self.blockStart = -10;
          this.releaseBlockAt = a.impactAt + 0.3 + Math.random() * 0.4;
        }
      });
    }
  }

  /** Liefert die gewünschte Bewegung (Richtung, Geschwindigkeit) */
  update(now: number): { dir: Vector3; speed: number } {
    const self = this.self;
    const foe = this.foeOf();
    const L = this.level;
    const due = this.pending.filter((p) => p.at <= now);
    this.pending = this.pending.filter((p) => p.at > now);
    for (const p of due) p.fn();

    if (self.mode === 'dead' || !foe || foe.mode === 'dead') {
      self.setBlock(false);
      return { dir: Vector3.Zero(), speed: 0 };
    }
    if (self.blockWanted && now >= this.releaseBlockAt) self.setBlock(false);

    const toFoe = foe.pos.subtract(self.pos);
    toFoe.y = 0;
    const dist = toFoe.length();
    const fwd = dist > 1e-3 ? toFoe.scale(1 / dist) : new Vector3(0, 0, 1);
    const side = new Vector3(fwd.z, 0, -fwd.x);
    const reach = self.kit.reach;

    // Wie lange blockt der Spieler schon?
    if (foe.blocking) {
      if (this.foeBlockSince < 0) this.foeBlockSince = now;
    } else this.foeBlockSince = -1;

    // Kombo weiterführen
    if (this.comboLeft > 0 && self.mode === 'attack' && self.canAct && dist < reach + 0.3) {
      this.comboLeft--;
      self.startAttack(false);
    }

    // Fehler bestrafen: Spieler wankt oder ist gebrochen -> sofort zuschlagen
    if ((foe.mode === 'stagger' || foe.mode === 'hit') && self.canAct && !self.blockWanted && dist < reach + 0.2 && Math.random() < L.punish * 0.1) {
      self.startAttack(Math.random() < 0.5);
      this.comboLeft = Math.random() < L.combo ? 2 : 0;
    }

    // Sonderfähigkeit, wenn sie passt
    if (self.canAct && !self.blockWanted && now >= self.specialReadyAt && Math.random() < 0.02 + L.aggression * 0.02) {
      const k = this.specialKind;
      const fit =
        (k === 'ram' && dist < 4.5 && dist > 1.5) ||
        (k === 'pursuit' && dist > 5) ||
        (k === 'hook' && dist < reach + 0.3 && (foe.blocking || Math.random() < 0.3)) ||
        ((k === 'javelin' || k === 'net') && dist > 2.6 && dist < 9) ||
        (k === 'challenge' && dist < 5);
      if (fit) this.special?.();
    }

    // Angreifen
    const tired = self.g.stamina < 22;
    if (!tired && now >= this.nextAttack && self.canAct && !self.blockWanted && dist < reach + 0.35) {
      const turtle = this.foeBlockSince >= 0 && now - this.foeBlockSince > 0.5;
      if (turtle && Math.random() < L.bash) self.bash();
      else if (turtle || Math.random() < L.heavy) self.startAttack(true);
      else {
        self.startAttack(false);
        this.comboLeft = Math.random() < L.combo ? (Math.random() < 0.6 ? 2 : 1) : 0;
      }
      this.nextAttack = now + (0.9 + Math.random() * 2.0) * (1.35 - L.aggression);
    }

    // Abstand halten und umkreisen
    if (now >= this.nextStrafe) {
      this.strafe = Math.random() < 0.5 ? -1 : 1;
      this.nextStrafe = now + 1.5 + Math.random() * 2.5;
    }
    let dir = Vector3.Zero();
    let speed = 0;
    if (self.blockWanted) return { dir, speed };
    if (dist > reach + 0.4) {
      dir = fwd;
      speed = dist > 5 ? 3.2 : 1.7;
    } else if (dist < 1.4 || tired) {
      dir = fwd.scale(-1).add(side.scale(this.strafe * 0.4)).normalize();
      speed = tired ? 1.6 : 1.0;
    } else if (self.mode === 'free') {
      dir = side.scale(this.strafe);
      speed = 0.8;
    }
    return { dir, speed };
  }
}
