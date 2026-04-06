import { defineConfig } from 'tsup';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  entry: ['src/cli/index.ts', 'src/sdk.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  minify: false,
  target: 'es2022',
  outDir: 'dist',
  define: {
    'process.env.DANTEFORGE_VERSION': JSON.stringify(pkg.version),
  },
});
