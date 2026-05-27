import { defineConfig } from 'tsup';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  entry: { index: 'src/cli/index.ts', sdk: 'src/sdk.ts' },
  format: ['esm'],
  dts: false,
  clean: true,
  minify: true,

  target: 'es2022',
  outDir: 'dist',
  // Mark underdeveloped workspace packages as external so esbuild skips them.
  // They are only reachable via uncommonly-used spine/truth-loop CLI commands.
  external: [
    '@danteforge/evidence-chain',
    '@danteforge/truth-loop',
    '@danteforge/three-way-gate',
    '@danteforge/predictor',
  ],
  define: {
    'process.env.DANTEFORGE_VERSION': JSON.stringify(pkg.version),
  },
});
