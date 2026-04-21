import { defineConfig } from 'tsup';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  entry: { index: 'src/cli/index.ts', sdk: 'src/sdk.ts' },
  format: ['esm'],
  dts: {
    entry: {
      index: 'src/types/cli-entry.d.ts',
      sdk: 'src/sdk.ts',
    },
  },
  clean: true,
  minify: false,
  target: 'es2022',
  outDir: 'dist',
  define: {
    'process.env.DANTEFORGE_VERSION': JSON.stringify(pkg.version),
  },
});
