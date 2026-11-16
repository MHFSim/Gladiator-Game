import { FreeCamera, Scene, Vector3 } from '@babylonjs/core';
import type { Arena } from '../arena/capua';
import { ARENA } from '../arena/capua';
import type { Gladiator } from '../gladiators/gladiator';
import type { Action, TouchInput } from '../input/touch';
import { Fx } from './fx';

const TAU = Math.PI * 2;

function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

type Mode = 'free' | 'attack' | 'block' | 'roll' | 'hit' | 'dead';

interface Fighter {
  g: Gladiator;
  mode: Mode;
  speed: number;
  vel: Vector3;
  rollDir: Vector3;
  rollTime: number;
  combo: number;
  attackStart: number;
  attackDur: number;
  staminaDelay: number;
  invuln: number;
  name: string;
}

export interface HudHooks {
  setBars(hp: number, st: number): void;
  hint(text: string, seconds?: number): void;
}

/**
 * Phase 0: Ein Gladiator gegen einen Trainingspartner im Ludus von Capua.
 * Echte Kampflogik (Deckungsrichtungen, Paraden) folgt in Phase 1.
 */
export class Game {
  private player: Fighter;
  private dummy: Fighter;
  private fx: Fx;
  private yaw = Math.PI; // Kamera schaut Richtung +Z vom Spieler aus nach vorn
  private pitch = 0.32;
  private camDist = 4.2;
  private lastDrag = 0;
  private shake = 0;
  private time = 0;
  private dummyCooldown = 3;
  private hitStop = 0;

  constructor(
    private readonly scene: Scene,
    private readonly camera: FreeCamera,
    private readonly arena: Arena,
    playerG: Gladiator,
    dummyG: Gladiator,
    private readonly input: TouchInput,
    private readonly hud: HudHooks,
  ) {
    const mk = (g: Gladiator, name: string): Fighter => ({
      g,
      mode: 'free',
      speed: 0,
      vel: Vector3.Zero(),
      rollDir: Vector3.Zero(),
      rollTime: 0,
      combo: 0,
      attackStart: 0,
      attackDur: 0,
      staminaDelay: 0,
      invuln: 0,
      name,
    });
    this.player = mk(playerG, 'Du');
    this.dummy = mk(dummyG, 'Trainingspartner');
    this.fx = new Fx(scene);
    playerG.root.position.set(0, 0, -6);
    playerG.setHeading(0);
    dummyG.root.position.set(0, 0, 2.5);
    dummyG.setHeading(Math.PI);
    this.yaw = 0;
  }

  /* ---------- Hauptschleife ---------- */

  update(rawDt: number, daylight: number, freeze = false): void {
    let dt = Math.min(rawDt, 0.05);
    this.time += dt;
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      this.scene.animationTimeScale = this.hitStop > 0 ? 0.08 : 1;
      dt *= this.hitStop > 0 ? 0.08 : 1;
    }
    for (const a of this.input.takeActions()) this.handle(this.player, a);
    this.updatePlayer(dt);
    if (!freeze) this.updateDummy(dt);
    else this.dummy.g.animator.setSpeed(0);
    for (const f of [this.player, this.dummy]) {
      this.integrate(f, dt);
      f.g.animator.update(dt);
    }
    this.arena.update(dt, daylight);
    if (!freeze) this.updateCamera(dt);
    this.hud.setBars(this.player.g.hp, this.player.g.stamina);
  }

  /* ---------- Spieler ---------- */

  private camForward(): Vector3 {
    return new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  private stickWorld(): Vector3 {
    const m = this.input.move;
    const f = this.camForward();
    const r = new Vector3(f.z, 0, -f.x);
    return f.scale(m.y).add(r.scale(m.x));
  }

  private handle(f: Fighter, a: Action): void {
    const g = f.g;
    if (f.mode === 'dead') return;
    switch (a.type) {
      case 'light':
        if (g.stamina < 6) return this.hud.hint('Keine Ausdauer!', 1);
        if (f.mode === 'attack') {
          const into = this.time - f.attackStart;
          if (into < f.attackDur * 0.45) return; // zu früh für die Kombo
        } else if (f.mode !== 'free' && f.mode !== 'block') return;
        this.attack(f, ['light_a', 'light_b', 'light_c'][f.combo % 3], 8, [{ at: 0.42, dmg: 10 }], 1.15);
        f.combo++;
        break;
      case 'heavy':
        if (f.mode !== 'free' && f.mode !== 'block') return;
        if (g.stamina < 16) return this.hud.hint('Keine Ausdauer!', 1);
        f.combo = 0;
        this.attack(f, 'heavy', 18, [
          { at: 0.3, dmg: 16 },
          { at: 0.62, dmg: 20 },
        ], 1.0);
        break;
      case 'blockStart':
        if (f.mode !== 'free') return;
        f.mode = 'block';
        g.animator.play('shield_idle', { loop: true, fadeIn: 0.12 });
        break;
      case 'blockEnd':
        if (f.mode === 'block') {
          f.mode = 'free';
          g.animator.stop('shield_idle');
        }
        break;
      case 'roll': {
        if (f.mode !== 'free' && f.mode !== 'block') return;
        if (g.stamina < 14) return this.hud.hint('Keine Ausdauer!', 1);
        let dir = this.stickWorld();
        if (dir.length() < 0.2 || a.dir !== 'back') {
          const fw = new Vector3(Math.sin(g.heading), 0, Math.cos(g.heading));
          const right = new Vector3(fw.z, 0, -fw.x);
          if (dir.length() < 0.2 || a.dir !== 'back') {
            dir =
              a.dir === 'left' ? right.scale(-1) : a.dir === 'right' ? right : a.dir === 'forward' ? fw : dir.length() >= 0.2 ? dir : fw.scale(-1);
          }
        }
        dir.normalize();
        this.useStamina(f, 14);
        f.mode = 'roll';
        f.rollDir = dir;
        f.invuln = 0.45;
        const dur = g.animator.durationOf('roll', 1.15);
        f.rollTime = dur * 0.85;
        g.setHeading(Math.atan2(dir.x, dir.z));
        g.animator.play('roll', {
          speed: 1.15,
          fadeIn: 0.06,
          fadeOut: 0.18,
          onEnd: () => {
            if (f.mode === 'roll') f.mode = 'free';
          },
        });
        break;
      }
      case 'bash':
        if (f.mode !== 'free' && f.mode !== 'block') return;
        if (g.stamina < 12) return this.hud.hint('Keine Ausdauer!', 1);
        this.useStamina(f, 12);
        this.faceTarget(f);
        f.mode = 'attack';
        f.attackStart = this.time;
        f.attackDur = g.animator.durationOf('shield_bash', 1.2);
        g.animator.play('shield_bash', {
          speed: 1.2,
          events: [{ at: 0.4, fn: () => this.resolveBash(f) }],
          onEnd: () => {
            if (f.mode === 'attack') f.mode = 'free';
          },
        });
        break;
      case 'cheer':
        if (f.mode !== 'free') return;
        f.mode = 'attack';
        f.attackStart = this.time;
        f.attackDur = g.animator.durationOf('cheer');
        g.animator.play('cheer', {
          onEnd: () => {
            if (f.mode === 'attack') f.mode = 'free';
          },
        });
        this.hud.hint('Das Publikum fehlt noch – kommt in Phase 3', 2.5);
        break;
    }
  }

  private other(f: Fighter): Fighter {
    return f === this.player ? this.dummy : this.player;
  }

  private faceTarget(f: Fighter): void {
    const o = this.other(f);
    if (o.mode === 'dead') return;
    const d = o.g.position.subtract(f.g.position);
    if (d.length() < 4.5) f.g.setHeading(Math.atan2(d.x, d.z));
  }

  private attack(f: Fighter, anim: string, cost: number, hits: { at: number; dmg: number }[], speed: number): void {
    const g = f.g;
    if (f.mode === 'block') g.animator.stop('shield_idle');
    this.useStamina(f, cost);
    this.faceTarget(f);
    f.mode = 'attack';
    f.attackStart = this.time;
    f.attackDur = g.animator.durationOf(anim, speed);
    g.animator.play(anim, {
      speed,
      fadeIn: 0.08,
      fadeOut: 0.2,
      events: hits.map((h) => ({ at: h.at, fn: () => this.resolveHit(f, h.dmg) })),
      onEnd: () => {
        if (f.mode === 'attack' && this.time - f.attackStart >= f.attackDur * 0.8) {
          f.mode = 'free';
          if (this.time - f.attackStart > f.attackDur * 1.5) f.combo = 0;
        }
      },
    });
    window.setTimeout(() => {
      if (this.time - f.attackStart > f.attackDur * 1.4) f.combo = 0;
    }, f.attackDur * 1600);
  }

  private useStamina(f: Fighter, v: number): void {
    f.g.stamina = Math.max(0, f.g.stamina - v);
    f.staminaDelay = 0.8;
  }

  /* ---------- Treffer ---------- */

  private inFront(a: Fighter, b: Fighter, maxAngle: number): boolean {
    const d = b.g.position.subtract(a.g.position);
    const ang = Math.atan2(d.x, d.z);
    return Math.abs(angleDiff(a.g.heading, ang)) < maxAngle;
  }

  private resolveHit(a: Fighter, dmg: number): void {
    const d = this.other(a);
    if (d.mode === 'dead' || d.invuln > 0) return;
    const dist = Vector3.Distance(a.g.position, d.g.position);
    if (dist > 2.35 || !this.inFront(a, d, 1.15)) return;
    const contact = Vector3.Lerp(a.g.position, d.g.position, 0.7);
    contact.y = d.g.chestHeight;
    const dir = d.g.position.subtract(a.g.position).normalize();
    const blocked = (d.mode === 'block' && this.inFront(d, a, 1.4)) || (d === this.dummy && d.mode === 'free' && Math.random() < 0.3);
    if (blocked) {
      this.fx.sparksAt(contact);
      d.g.stamina = Math.max(0, d.g.stamina - dmg * 0.8);
      if (d.mode !== 'block') {
        d.mode = 'hit';
        d.g.animator.play('block', {
          speed: 1.3,
          onEnd: () => {
            if (d.mode === 'hit') d.mode = 'free';
          },
        });
      }
      this.shake = 0.12;
      this.hitStop = 0.05;
      return;
    }
    d.g.hp = Math.max(0, d.g.hp - dmg);
    this.fx.bloodAt(contact, dir);
    this.shake = dmg > 14 ? 0.35 : 0.2;
    this.hitStop = dmg > 14 ? 0.09 : 0.06;
    if (d.g.hp <= 0) return this.kill(d, dir);
    d.mode = 'hit';
    d.g.animator.play(Math.random() < 0.5 ? 'hit_chest' : 'hit_head', {
      speed: 1.2,
      fadeIn: 0.05,
      onEnd: () => {
        if (d.mode === 'hit') d.mode = 'free';
      },
    });
    d.vel.addInPlace(dir.scale(2.2));
  }

  private resolveBash(a: Fighter): void {
    const d = this.other(a);
    if (d.mode === 'dead') return;
    const dist = Vector3.Distance(a.g.position, d.g.position);
    if (dist > 2.0 || !this.inFront(a, d, 1.0)) return;
    const dir = d.g.position.subtract(a.g.position).normalize();
    if (d.mode === 'block') {
      d.mode = 'hit';
      d.g.animator.play('shield_break', {
        onEnd: () => {
          if (d.mode === 'hit') d.mode = 'free';
        },
      });
      this.hud.hint('Deckung gebrochen!', 1.2);
    } else {
      d.mode = 'hit';
      d.g.animator.play('knockback', {
        onEnd: () => {
          if (d.mode === 'hit') d.mode = 'free';
        },
      });
    }
    d.g.stamina = Math.max(0, d.g.stamina - 25);
    d.vel.addInPlace(dir.scale(4));
    this.shake = 0.25;
    this.hitStop = 0.06;
  }

  private kill(d: Fighter, dir: Vector3): void {
    d.mode = 'dead';
    d.g.animator.play('death', { fadeIn: 0.08, loop: true });
    // Pose am Ende halten: Animation läuft als Schleife bis kurz vor Schluss, dann einfrieren
    const dur = d.g.animator.durationOf('death');
    const grp = d.g.animator.get('death');
    window.setTimeout(() => grp.pause(), dur * 960);
    d.vel.addInPlace(dir.scale(1.5));
    this.hud.hint(d === this.player ? 'Du bist gefallen …' : 'Sieg! Der Trainingspartner liegt im Sand.', 3);
    window.setTimeout(() => {
      grp.play(false);
      d.g.animator.play('get_up', {
        fadeIn: 0.15,
        onEnd: () => {
          d.mode = 'free';
        },
      });
      d.g.hp = 100;
      d.g.stamina = 100;
    }, 4500);
  }

  private updatePlayer(dt: number): void {
    const f = this.player;
    const g = f.g;
    const wish = this.stickWorld();
    const mag = Math.min(1, wish.length());
    let target = 0;
    if (f.mode === 'free') target = mag * 6.0;
    else if (f.mode === 'block') target = Math.min(1.2, mag * 1.6);
    else if (f.mode === 'attack') target = mag * 0.6;
    f.speed += (target - f.speed) * Math.min(1, dt * 8);
    if (mag > 0.05 && (f.mode === 'free' || f.mode === 'block')) {
      const want = Math.atan2(wish.x, wish.z);
      const turn = f.mode === 'block' ? 0 : angleDiff(g.heading, want);
      if (f.mode === 'block') {
        this.faceTarget(f);
      } else {
        g.setHeading(g.heading + turn * Math.min(1, dt * 10));
      }
    }
    if (f.mode !== 'roll') {
      const dir = mag > 0.05 ? wish.normalize() : new Vector3(Math.sin(g.heading), 0, Math.cos(g.heading));
      f.vel.x += (dir.x * f.speed - f.vel.x) * Math.min(1, dt * 10);
      f.vel.z += (dir.z * f.speed - f.vel.z) * Math.min(1, dt * 10);
    }
    this.regen(f, dt);
    g.animator.setSpeed(f.mode === 'free' || f.mode === 'block' ? f.speed : 0);
  }

  private updateDummy(dt: number): void {
    const f = this.dummy;
    const g = f.g;
    this.regen(f, dt);
    if (f.mode === 'dead') {
      g.animator.setSpeed(0);
      return;
    }
    const p = this.player;
    const d = p.g.position.subtract(g.position);
    d.y = 0;
    const dist = d.length();
    let speed = 0;
    if (f.mode === 'free') {
      if (dist < 10) {
        const want = Math.atan2(d.x, d.z);
        g.setHeading(g.heading + angleDiff(g.heading, want) * Math.min(1, dt * 5));
      }
      if (dist > 2.3 && dist < 9) speed = dist > 4 ? 3.0 : 1.3;
      this.dummyCooldown -= dt;
      if (dist < 2.4 && this.dummyCooldown <= 0 && p.mode !== 'dead') {
        this.dummyCooldown = 2.2 + Math.random() * 2.2;
        if (Math.random() < 0.25) this.handle(f, { type: 'heavy' });
        else this.handle(f, { type: 'light' });
      }
    }
    f.speed += (speed - f.speed) * Math.min(1, dt * 6);
    if (f.mode !== 'roll') {
      const dir = new Vector3(Math.sin(g.heading), 0, Math.cos(g.heading));
      f.vel.x += (dir.x * f.speed - f.vel.x) * Math.min(1, dt * 8);
      f.vel.z += (dir.z * f.speed - f.vel.z) * Math.min(1, dt * 8);
    }
    g.animator.setSpeed(f.mode === 'free' ? f.speed : 0);
  }

  private regen(f: Fighter, dt: number): void {
    f.invuln = Math.max(0, f.invuln - dt);
    if (f.staminaDelay > 0) f.staminaDelay -= dt;
    else if (f.mode !== 'block') f.g.stamina = Math.min(100, f.g.stamina + dt * 22);
    else f.g.stamina = Math.min(100, f.g.stamina + dt * 6);
  }

  private integrate(f: Fighter, dt: number): void {
    const g = f.g;
    if (f.mode === 'roll' && f.rollTime > 0) {
      f.rollTime -= dt;
      f.vel.copyFrom(f.rollDir.scale(4.6));
    } else if (f.mode === 'hit' || f.mode === 'dead') {
      f.vel.scaleInPlace(Math.max(0, 1 - dt * 5));
    }
    const pos = g.position;
    pos.x += f.vel.x * dt;
    pos.z += f.vel.z * dt;
    // Kollision: Arenarand, Hindernisse, andere Figur
    const r = Math.hypot(pos.x, pos.z);
    if (r > ARENA.playRadius) {
      pos.x *= ARENA.playRadius / r;
      pos.z *= ARENA.playRadius / r;
    }
    const push = (ox: number, oz: number, rr: number) => {
      const dx = pos.x - ox;
      const dz = pos.z - oz;
      const l = Math.hypot(dx, dz);
      const min = rr + 0.38;
      if (l < min && l > 1e-4) {
        pos.x = ox + (dx / l) * min;
        pos.z = oz + (dz / l) * min;
      }
    };
    for (const o of this.arena.obstacles) push(o.x, o.z, o.r);
    const other = this.other(f);
    if (other.mode !== 'dead') push(other.g.position.x, other.g.position.z, 0.38);
  }

  /* ---------- Kamera ---------- */

  private updateCamera(dt: number): void {
    const d = this.input.takeCamDelta();
    if (d.x !== 0 || d.y !== 0) this.lastDrag = this.time;
    this.yaw += d.x * 0.0058;
    this.pitch = Math.min(0.85, Math.max(0.05, this.pitch + d.y * 0.004));
    // Sanft hinter den Spieler drehen, wenn er läuft und niemand die Kamera bewegt
    const p = this.player;
    const mag = Math.hypot(this.input.move.x, this.input.move.y);
    if (this.time - this.lastDrag > 1.2 && mag > 0.3 && p.mode === 'free' && this.input.move.y > -0.3) {
      this.yaw += angleDiff(this.yaw, p.g.heading) * Math.min(1, dt * 0.9 * mag);
    }
    const target = p.g.position.add(new Vector3(0, 1.5, 0));
    const fw = this.camForward();
    const right = new Vector3(fw.z, 0, -fw.x);
    let dist = this.camDist;
    const cp = Math.cos(this.pitch);
    const pos = target
      .subtract(fw.scale(cp * dist))
      .add(new Vector3(0, Math.sin(this.pitch) * dist, 0))
      .add(right.scale(0.45));
    const rr = Math.hypot(pos.x, pos.z);
    const maxR = ARENA.radius - 0.4;
    if (rr > maxR) {
      pos.x *= maxR / rr;
      pos.z *= maxR / rr;
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.6);
      const s = this.shake * 0.12;
      pos.addInPlace(new Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    }
    this.camera.position.copyFrom(Vector3.Lerp(this.camera.position, pos, Math.min(1, dt * 14)));
    this.camera.setTarget(target.add(right.scale(0.45)));
  }

  /** Für Screenshots: feste Kameraposition */
  debugCamera(pos: Vector3, target: Vector3): void {
    this.camera.position.copyFrom(pos);
    this.camera.setTarget(target);
  }

  get playerFighter(): Gladiator {
    return this.player.g;
  }

  get dummyFighter(): Gladiator {
    return this.dummy.g;
  }
}
