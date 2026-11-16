import {
  Color3,
  Color4,
  DepthOfFieldEffectBlurLevel,
  DynamicTexture,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  StandardMaterial,
  Texture,
  Vector3,
  VolumetricLightScatteringPostProcess,
  type FreeCamera,
  type Scene,
} from '@babylonjs/core';
import type { QualityProfile } from '../core/quality';
import type { Arena } from '../arena/capua';
import type { Environment } from './environment';

/** Weiche runde Scheibe (Sonne, Staubkorn) */
function discTexture(scene: Scene, name: string, stops: [number, string][], size = 128): DynamicTexture {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.hasAlpha = true;
  tex.wrapU = Texture.CLAMP_ADDRESSMODE;
  tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  tex.update(false);
  return tex;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Kino-Ebene über der Szene: Lichtstrahlen der Sonne durch Bögen und Staub, schwebender Staub um die Kamera,
 * Tiefenschärfe, leichte Farbsäume, Farbstimmung je Tageszeit, Wucht bei Treffern und Zeitlupe.
 */
export class Cinema {
  private rays: VolumetricLightScatteringPostProcess | null = null;
  private sunDisc: Mesh | null = null;
  private dust: ParticleSystem | null = null;
  private dustLevel = 1;
  private hitPulse = 0;
  private cine = 0;
  private cineTarget = 0;
  private focus = 4;
  readonly dof: boolean;
  readonly aberration: boolean;

  constructor(
    private readonly scene: Scene,
    private readonly camera: FreeCamera,
    private readonly env: Environment,
    private readonly q: QualityProfile,
  ) {
    const p = env.pipeline;
    // Licht, das an Metall, Feuer und Himmel aufblüht
    p.bloomThreshold = 0.95;
    p.bloomWeight = 0.2;
    p.bloomKernel = 64;
    p.bloomScale = 0.5;
    p.imageProcessing.vignetteWeight = 1.6;
    p.imageProcessing.vignetteColor = new Color4(0.1, 0.03, 0.01, 0);
    p.grain.intensity = 5;

    // Tiefenschärfe: der Kampf scharf, die Ränge weich (nur auf der höchsten Stufe)
    this.dof = q.tier === 'ultra';
    if (this.dof) {
      p.depthOfFieldEnabled = true;
      p.depthOfFieldBlurLevel = DepthOfFieldEffectBlurLevel.Low;
      p.depthOfField.focalLength = 50;
      p.depthOfField.fStop = 3.2;
      p.depthOfField.focusDistance = 4000;
      p.depthOfField.lensSize = 50;
    }
    // Leichte Farbsäume am Rand wie bei einem echten Objektiv
    this.aberration = q.tier === 'ultra' || q.tier === 'high';
    if (this.aberration) {
      p.chromaticAberrationEnabled = true;
      p.chromaticAberration.aberrationAmount = 6;
      p.chromaticAberration.radialIntensity = 1.4;
    }

    // Lichtstrahlen: die Sonne scheint durch Bögen, Säulen und Staub
    if (q.tier === 'ultra' || q.tier === 'high') {
      const disc = MeshBuilder.CreatePlane('sunDisc', { size: 34 }, scene);
      const m = new StandardMaterial('sunDiscMat', scene);
      m.disableLighting = true;
      m.emissiveColor = new Color3(1, 0.92, 0.75);
      m.diffuseTexture = discTexture(scene, 'sunDiscTex', [
        [0, 'rgba(255,250,235,1)'],
        [0.18, 'rgba(255,236,190,0.95)'],
        [0.45, 'rgba(255,200,140,0.25)'],
        [1, 'rgba(255,180,120,0)'],
      ]);
      m.diffuseTexture.hasAlpha = true;
      m.useAlphaFromDiffuseTexture = true;
      m.backFaceCulling = false;
      m.fogEnabled = false;
      disc.material = m;
      disc.billboardMode = Mesh.BILLBOARDMODE_ALL;
      disc.applyFog = false;
      disc.isPickable = false;
      this.sunDisc = disc;
      const vls = new VolumetricLightScatteringPostProcess('godrays', q.tier === 'ultra' ? 0.5 : 0.35, camera, disc, q.tier === 'ultra' ? 80 : 50, Texture.BILINEAR_SAMPLINGMODE, scene.getEngine(), false, scene);
      vls.exposure = 0.07;
      vls.decay = 0.95;
      vls.weight = 0.35;
      vls.density = 0.72;
      this.rays = vls;
    }

    // Schwebender Staub um die Kamera: leuchtet im Gegenlicht
    if (q.dust > 0) {
      const tex = discTexture(scene, 'moteTex', [
        [0, 'rgba(255,248,230,1)'],
        [0.35, 'rgba(255,236,200,0.55)'],
        [1, 'rgba(255,220,180,0)'],
      ], 32);
      const d = new ParticleSystem('dust', Math.round(q.dust * 1.2), scene);
      d.particleTexture = tex;
      d.emitter = camera.position.clone();
      d.minEmitBox = new Vector3(-7, -1.6, -7);
      d.maxEmitBox = new Vector3(7, 4, 7);
      d.minSize = 0.018;
      d.maxSize = 0.05;
      d.minLifeTime = 4;
      d.maxLifeTime = 8;
      d.emitRate = (q.dust * 1.2) / 6;
      d.color1 = new Color4(1, 0.95, 0.85, 0.5);
      d.color2 = new Color4(1, 0.88, 0.7, 0.3);
      d.colorDead = new Color4(1, 0.9, 0.8, 0);
      d.direction1 = new Vector3(-0.06, -0.01, -0.04);
      d.direction2 = new Vector3(0.06, 0.04, 0.04);
      d.minEmitPower = 0.4;
      d.maxEmitPower = 0.9;
      d.gravity = new Vector3(0.04, 0.005, 0.015);
      d.blendMode = ParticleSystem.BLENDMODE_ADD;
      d.isLocal = false;
      d.preWarmCycles = 120;
      d.start();
      this.dust = d;
    }
  }

  private torches: ParticleSystem | null = null;
  private torchPoles: Mesh | null = null;
  private torchOn = false;

  /** Fackeln rund um die Podiumsmauer: brennen in der Dämmerung und nachts */
  private buildTorches(a: Arena): void {
    this.torches?.dispose();
    this.torchPoles?.dispose();
    this.torches = null;
    this.torchPoles = null;
    if (this.q.tier === 'low') return;
    const n = this.q.tier === 'medium' ? 20 : 36;
    const pts: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + 0.05;
      pts.push(new Vector3(Math.cos(ang) * (a.wall.a + 0.15), a.podiumHeight + 0.55, Math.sin(ang) * (a.wall.b + 0.15)));
    }
    // Eiserne Fackelhalter
    const pole = MeshBuilder.CreateCylinder('torchPole', { height: 0.7, diameterTop: 0.11, diameterBottom: 0.04, tessellation: 6 }, this.scene);
    const pm = new StandardMaterial('torchPoleMat', this.scene);
    pm.diffuseColor = new Color3(0.12, 0.1, 0.08);
    pm.specularColor = new Color3(0.1, 0.1, 0.1);
    pole.material = pm;
    pole.isPickable = false;
    for (const p of pts) pole.thinInstanceAdd(Matrix.Translation(p.x, p.y - 0.4, p.z));
    this.torchPoles = pole;
    const ps = new ParticleSystem('torchFire', this.q.tier === 'ultra' ? 900 : 500, this.scene);
    ps.particleTexture = discTexture(this.scene, 'torchTex', [
      [0, 'rgba(255,245,210,1)'],
      [0.35, 'rgba(255,150,50,0.8)'],
      [1, 'rgba(255,80,10,0)'],
    ], 64);
    ps.emitter = Vector3.Zero();
    ps.startPositionFunction = (_w, pos) => {
      const p = pts[Math.floor(Math.random() * pts.length)];
      pos.set(p.x + (Math.random() - 0.5) * 0.08, p.y, p.z + (Math.random() - 0.5) * 0.08);
    };
    ps.color1 = new Color4(1, 0.75, 0.35, 1);
    ps.color2 = new Color4(1, 0.45, 0.12, 1);
    ps.colorDead = new Color4(0.3, 0.05, 0, 0);
    ps.minSize = 0.12;
    ps.maxSize = 0.3;
    ps.minLifeTime = 0.2;
    ps.maxLifeTime = 0.5;
    ps.emitRate = n * 22;
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.gravity = new Vector3(0, 2.2, 0);
    ps.direction1 = new Vector3(-0.1, 1, -0.1);
    ps.direction2 = new Vector3(0.1, 1.3, 0.1);
    ps.minEmitPower = 0.2;
    ps.maxEmitPower = 0.5;
    this.torches = ps;
    this.torchOn = false;
  }

  /** Neue Arena: Fackeln setzen; die Zuschauer werfen keine Strahlen-Schatten (spart Zeit, sieht gleich aus) */
  setArena(a: Arena): void {
    this.buildTorches(a);
    if (!this.rays) return;
    this.rays.excludedMeshes = this.scene.meshes.filter((m) => m.name === 'spectator' || m.name.startsWith('cloud') || m.name === 'sky');
  }

  /** Wie viel Staub in der Luft liegt (Wetter) */
  setDust(level: number): void {
    this.dustLevel = level;
    if (!this.dust) return;
    if (level > 0) this.dust.start();
    else this.dust.stop();
  }

  /** Treffer-Wucht: Farbsäume und Rand ziehen kurz an */
  pulse(strength: number): void {
    this.hitPulse = Math.max(this.hitPulse, strength);
  }

  /** Kinomomente (Zeitlupe, Urteil): stärkere Tiefenschärfe, ausgeblichene Farben */
  cinematic(on: boolean): void {
    this.cineTarget = on ? 1 : 0;
  }

  /** Jedes Bild: Fokus auf den Kampf, Sonne und Staub mitführen */
  update(dt: number, focusPoint: Vector3): void {
    const cam = this.camera;
    const env = this.env;
    const p = env.pipeline;
    const sunDir = env.sun.direction.scale(-1).normalize();
    const fwd = cam.getDirection(Vector3.Forward());
    const facing = Vector3.Dot(fwd, sunDir);
    const day = env.daylight;
    const clear = 1 - Math.min(1, Math.max(0, (env.cover - 0.2) / 0.6));
    this.cine += (this.cineTarget - this.cine) * Math.min(1, dt * 2.5);
    this.hitPulse = Math.max(0, this.hitPulse - dt * 3);

    if (this.sunDisc && this.rays) {
      this.sunDisc.position.copyFrom(cam.position.add(sunDir.scale(900)));
      const elev = sunDir.y;
      const s = smooth(-0.02, 0.1, elev) * clear;
      this.sunDisc.isVisible = s > 0.01;
      // Am stärksten bei tiefer Sonne und Blick in Richtung Sonne
      const low = 0.2 + 0.8 * (1 - smooth(0.1, 0.42, elev));
      this.rays.weight = 0.24 * s * low * smooth(-0.15, 0.55, facing) * (0.6 + 0.4 * day);
      this.rays.exposure = 0.05 + env.sunWarmth * 0.05;
    }

    // Fackeln ab der Dämmerung
    const want = day < 0.55;
    if (this.torches && want !== this.torchOn) {
      this.torchOn = want;
      if (want) this.torches.start();
      else this.torches.stop();
    }
    if (this.torchPoles) this.torchPoles.isVisible = true;

    if (this.dust) {
      (this.dust.emitter as Vector3).copyFrom(cam.position);
      // Staub glüht im Gegenlicht und verschwindet im Schatten der Nacht
      const glow = (0.25 + 1.6 * Math.pow(Math.max(0, facing), 3)) * (0.3 + 0.7 * day) * clear * this.dustLevel;
      const warm = env.sunWarmth;
      this.dust.color1.set(1, 0.92 - warm * 0.15, 0.8 - warm * 0.3, Math.min(0.9, 0.35 * glow));
      this.dust.color2.set(1, 0.85 - warm * 0.15, 0.68 - warm * 0.3, Math.min(0.7, 0.22 * glow));
    }

    if (this.dof) {
      const d = Vector3.Distance(cam.position, focusPoint);
      this.focus += (d - this.focus) * Math.min(1, dt * 6);
      p.depthOfField.focusDistance = this.focus * 1000;
      p.depthOfField.fStop = 3.2 - this.cine * 1.6;
    }
    if (this.aberration) {
      p.chromaticAberration.aberrationAmount = 6 + this.hitPulse * 40 + this.cine * 10;
    }
    p.imageProcessing.vignetteWeight = 1.6 + this.hitPulse * 1.4 + this.cine * 1.2;
    env.setCinematic(this.cine);
  }
}
