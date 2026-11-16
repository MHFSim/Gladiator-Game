import { AbstractEngine, Engine, WebGPUEngine } from '@babylonjs/core';
import type { RendererChoice } from './settings';

export interface EngineResult {
  engine: AbstractEngine;
  kind: 'WebGPU' | 'WebGL2';
}

export async function createEngine(canvas: HTMLCanvasElement, choice: RendererChoice): Promise<EngineResult> {
  if (choice === 'webgpu') {
    try {
      if (await WebGPUEngine.IsSupportedAsync) {
        const engine = new WebGPUEngine(canvas, {
          antialias: false,
          stencil: true,
          adaptToDeviceRatio: false,
          powerPreference: 'high-performance',
        });
        await engine.initAsync();
        return { engine, kind: 'WebGPU' };
      }
    } catch (e) {
      console.warn('WebGPU nicht verfügbar, nutze WebGL2', e);
    }
  }
  const engine = new Engine(
    canvas,
    false,
    {
      stencil: true,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      premultipliedAlpha: false,
    },
    false,
  );
  return { engine, kind: 'WebGL2' };
}
