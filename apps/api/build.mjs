/**
 * Production build: bundles the API and the workspace packages (TypeScript sources) into
 * dist/main.js + dist/cli.js; third-party packages stay in node_modules. Migrations are copied.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
fs.mkdirSync(dist, { recursive: true });

const externalizeDeps = {
  name: 'externalize-deps',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.kind === 'entry-point' || path.isAbsolute(args.path)) return null;
      if (args.path.startsWith('@pingx969/')) return null; // bundle workspace sources
      return { path: args.path, external: true };
    });
  },
};

await esbuild.build({
  entryPoints: { main: path.join(here, 'src/main.ts'), cli: path.join(here, 'src/cli.ts') },
  outdir: dist,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  plugins: [externalizeDeps],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});

const migSrc = path.join(here, '../../packages/database/migrations');
const migDst = path.join(dist, 'migrations');
fs.mkdirSync(migDst, { recursive: true });
for (const f of fs.readdirSync(migSrc)) fs.copyFileSync(path.join(migSrc, f), path.join(migDst, f));
console.log('[api] built to', dist);
