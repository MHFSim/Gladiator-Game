import { Color4, ParticleSystem, Vector3, type Scene, type Texture } from '@babylonjs/core';
import type { QualityProfile } from '../core/quality';
import { flareTexture } from '../render/textures';

let emberTex: Texture | null = null;

/** Glut, die aus einem Feuerbecken aufsteigt, flackert und im Wind treibt */
export function embers(scene: Scene, at: Vector3, q: QualityProfile): ParticleSystem | null {
  if (q.tier === 'low') return null;
  if (!emberTex || emberTex.getScene() !== scene) emberTex = flareTexture(scene, 'ember', 'rgba(255,230,160,1)', 'rgba(255,120,30,0.9)');
  const n = q.tier === 'ultra' ? 60 : q.tier === 'high' ? 40 : 20;
  const ps = new ParticleSystem('embers', n, scene);
  ps.particleTexture = emberTex;
  ps.emitter = at.clone();
  ps.minEmitBox = new Vector3(-0.2, 0, -0.2);
  ps.maxEmitBox = new Vector3(0.2, 0.1, 0.2);
  ps.color1 = new Color4(1, 0.7, 0.3, 1);
  ps.color2 = new Color4(1, 0.45, 0.1, 1);
  ps.colorDead = new Color4(0.6, 0.1, 0, 0);
  ps.minSize = 0.015;
  ps.maxSize = 0.04;
  ps.minLifeTime = 1.2;
  ps.maxLifeTime = 2.8;
  ps.emitRate = n / 2;
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.gravity = new Vector3(0.25, 0.9, 0.1);
  ps.direction1 = new Vector3(-0.4, 1, -0.4);
  ps.direction2 = new Vector3(0.4, 1.8, 0.4);
  ps.minEmitPower = 0.4;
  ps.maxEmitPower = 1.1;
  ps.noiseStrength = new Vector3(0.6, 0.3, 0.6);
  ps.start();
  return ps;
}
