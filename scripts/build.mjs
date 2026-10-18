import { build } from 'esbuild';
import { buildRemote } from './build-remote.mjs';
await buildRemote('dist-electron/remote');
await build({ entryPoints: ['electron/main.ts', 'electron/preload.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], outdir: 'dist-electron', outExtension: { '.js': '.cjs' }, sourcemap: true });
