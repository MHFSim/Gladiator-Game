import { Vector3 } from '@babylonjs/core';
import type { Crowd } from '../arena/crowd';
import type { Sound } from '../audio/sound';
import type { Fighter } from './fighter';

/** Was das Publikum sieht */
export type Deed = 'parry' | 'hit' | 'heavy' | 'head' | 'block' | 'bash' | 'dodge' | 'kill' | 'feint';

const GAIN: Record<Deed, number> = { parry: 10, hit: 4, heavy: 6, head: 7, block: 1, bash: 4, dodge: 3, kill: 14, feint: 3 };
const SPIKE: Record<Deed, number> = { parry: 0.55, hit: 0.35, heavy: 0.5, head: 0.55, block: 0.08, bash: 0.3, dodge: 0.15, kill: 1, feint: 0.15 };

export type Verdict = 'missio' | 'iugula';

export interface SpectacleHooks {
  now(): number;
  isAuthority(): boolean;
  player(): Fighter;
  foe(): Fighter;
  hint(text: string, seconds?: number): void;
  float(f: Fighter, text: string, good: boolean): void;
  send(ev: Record<string, unknown>): void;
  vote(p: number | null, label?: string): void;
  thumb(v: Verdict | null): void;
  heal(f: Fighter, hp: number): void;
  pelt(f: Fighter): void;
  finisher(winner: Fighter, loser: Fighter): void;
  done(verdict: Verdict): void;
}

/**
 * Gunst des Publikums und die Zeremonie am Kampfende (Kaiser-Daumen).
 * Gastgeber/Training rechnen; der Gast zeigt nur an.
 */
export class Spectacle {
  private spike = 0;
  private lastExchange = 0;
  private impatient = false;
  private cheerCd = new Map<Fighter, number>();
  private good = new Map<Fighter, number>();
  private giftUsed = new Set<Fighter>();
  private peltUsed = new Set<Fighter>();
  /** Zeremonie */
  cer: { phase: 'fall' | 'vote' | 'verdict' | 'walk' | 'strike' | 'end'; t: number; winner: Fighter; loser: Fighter; p: number; verdict: Verdict | null } | null = null;
  excite = 0.2;

  constructor(
    private readonly crowd: Crowd,
    private readonly sound: Sound,
    private readonly h: SpectacleHooks,
  ) {}

  resetRound(): void {
    this.giftUsed.clear();
    this.peltUsed.clear();
    this.lastExchange = this.h.now();
    this.impatient = false;
  }

  resetMatch(): void {
    this.resetRound();
    for (const f of [this.h.player(), this.h.foe()]) f.favor = 50;
    this.cer = null;
    this.crowd.vote = 0;
    this.h.vote(null);
    this.h.thumb(null);
  }

  private add(f: Fighter, v: number): void {
    const g = v > 0 ? v * f.stats.gloriaMul : v;
    f.favor = Math.max(0, Math.min(100, f.favor + g));
  }

  note(d: Deed, f: Fighter, other: Fighter): void {
    if (!this.h.isAuthority()) return;
    this.add(f, GAIN[d]);
    if (d === 'parry' || d === 'hit' || d === 'heavy' || d === 'head' || d === 'kill') {
      this.add(other, -2);
      this.lastExchange = this.h.now();
      this.impatient = false;
      this.good.set(f, this.h.now() + 2.5);
    }
    this.kick(SPIKE[d]);
    // Comeback: Treffer mit wenig Leben begeistert
    if ((d === 'hit' || d === 'heavy' || d === 'head') && f.g.hp / f.stats.hpMax < 0.3) this.add(f, 4);
  }

  kick(v: number): void {
    this.spike = Math.min(1, this.spike + v);
    if (v >= 0.5) this.sound.roar(v);
    else if (v >= 0.3) this.sound.roar(v * 0.6, 1.2);
  }

  /** Anheizen-Geste */
  cheer(f: Fighter): void {
    if (!this.h.isAuthority()) return;
    const now = this.h.now();
    if ((this.cheerCd.get(f) ?? 0) > now) return;
    this.cheerCd.set(f, now + 5);
    const other = f === this.h.player() ? this.h.foe() : this.h.player();
    const losing = f.g.hp / f.stats.hpMax < other.g.hp / other.stats.hpMax - 0.25;
    if ((this.good.get(f) ?? 0) > now) {
      this.add(f, 9);
      this.kick(0.8);
      if (f.favor > 70) this.crowd.wave();
      this.h.float(f, 'Das Volk tobt!', true);
    } else if (losing) {
      this.add(f, -6);
      this.sound.boo();
      this.h.float(f, 'Buhrufe!', false);
    } else {
      this.add(f, 2);
      this.kick(0.3);
      this.h.float(f, 'Applaus', true);
    }
  }

  update(dt: number): void {
    this.spike = Math.max(0, this.spike - dt * 0.3);
    if (this.h.isAuthority()) {
      const now = this.h.now();
      if (!this.cer) {
        // Lange nichts passiert: das Publikum wird ungeduldig
        if (now - this.lastExchange > 9) {
          for (const f of [this.h.player(), this.h.foe()]) this.add(f, -1.2 * dt);
          if (!this.impatient) {
            this.impatient = true;
            this.sound.boo(2);
            this.h.hint('Das Publikum wird ungeduldig – kämpft!', 2);
            this.h.send({ k: 'msg', t: 'Das Publikum wird ungeduldig – kämpft!' });
          }
        }
        // Geschenke und faules Obst
        for (const f of [this.h.player(), this.h.foe()]) {
          if (f.mode === 'dead') continue;
          if (f.favor >= 92 && !this.giftUsed.has(f)) {
            this.giftUsed.add(f);
            f.favor = 70;
            this.h.heal(f, Math.round(f.stats.hpMax * 0.15));
            this.kick(0.6);
            this.crowd.wave();
          } else if (f.favor <= 8 && !this.peltUsed.has(f)) {
            this.peltUsed.add(f);
            f.favor = 25;
            this.h.pelt(f);
            this.sound.boo();
          }
        }
      }
      this.excite = Math.min(1, 0.15 + this.spike * 0.85 + (this.cer ? 0.25 : 0));
      this.updateCeremony(dt);
    }
    this.crowd.excite = this.excite;
    this.sound.update(dt, this.excite);
  }

  /* ---------- Kaiser-Daumen ---------- */

  start(winner: Fighter, loser: Fighter): void {
    // Chance auf Gnade: Gunst des Verlierers, etwas Willkür des Kaisers
    const p = Math.min(0.92, Math.max(0.08, 0.2 + (loser.favor / 100) * 0.65 + (Math.random() - 0.5) * 0.2));
    this.cer = { phase: 'fall', t: 0, winner, loser, p, verdict: null };
    this.h.send({ k: 'cer', ph: 'fall' });
  }

  private updateCeremony(dt: number): void {
    const c = this.cer;
    if (!c) return;
    c.t += dt;
    switch (c.phase) {
      case 'fall':
        if (c.t > 1.7) {
          c.phase = 'vote';
          c.t = 0;
          // Auf die Knie
          const a = c.loser.g.animator;
          a.resume('death');
          a.play('get_up', {
            range: [0.1, 0.84],
            speed: 0.7,
            fadeIn: 0.3,
            onEnd: () => a.play('get_up', { range: [0.84, 0.845], speed: 0.001, loop: true, fadeIn: 0.05 }),
          });
          this.crowd.vote = 1;
          this.sound.gasp();
          this.h.vote(0.5, 'Das Volk entscheidet …');
          this.h.send({ k: 'cer', ph: 'vote' });
        }
        break;
      case 'vote': {
        // Die Stimmung schwankt, dann pendelt sie sich bei p ein
        const k = Math.min(1, c.t / 3.2);
        const shown = 0.5 + (c.p - 0.5) * k + Math.sin(c.t * 5.3) * 0.12 * (1 - k);
        this.h.vote(shown, 'Das Volk entscheidet …');
        if (Math.floor(c.t * 10) % 3 === 0) this.h.send({ k: 'cer', ph: 'vote', v: shown });
        if (c.t > 3.6) {
          c.verdict = Math.random() < c.p ? 'missio' : 'iugula';
          c.phase = 'verdict';
          c.t = 0;
          this.crowd.vote = 0;
          this.h.vote(null);
          this.h.thumb(c.verdict);
          this.h.send({ k: 'cer', ph: 'verdict', v: c.verdict });
          if (c.verdict === 'missio') {
            this.sound.roar(0.8, 3);
            this.kick(0.8);
          } else {
            this.sound.roar(1, 2);
            this.kick(1);
          }
        }
        break;
      }
      case 'verdict':
        if (c.t > 1.8) {
          this.h.thumb(null);
          c.t = 0;
          if (c.verdict === 'missio') {
            c.phase = 'end';
            const a = c.loser.g.animator;
            a.play('get_up', { range: [0.84, a.durationOf('get_up')], speed: 0.8, fadeIn: 0.1 });
            c.loser.mode = 'stagger';
            c.loser.modeUntil = this.h.now() + 1.2;
          } else {
            c.phase = 'walk';
          }
        }
        break;
      case 'walk': {
        // Sieger geht zum Verlierer (Bewegung macht das Spiel), dann der Todesstoß
        const d = Vector3.Distance(c.winner.pos, c.loser.pos);
        if (d < 1.9 || c.t > 3) {
          c.phase = 'strike';
          c.t = 0;
          this.h.finisher(c.winner, c.loser);
        }
        break;
      }
      case 'strike':
        if (c.t > 2.6) {
          c.phase = 'end';
          c.t = 0;
        }
        break;
      case 'end':
        if (c.t > 1.4) {
          const v = c.verdict ?? 'missio';
          this.cer = null;
          this.h.done(v);
        }
        break;
    }
  }

  /** Gast: Anzeige der Zeremonie */
  onRemote(e: Record<string, unknown>): void {
    switch (e.ph) {
      case 'fall':
        this.cer = { phase: 'fall', t: 0, winner: this.h.player(), loser: this.h.foe(), p: 0.5, verdict: null };
        break;
      case 'vote':
        if (this.cer && this.cer.phase !== 'vote') {
          this.cer.phase = 'vote';
          this.crowd.vote = 1;
          this.sound.gasp();
        }
        this.h.vote(typeof e.v === 'number' ? e.v : 0.5, 'Das Volk entscheidet …');
        break;
      case 'verdict':
        if (this.cer) {
          this.cer.phase = 'verdict';
          this.cer.verdict = e.v as Verdict;
        }
        this.crowd.vote = 0;
        this.h.vote(null);
        this.h.thumb(e.v as Verdict);
        this.sound.roar(1, 2.5);
        window.setTimeout(() => this.h.thumb(null), 1800);
        break;
    }
  }

  get inCeremony(): boolean {
    return this.cer !== null;
  }

  /** Für den Gast: Stimmung aus dem Schnappschuss */
  setRemoteExcite(e: number): void {
    this.excite = e;
  }
}
