import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const cwd = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(cwd, '../..');
let timer;
let child;
let rerun = false;
let closing = false;
function build() {
  if (closing) return;
  if (child) { rerun = true; return; }
  console.log('[rust-watch] Rebuilding WASM…');
  child = spawn('wasm-pack', ['build', '--no-pack', '--target', 'web', '--out-dir', 'dist', '--out-name', 'index', '--locked'], { cwd, stdio: 'inherit' });
  child.on('error', error => console.error('[rust-watch]', error.message));
  child.on('close', code => {
    child = undefined;
    console.log(code === 0 ? '[rust-watch] WASM ready.' : '[rust-watch] Build failed; waiting for changes.');
    if (rerun) { rerun = false; build(); }
  });
}
function changed() { clearTimeout(timer); timer = setTimeout(build, 200); }
const watchers = [
  watch(resolve(cwd, 'src'), { recursive: true }, changed),
  watch(resolve(root, 'crates/diagram-core/src'), { recursive: true }, changed),
  watch(resolve(root, 'schemas'), { recursive: true }, changed),
  ...['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', 'crates/diagram-core/Cargo.toml', 'packages/engine-wasm/Cargo.toml'].map(path => watch(resolve(root, path), changed)),
];
console.log('[rust-watch] Watching Rust sources. Initial build is managed by Turborepo.');
function close() { closing = true; clearTimeout(timer); watchers.forEach(watcher => watcher.close()); child?.kill('SIGTERM'); process.exit(0); }
process.on('SIGINT', close);
process.on('SIGTERM', close);
