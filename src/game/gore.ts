import { Color3, Color4, Mesh, MeshBuilder, ParticleSystem, PBRMaterial, Quaternion, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import type { Gladiator, SeverPart } from '../gladiators/gladiator';
import { flareTexture } from '../render/textures';
import type { Fx } from './fx';

export type GoreLevel = 'full' | 'reduced' | 'off';

interface Gib {
  root: TransformNode;
  parts: Mesh[];
  vel: Vector3;
  spin: Vector3;
  radius: number;
  t: number;
  resting: boolean;
  bleed: number;
}

interface Spurt {
  ps: ParticleSystem;
  t: number;
  dur: number;
  rate: number;
  stump: Mesh;
  parent: TransformNode;
  pooled: boolean;
}

/**
 * Zerstückelung: abgetrennte Köpfe und Gliedmaßen fliegen mit einfacher Physik durch die Arena,
 * aus Stümpfen pulsiert Blut, auf dem Boden bleiben Lachen.
 */
export class Gore {
  level: GoreLevel = 'full';
  private gibs: Gib[] = [];
  private spurts: Spurt[] = [];
  private skin: PBRMaterial;
  private flesh: PBRMaterial;
  private bone: PBRMaterial;
  private hair: PBRMaterial;
  private dropTex;

  constructor(
    private readonly scene: Scene,
    private readonly fx: Fx,
    private readonly bounds: () => { a: number; b: number },
  ) {
    const mk = (name: string, c: Color3, rough: number) => {
      const m = new PBRMaterial(name, scene);
      m.albedoColor = c;
      m.metallic = 0;
      m.roughness = rough;
      m.environmentIntensity = 0;
      return m;
    };
    this.skin = mk('gibSkin', new Color3(0.62, 0.4, 0.29), 0.6);
    this.flesh = mk('gibFlesh', new Color3(0.34, 0.015, 0.012), 0.25);
    this.bone = mk('gibBone', new Color3(0.86, 0.82, 0.72), 0.5);
    this.hair = mk('gibHair', new Color3(0.06, 0.04, 0.03), 0.8);
    this.dropTex = flareTexture(scene, 'spurtP', 'rgba(150,8,8,1)', 'rgba(90,0,0,0.9)');
  }

  /** Teil abtrennen und fliegen lassen. dir = Schlagrichtung (Welt) */
  sever(g: Gladiator, part: SeverPart, dir: Vector3, power = 1): boolean {
    if (this.level !== 'full') return false;
    const cut = g.sever(part);
    if (!cut) return false;
    const bs = g.dims.bs;
    const root = new TransformNode('gib', this.scene);
    root.position.copyFrom(cut.pos);
    // Lokales +Y zeigt vom Schnitt zum Ende des Teils
    const q = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), cut.axis, q);
    root.rotationQuaternion = q;
    const parts: Mesh[] = [];
    let radius = 0.12;
    if (part === 'head') {
      const head = MeshBuilder.CreateSphere('gibHead', { diameterX: 0.19 * bs, diameterY: 0.24 * bs, diameterZ: 0.21 * bs, segments: 12 }, this.scene);
      head.material = this.skin;
      head.position.y = 0.1 * bs;
      head.parent = root;
      parts.push(head);
      if (!cut.gear.length) {
        const hair = MeshBuilder.CreateSphere('gibHair', { diameter: 0.205 * bs, slice: 0.55, segments: 10 }, this.scene);
        hair.material = this.hair;
        hair.position.y = 0.12 * bs;
        hair.parent = root;
        parts.push(hair);
      }
      const neck = MeshBuilder.CreateCylinder('gibNeck', { height: 0.08 * bs, diameter: 0.1 * bs, tessellation: 10 }, this.scene);
      neck.material = this.skin;
      neck.position.y = -0.02 * bs;
      neck.parent = root;
      const cutFace = MeshBuilder.CreateDisc('gibCut', { radius: 0.05 * bs, tessellation: 12 }, this.scene);
      cutFace.material = this.flesh;
      cutFace.rotation.x = Math.PI / 2;
      cutFace.position.y = -0.062 * bs;
      cutFace.parent = root;
      parts.push(neck, cutFace);
      radius = 0.13 * bs;
    } else {
      const leg = part.startsWith('leg');
      const len = (leg ? 0.48 : 0.3) * bs;
      const thick = (leg ? 0.11 : 0.085) * bs;
      const limb = MeshBuilder.CreateCapsule('gibLimb', { height: len, radius: thick / 2, tessellation: 10 }, this.scene);
      limb.material = this.skin;
      limb.position.y = -len / 2 + thick / 2;
      limb.parent = root;
      const cutFace = MeshBuilder.CreateDisc('gibCut', { radius: thick * 0.48, tessellation: 12 }, this.scene);
      cutFace.material = this.flesh;
      cutFace.rotation.x = -Math.PI / 2;
      cutFace.position.y = 0.005;
      cutFace.parent = root;
      const boneEnd = MeshBuilder.CreateCylinder('gibBone', { height: 0.03, diameter: thick * 0.32, tessellation: 8 }, this.scene);
      boneEnd.material = this.bone;
      boneEnd.position.y = 0.012;
      boneEnd.parent = root;
      parts.push(limb, cutFace, boneEnd);
      limb.position.y = len / 2 - thick / 2;
      cutFace.rotation.x = Math.PI / 2;
      cutFace.position.y = -0.005;
      boneEnd.position.y = -0.012;
      radius = len * 0.4;
    }
    // Mitgerissene Ausrüstung hängt am fliegenden Teil
    root.computeWorldMatrix(true);
    for (const m of cut.gear) {
      m.setParent(root);
      parts.push(m);
    }
    const up = part === 'head' ? 4.2 : 3.2;
    const vel = dir.normalize().scale((3 + Math.random() * 2) * power).add(new Vector3((Math.random() - 0.5) * 1.5, up + Math.random() * 1.5, (Math.random() - 0.5) * 1.5));
    const spin = new Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
    this.gibs.push({ root, parts, vel, spin, radius, t: 0, resting: false, bleed: 1.2 });
    // Fontäne aus dem Stumpf
    this.spurt(cut.stump, cut.parent, part === 'head');
    this.fx.bloodAt(cut.pos, dir, 2.5);
    return true;
  }

  /** Pulsierende Blutfontäne aus dem Stumpf */
  private spurt(stump: Mesh, parent: TransformNode, head: boolean): void {
    const ps = new ParticleSystem('spurt', 700, this.scene);
    ps.particleTexture = this.dropTex;
    ps.emitter = stump.getAbsolutePosition().clone();
    ps.minEmitBox = Vector3.Zero();
    ps.maxEmitBox = Vector3.Zero();
    ps.minSize = 0.03;
    ps.maxSize = 0.08;
    ps.minLifeTime = 0.5;
    ps.maxLifeTime = 1.1;
    ps.gravity = new Vector3(0, -9.81, 0);
    ps.color1 = new Color4(0.55, 0.02, 0.02, 1);
    ps.color2 = new Color4(0.38, 0.0, 0.0, 1);
    ps.colorDead = new Color4(0.25, 0, 0, 0.6);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.emitRate = 0;
    ps.start();
    this.spurts.push({ ps, t: 0, dur: head ? 6 : 4.5, rate: head ? 280 : 180, stump, parent, pooled: false });
  }

  update(dt: number): void {
    const B = this.bounds();
    for (const g of this.gibs) {
      g.t += dt;
      if (!g.resting) {
        g.vel.y -= 9.81 * dt;
        g.root.position.addInPlace(g.vel.scale(dt));
        const q = g.root.rotationQuaternion!;
        g.root.rotationQuaternion = Quaternion.RotationYawPitchRoll(g.spin.y * dt, g.spin.x * dt, g.spin.z * dt).multiply(q);
        // Blutspur in der Luft
        if (g.bleed > 0 && Math.random() < 0.6) this.fx.drip(g.root.position.clone());
        // Boden
        if (g.root.position.y < g.radius * 0.5) {
          g.root.position.y = g.radius * 0.5;
          if (Math.abs(g.vel.y) > 1.2) {
            this.fx.splat(new Vector3(g.root.position.x, 0, g.root.position.z), 0.4 + Math.random() * 0.4);
            this.fx.bloodAt(g.root.position.clone(), new Vector3(g.vel.x, 0.3, g.vel.z), 0.6);
          }
          g.vel.y = -g.vel.y * 0.28;
          g.vel.x *= 0.55;
          g.vel.z *= 0.55;
          g.spin.scaleInPlace(0.5);
          if (Math.abs(g.vel.y) < 0.6 && Math.hypot(g.vel.x, g.vel.z) < 0.4) {
            g.resting = true;
            this.fx.pool(new Vector3(g.root.position.x, 0, g.root.position.z), 0.55);
          }
        }
        // Mauer der Arena
        const k = (g.root.position.x / B.a) ** 2 + (g.root.position.z / B.b) ** 2;
        if (k > 1) {
          const s = 1 / Math.sqrt(k);
          g.root.position.x *= s;
          g.root.position.z *= s;
          g.vel.x *= -0.4;
          g.vel.z *= -0.4;
        }
      }
      g.bleed -= dt;
    }
    for (const s of this.spurts) {
      s.t += dt;
      // Fontäne folgt dem Körper, Richtung = aus dem Stumpf heraus
      if (!s.stump.isDisposed()) {
        const p = s.stump.getAbsolutePosition();
        (s.ps.emitter as Vector3).copyFrom(p);
        const d = p.subtract(s.parent.getAbsolutePosition());
        if (d.lengthSquared() > 1e-6) d.normalize();
        s.ps.direction1 = d.add(new Vector3(-0.3, 0.25, -0.3));
        s.ps.direction2 = d.add(new Vector3(0.3, 0.7, 0.3));
        if (!s.pooled && s.t > 0.9) {
          s.pooled = true;
          this.fx.pool(new Vector3(p.x, 0, p.z), 1.4);
        }
      }
      const fade = Math.max(0, 1 - s.t / s.dur);
      // Herzschlag: kräftige Stöße, schwächer werdend
      const beat = Math.pow(Math.max(0, Math.sin(s.t * 7.5)), 3);
      s.ps.emitRate = s.rate * fade * (0.15 + beat);
      s.ps.minEmitPower = 1.2 + 3.5 * beat * fade;
      s.ps.maxEmitPower = 2 + 4.5 * beat * fade;
      if (s.t > s.dur + 1.5) s.ps.dispose();
    }
    this.spurts = this.spurts.filter((s) => s.t <= s.dur + 1.5);
  }

  /** Neuer Kampf oder neue Runde: Teile weg, Körper wieder ganz */
  clear(fighters: Gladiator[]): void {
    for (const g of this.gibs) {
      for (const p of g.parts) p.dispose();
      g.root.dispose();
    }
    this.gibs = [];
    for (const s of this.spurts) s.ps.dispose();
    this.spurts = [];
    for (const f of fighters) f.restoreBody();
  }
}
