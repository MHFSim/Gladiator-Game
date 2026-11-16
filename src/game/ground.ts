import { Color3, Color4, DynamicTexture, Matrix, Mesh, MeshBuilder, ParticleSystem, PBRMaterial, PointLight, Quaternion, Texture, Vector3, type Scene } from '@babylonjs/core';

/** Textur aus einer Zeichenfunktion (wird erst beim ersten Gebrauch gemalt) */
function canvasTex(scene: Scene, name: string, size: number, draw: (c: CanvasRenderingContext2D, s: number) => void): DynamicTexture {
  const t = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const c = t.getContext() as unknown as CanvasRenderingContext2D;
  c.clearRect(0, 0, size, size);
  draw(c, size);
  t.hasAlpha = true;
  t.wrapU = Texture.CLAMP_ADDRESSMODE;
  t.wrapV = Texture.CLAMP_ADDRESSMODE;
  t.update(false);
  return t;
}

interface Walker {
  key: object;
  pos: Vector3;
  heading: number;
  speed: number;
  /** Größe der Spur (Mensch 1, Wolf 0.5, Stier 0.9) */
  foot: number;
  /** Abstand zwischen zwei Abdrücken */
  stride: number;
  beast: boolean;
}

/**
 * Sand mit Gedächtnis und Leben: Kontaktschatten unter jedem Körper, Fußspuren, aufwirbelnder Sand,
 * kurzes Licht bei Funken.
 */
export class GroundFx {
  private blobs: Mesh;
  private prints: Mesh;
  private printSlot = 0;
  private readonly printCap = 260;
  private puffs: ParticleSystem[] = [];
  private puffNext = 0;
  private flash: PointLight | null = null;
  private flashT = 0;
  private last = new WeakMap<object, { x: number; z: number; side: number }>();
  /** Nasser Sand: Spuren dunkler, kaum Staub */
  wet = false;
  daylight = 1;

  constructor(
    scene: Scene,
    private readonly hiTier: boolean,
  ) {
    // Kontaktschatten: dunkler, weicher Fleck direkt unter dem Körper
    const blobTex = canvasTex(scene, 'blobTex', 64, (c, s) => {
      const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(0,0,0,0.75)');
      g.addColorStop(0.45, 'rgba(0,0,0,0.38)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, s, s);
    });
    this.blobs = MeshBuilder.CreateGround('contactShadow', { width: 1, height: 1 }, scene);
    const bm = new PBRMaterial('contactShadowMat', scene);
    bm.albedoColor = new Color3(0.08, 0.05, 0.03);
    bm.opacityTexture = blobTex;
    bm.unlit = true;
    bm.zOffset = -3;
    bm.disableDepthWrite = true;
    this.blobs.material = bm;
    this.blobs.isPickable = false;
    this.blobs.alwaysSelectAsActiveMesh = true;
    this.blobs.thinInstanceAdd(Matrix.Identity());
    this.blobs.thinInstanceCount = 0;

    // Fußabdruck: Ferse und Ballen, eingedrückter Sand
    const printTex = canvasTex(scene, 'footTex', 64, (c, s) => {
      const blob = (x: number, y: number, rx: number, ry: number, a: number) => {
        const g = c.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
        g.addColorStop(0, `rgba(0,0,0,${a})`);
        g.addColorStop(0.7, `rgba(0,0,0,${a * 0.6})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.save();
        c.translate(x, y);
        c.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
        c.translate(-x, -y);
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, Math.max(rx, ry), 0, Math.PI * 2);
        c.fill();
        c.restore();
      };
      blob(s * 0.5, s * 0.74, s * 0.15, s * 0.17, 0.75);
      blob(s * 0.5, s * 0.36, s * 0.19, s * 0.25, 0.85);
      for (let i = 0; i < 5; i++) blob(s * (0.36 + i * 0.07), s * (0.1 + Math.abs(i - 2) * 0.02), s * 0.035, s * 0.04, 0.6);
    });
    this.prints = MeshBuilder.CreateGround('footprints', { width: 1, height: 1 }, scene);
    const pm = new PBRMaterial('footprintMat', scene);
    pm.albedoColor = new Color3(0.32, 0.24, 0.15);
    pm.opacityTexture = printTex;
    pm.metallic = 0;
    pm.roughness = 1;
    pm.alpha = 0.42;
    pm.zOffset = -2;
    pm.disableDepthWrite = true;
    pm.environmentIntensity = 0;
    this.prints.material = pm;
    this.prints.isPickable = false;
    this.prints.receiveShadows = true;
    this.prints.alwaysSelectAsActiveMesh = true;
    this.prints.thinInstanceAdd(Matrix.Identity());
    this.prints.thinInstanceCount = 0;

    // Aufwirbelnder Sand: drei Systeme im Wechsel, damit mehrere Stellen im selben Bild stauben können
    const puffTex = canvasTex(scene, 'puffTex', 64, (c, s) => {
      for (let i = 0; i < 7; i++) {
        const x = s * (0.3 + Math.random() * 0.4);
        const y = s * (0.3 + Math.random() * 0.4);
        const r = s * (0.18 + Math.random() * 0.16);
        const g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.45)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, s, s);
      }
    });
    for (let i = 0; i < 3; i++) {
      const ps = new ParticleSystem('sandPuff', hiTier ? 160 : 70, scene);
      ps.particleTexture = puffTex;
      ps.emitter = new Vector3();
      ps.emitRate = 0;
      ps.minEmitBox = new Vector3(-0.15, 0, -0.15);
      ps.maxEmitBox = new Vector3(0.15, 0.05, 0.15);
      ps.minLifeTime = 0.7;
      ps.maxLifeTime = 1.6;
      ps.minSize = 0.25;
      ps.maxSize = 0.6;
      ps.addSizeGradient(0, 0.5);
      ps.addSizeGradient(1, 2.2);
      ps.minEmitPower = 0.4;
      ps.maxEmitPower = 1.4;
      ps.direction1 = new Vector3(-1, 0.3, -1);
      ps.direction2 = new Vector3(1, 1.1, 1);
      ps.gravity = new Vector3(0, -0.25, 0);
      ps.minAngularSpeed = -0.6;
      ps.maxAngularSpeed = 0.6;
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      ps.updateSpeed = 0.016;
      ps.start();
      this.puffs.push(ps);
    }

    if (hiTier) {
      const l = new PointLight('sparkLight', new Vector3(0, -10, 0), scene);
      l.diffuse = new Color3(1, 0.78, 0.45);
      l.specular = new Color3(1, 0.8, 0.5);
      l.range = 5;
      l.intensity = 0;
      this.flash = l;
    }
  }

  /** Sand aufwirbeln: amount 0.3 (Schritt) bis 2 (Sturz, Stier) */
  puff(at: Vector3, amount: number, dir?: Vector3): void {
    if (this.wet) amount *= 0.25;
    if (amount < 0.05) return;
    const ps = this.puffs[this.puffNext++ % this.puffs.length];
    (ps.emitter as Vector3).set(at.x, 0.05, at.z);
    // Sandfarbe im Licht des Tages
    const l = 0.25 + 0.75 * this.daylight;
    ps.color1 = new Color4(0.8 * l, 0.68 * l, 0.5 * l, 0.55);
    ps.color2 = new Color4(0.7 * l, 0.58 * l, 0.42 * l, 0.4);
    ps.colorDead = new Color4(0.75 * l, 0.62 * l, 0.46 * l, 0);
    const d = dir ? dir.clone().normalize() : Vector3.Zero();
    ps.direction1 = new Vector3(-0.8 + d.x * 1.5, 0.25, -0.8 + d.z * 1.5);
    ps.direction2 = new Vector3(0.8 + d.x * 1.5, 1.0, 0.8 + d.z * 1.5);
    ps.minSize = 0.2 + amount * 0.12;
    ps.maxSize = 0.45 + amount * 0.25;
    ps.manualEmitCount = Math.round(4 + amount * (this.hiTier ? 22 : 10));
  }

  /** Kurzes warmes Licht bei Funken */
  sparkLight(at: Vector3): void {
    if (!this.flash) return;
    this.flash.position.copyFrom(at);
    this.flashT = 0.16;
  }

  /** Jedes Bild: Kontaktschatten setzen, Spuren legen, Licht abklingen lassen */
  update(dt: number, walkers: Walker[]): void {
    if (this.flash) {
      this.flashT = Math.max(0, this.flashT - dt);
      this.flash.intensity = (this.flashT / 0.16) * 9;
    }
    // Kontaktschatten
    const bl = this.blobs;
    const n = walkers.length;
    const mats = new Float32Array(Math.max(1, n) * 16);
    const m = new Matrix();
    walkers.forEach((w, i) => {
      const s = w.beast ? (w.foot > 0.7 ? 2.4 : 1.4) : 1.15;
      Matrix.ComposeToRef(new Vector3(s, 1, w.beast ? s * 1.5 : s), Quaternion.RotationYawPitchRoll(w.heading, 0, 0), new Vector3(w.pos.x, 0.015, w.pos.z), m);
      m.copyToArray(mats, i * 16);
    });
    bl.thinInstanceSetBuffer('matrix', mats, 16, false);
    bl.thinInstanceCount = n;

    // Fußspuren
    for (const w of walkers) {
      let l = this.last.get(w.key);
      if (!l) {
        l = { x: w.pos.x, z: w.pos.z, side: 1 };
        this.last.set(w.key, l);
        continue;
      }
      const dx = w.pos.x - l.x;
      const dz = w.pos.z - l.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 3) {
        l.x = w.pos.x;
        l.z = w.pos.z;
        continue;
      }
      if (dist < w.stride || w.speed < 0.4) continue;
      l.x = w.pos.x;
      l.z = w.pos.z;
      l.side = -l.side;
      const h = Math.atan2(dx, dz);
      const off = new Vector3(Math.cos(h), 0, -Math.sin(h)).scale(l.side * 0.11 * w.foot);
      this.print(w.pos.add(off), h, w.foot);
      // Laufen staubt
      if (w.speed > 3.2) this.puff(w.pos, w.beast ? 0.5 + w.foot * 0.5 : 0.25, new Vector3(-dx, 0, -dz));
    }
  }

  private print(at: Vector3, heading: number, size: number): void {
    const p = this.prints;
    const m = Matrix.Compose(new Vector3(0.13 * size, 1, 0.28 * size), Quaternion.RotationYawPitchRoll(heading, 0, 0), new Vector3(at.x, 0.011, at.z));
    if (p.thinInstanceCount < this.printCap) p.thinInstanceAdd(m);
    else {
      p.thinInstanceSetMatrixAt(this.printSlot % this.printCap, m);
      this.printSlot++;
    }
  }

  /** Neuer Kampf: Spuren verwischt */
  clear(): void {
    this.prints.thinInstanceCount = 0;
    this.printSlot = 0;
  }
}

export type { Walker };
