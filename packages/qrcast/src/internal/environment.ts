import type { EnvironmentFeature } from '../errors.js';

let webglAvailable: boolean | undefined;

function hasWebgl(): boolean {
  if (webglAvailable === undefined) {
    try {
      const canvas = new OffscreenCanvas(1, 1);
      webglAvailable = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) !== null;
    } catch {
      webglAvailable = false;
    }
  }
  return webglAvailable;
}

function has(feature: EnvironmentFeature): boolean {
  switch (feature) {
    case 'worker':
      return typeof Worker === 'function';
    case 'webassembly':
      return typeof WebAssembly === 'object' && WebAssembly !== null;
    case 'video-frame':
      return typeof VideoFrame === 'function';
    case 'webgl':
      // Probed on the main thread, as a proxy for the codec's workers.
      return typeof OffscreenCanvas === 'function' && hasWebgl();
  }
}

/** The first of `features` this browser lacks, or `null`. */
export function missingFeature(features: readonly EnvironmentFeature[]): EnvironmentFeature | null {
  return features.find((feature) => !has(feature)) ?? null;
}

/** Forgets the cached WebGL probe. For tests. */
export function resetEnvironmentCache(): void {
  webglAvailable = undefined;
}
