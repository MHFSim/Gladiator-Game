import type { BaseTexture, Scene } from '@babylonjs/core';
import type { QualityProfile } from '../core/quality';
import type { Environment } from '../render/environment';
import { buildCapua, type Arena, type ArenaKind } from './capua';
import { buildColosseum } from './colosseum';

export interface BuiltArena {
  arena: Arena;
  dispose(): void;
}

/**
 * Baut eine Arena und merkt sich alles, was dabei entsteht (Meshes, Materialien, Texturen, Partikel, Lichter),
 * damit ein Arenawechsel ohne Neuladen der Seite geht.
 */
export function buildArena(kind: ArenaKind, scene: Scene, env: Environment, q: QualityProfile): BuiltArena {
  const before = {
    meshes: new Set(scene.meshes),
    materials: new Set(scene.materials),
    particles: new Set(scene.particleSystems),
    lights: new Set(scene.lights),
  };
  const arena = kind === 'colosseum' ? buildColosseum(scene, env, q) : buildCapua(scene, env, q);
  const meshes = scene.meshes.filter((m) => !before.meshes.has(m));
  const materials = scene.materials.filter((m) => !before.materials.has(m));
  const particles = scene.particleSystems.filter((p) => !before.particles.has(p));
  const lights = scene.lights.filter((l) => !before.lights.has(l));
  return {
    arena,
    dispose() {
      // Nur Texturen freigeben, die ausschließlich zur alten Arena gehören
      // (gemeinsame wie die BRDF-Tabelle der PBR-Materialien bleiben)
      const own = new Set<BaseTexture>();
      for (const m of materials) for (const t of m.getActiveTextures()) own.add(t);
      for (const p of particles) {
        if (p.particleTexture) own.add(p.particleTexture);
        p.dispose(false);
      }
      for (const m of meshes) if (!m.isDisposed()) m.dispose(false, false);
      for (const l of lights) l.dispose();
      for (const m of materials) m.dispose(false, false);
      const keep = new Set<BaseTexture>();
      for (const m of scene.materials) for (const t of m.getActiveTextures()) keep.add(t);
      for (const p of scene.particleSystems) if (p.particleTexture) keep.add(p.particleTexture);
      if (scene.environmentBRDFTexture) keep.add(scene.environmentBRDFTexture);
      if (scene.environmentTexture) keep.add(scene.environmentTexture);
      for (const t of own) if (!keep.has(t)) t.dispose();
    },
  };
}
