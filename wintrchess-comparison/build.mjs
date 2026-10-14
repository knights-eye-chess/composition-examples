import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { UPSTREAM_COMMIT } from './src/upstream.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const upstream = path.join(directory, '.upstream');
const source = path.join(upstream, 'shared', 'src');
await mkdir(directory, { recursive: true });
try { execFileSync('git', ['-C', upstream, 'rev-parse', '--git-dir'], { stdio: 'ignore' }); }
catch {
  execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', 'https://github.com/WintrCat/wintrchess.git', upstream], { stdio: 'inherit' });
  execFileSync('git', ['-C', upstream, 'sparse-checkout', 'set', 'shared/src'], { stdio: 'inherit' });
}
try { execFileSync('git', ['-C', upstream, 'cat-file', '-e', `${UPSTREAM_COMMIT}^{commit}`], { stdio: 'ignore' }); }
catch { execFileSync('git', ['-C', upstream, 'fetch', '--filter=blob:none', 'origin', UPSTREAM_COMMIT], { stdio: 'inherit' }); }
execFileSync('git', ['-C', upstream, 'checkout', '--detach', UPSTREAM_COMMIT], { stdio: 'inherit' });
const actual = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (actual !== UPSTREAM_COMMIT) throw Error('WintrChess checkout does not match pinned commit.');
const changes = execFileSync('git', ['-C', upstream, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
if (changes) throw Error('WintrChess checkout has local changes; upstream source must remain unmodified.');
await build({
  entryPoints: [path.join(source, 'lib/reporter/classify.ts')],
  outfile: path.join(directory, 'dist', 'wintrchess-classify.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  external: ['chess.js', 'lodash-es', 'zod'],
  plugins: [{ name: 'wintrchess-alias', setup(api) {
    api.onResolve({ filter: /^@\// }, args => {
      const base = path.join(source, args.path.slice(2));
      return { path: existsSync(base) ? base : `${base}.ts` };
    });
  } }],
});
console.log(`Bundled unmodified WintrChess ${actual}`);
