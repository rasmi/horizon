import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * The sky map's model runs under LiteRT.js, which fetches its own files
 * (WebAssembly, one of several builds by what the browser can do) by name
 * when it starts. The dev server serves them from the package as it sits in
 * node_modules; a build needs them beside the page, so they're copied into
 * it here, under litert/ (see src/sky/detector.ts).
 */
function liteRtRuntime(): Plugin {
  const from = fileURLToPath(new URL('./node_modules/@litertjs/core/wasm/', import.meta.url));
  return {
    name: 'litert-runtime',
    apply: 'build',
    generateBundle() {
      for (const name of readdirSync(from)) this.emitFile({ type: 'asset', fileName: `litert/${name}`, source: readFileSync(from + name) });
    },
  };
}

export default defineConfig({
  base: './',
  envPrefix: ['VITE_', 'GOOGLE_MAPS_API_KEY'],
  plugins: [liteRtRuntime()],
});
