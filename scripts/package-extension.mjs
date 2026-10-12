/**
 * Build the extension for a given server and zip it for sharing (works in any shell):
 *   npm run package:extension -- --api=https://pingx969.example.com
 *   (or set API_ORIGIN; add --localhost to also run on localhost pages, e.g. for the mock site)
 * → release/pingx969-extension-<version>.zip (unzip, then chrome://extensions → Load unpacked;
 *   the same zip is what the Chrome Web Store expects).
 * INCLUDE_LOCALHOST defaults to false here: shared builds don't run on localhost pages.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir = path.join(root, 'apps/extension');
// Separate output dir: the unpacked dev build in apps/extension/dist stays as it is.
const dist = path.join(root, 'release/extension');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const apiFlag = arg('api') ?? arg('api-origin');
if (apiFlag && !/^https?:\/\/[^/\s]+$/.test(apiFlag.replace(/\/+$/, ''))) {
  console.error(`[package] --api must be an origin like https://pingx969.example.com (got "${apiFlag}")`);
  process.exit(1);
}
const env = {
  ...process.env,
  EXT_OUT_DIR: dist,
  ...(apiFlag ? { API_ORIGIN: apiFlag.replace(/\/+$/, '') } : {}),
  INCLUDE_LOCALHOST: process.argv.includes('--localhost') ? 'true' : (process.env.INCLUDE_LOCALHOST ?? 'false'),
};
if (!env.API_ORIGIN) console.warn('[package] No server given (--api=https://…) — the extension will use http://localhost:4000, which only works for someone running the server on their own computer.');

fs.rmSync(dist, { recursive: true, force: true });
execFileSync(process.execPath, [path.join(extDir, 'build.mjs')], { cwd: extDir, env, stdio: 'inherit' });

const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(dist);

// Minimal ZIP writer (deflate, no dependencies).
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const locals = [];
const centrals = [];
let offset = 0;
for (const file of files.sort()) {
  const name = Buffer.from(path.relative(dist, file).split(path.sep).join('/'));
  const data = fs.readFileSync(file);
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(8, 8); // deflate
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(packed.length, 18);
  head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(name.length, 26);
  locals.push(head, name, packed);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(20, 4);
  cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(8, 10);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(packed.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(name.length, 28);
  cen.writeUInt32LE(offset, 42);
  centrals.push(cen, name);
  offset += head.length + name.length + packed.length;
}
const central = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(central.length, 12);
end.writeUInt32LE(offset, 16);

const outDir = path.join(root, 'release');
fs.mkdirSync(outDir, { recursive: true });
// The server is part of the name: a build only talks to the server it was made for.
const target = new URL(env.API_ORIGIN || 'http://localhost:4000');
const out = path.join(outDir, `pingx969-extension-${manifest.version}-${target.hostname === 'localhost' ? `localhost-${target.port || 80}` : target.hostname}.zip`);
fs.writeFileSync(out, Buffer.concat([...locals, central, end]));
console.log(`[package] ${path.relative(root, out)} (${files.length} files, ${(fs.statSync(out).size / 1024).toFixed(0)} KB) — server: ${env.API_ORIGIN || 'http://localhost:4000'}`);
