import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  // Bundle the workspace packages: they are published as TypeScript source, so
  // the deployed artifact must carry them inline rather than resolve them from
  // node_modules at runtime.
  noExternal: [/^@toolgraph\//],
  splitting: false,
  sourcemap: true,
  dts: false,
  // Render's free plan has no persistent disk and a small memory ceiling;
  // minifying keeps the cold start as short as we can make it.
  minify: true,
});
