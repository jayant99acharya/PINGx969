/**
 * Builds the MV3 extension into dist/ with esbuild.
 *   node build.mjs            production build
 *   node build.mjs --watch    rebuild on change
 * Env:
 *   API_ORIGIN       server origin the extension talks to (default http://localhost:4000)
 *   INCLUDE_LOCALHOST  run content scripts on localhost (dev/testing mock sites; default true)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
// EXT_OUT_DIR lets `npm run package:extension` build elsewhere without replacing the dev build in dist/.
const dist = process.env.EXT_OUT_DIR ? path.resolve(process.env.EXT_OUT_DIR) : path.join(here, 'dist');
const watch = process.argv.includes('--watch');
const apiOrigin = (process.env.API_ORIGIN || 'http://localhost:4000').replace(/\/+$/, '');
const includeLocalhost = process.env.INCLUDE_LOCALHOST !== 'false';
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));

fs.mkdirSync(dist, { recursive: true });

// Known applicant-tracking systems where the content script runs automatically.
const ATS_MATCHES = [
  'https://*.greenhouse.io/*',
  'https://jobs.lever.co/*',
  'https://*.myworkdayjobs.com/*',
  'https://*.myworkdaysite.com/*',
  'https://jobs.ashbyhq.com/*',
  'https://*.smartrecruiters.com/*',
  'https://*.workable.com/*',
  'https://*.icims.com/*',
  'https://*.jobvite.com/*',
  'https://*.bamboohr.com/*',
  'https://*.applytojob.com/*',
  'https://docs.google.com/forms/*',
  'https://*.zohorecruit.com/*',
  'https://*.zohorecruit.in/*',
  'https://*.zohorecruit.eu/*',
  'https://*.oraclecloud.com/hcmUI/*',
  'https://*.kula.ai/*',
  'https://*.keka.com/*',
  'https://*.teamtailor.com/*',
  'https://ats.rippling.com/*',
  'https://*.recruitee.com/*',
  'https://*.breezy.hr/*',
  'https://*.jobs.personio.de/*',
  'https://*.jobs.personio.com/*',
  // Large ATSs whose application forms sit behind a candidate login: enabled with the generic
  // detector (not individually verified — see README).
  'https://*.successfactors.com/*',
  'https://*.successfactors.eu/*',
  'https://*.taleo.net/*',
  'https://smartapply.indeed.com/*',
  'https://*.ultipro.com/*',
  'https://recruiting.paylocity.com/*',
  'https://*.darwinbox.in/*',
  'https://*.freshteam.com/*',
  // LinkedIn is a single-page app: jobs pages are reached without a full page load, so the
  // script runs site-wide and stays idle until an application form (Easy Apply) appears.
  'https://www.linkedin.com/*',
];
const LOCAL = ['http://localhost/*', 'http://127.0.0.1/*'];

const apiHost = new URL(apiOrigin);
const apiPattern = `${apiHost.protocol}//${apiHost.hostname}/*`;

const manifest = {
  manifest_version: 3,
  name: 'PINGx969 — Job Application Autofill',
  short_name: 'PINGx969',
  version: pkg.version,
  description: 'Autofill job applications from your PINGx969 profile, reuse saved answers, and attach the right tailored resume. Never submits for you.',
  icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  action: { default_popup: 'popup.html', default_title: 'PINGx969', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' } },
  options_page: 'options.html',
  background: { service_worker: 'background.js', type: 'module' },
  // storage: token & cache; activeTab+scripting: "Scan this page" on demand; alarms: offline retry queue
  permissions: ['storage', 'activeTab', 'scripting', 'alarms'],
  host_permissions: [...new Set([apiPattern, ...(includeLocalhost ? LOCAL : [])])],
  optional_host_permissions: ['https://*/*'],
  content_scripts: [
    {
      matches: [...ATS_MATCHES, ...(includeLocalhost ? LOCAL : [])],
      js: ['content.js'],
      run_at: 'document_idle',
      all_frames: true,
    },
    {
      // Tells content.js when the page's framework has hydrated (see src/page-ready.ts).
      matches: [...ATS_MATCHES, ...(includeLocalhost ? LOCAL : [])],
      js: ['page-ready.js'],
      run_at: 'document_end',
      all_frames: true,
      world: 'MAIN',
    },
  ],
  // The review panel is an extension page shown in an iframe so the host site cannot read it.
  web_accessible_resources: [{ resources: ['panel.html', 'panel.js', 'extension.css'], matches: ['<all_urls>'], use_dynamic_url: true }],
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
  minimum_chrome_version: '116',
};

// ---- tiny PNG encoder for the icons (no binary assets in the repo)
function crc32(buf) {
  let c;
  const table = crc32.t ?? (crc32.t = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function png(size) {
  const px = Buffer.alloc(size * (size * 4 + 1));
  const r = size * 0.22;
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  for (let y = 0; y < size; y++) {
    px[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const u = x / size;
      const v = y / size;
      // Lightning-bolt-ish glyph
      const bolt = (u > 0.42 && u < 0.62 && v > 0.18 && v < 0.52 && u - 0.42 > (v - 0.18) * -0.2) || (u > 0.38 && u < 0.58 && v >= 0.48 && v < 0.84 && u < 0.58 - (v - 0.48) * 0.3);
      if (!inRounded(x + 0.5, y + 0.5)) px.writeUInt32BE(0x00000000, i);
      else if (bolt) px.writeUInt32BE(0xffffffff, i);
      else px.writeUInt32BE(0x2a63d6ff, i);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(px)), chunk('IEND', Buffer.alloc(0))]);
}

function copyStatic() {
  fs.mkdirSync(path.join(dist, 'icons'), { recursive: true });
  for (const s of [16, 32, 48, 128]) fs.writeFileSync(path.join(dist, 'icons', `${s}.png`), png(s));
  for (const f of fs.readdirSync(path.join(here, 'static'))) fs.copyFileSync(path.join(here, 'static', f), path.join(dist, f));
  fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

const common = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: ['chrome116'],
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  // Node-only modules referenced by shared packages are never reached in the browser bundle.
  external: ['node:*'],
};

const builds = [
  { entryPoints: { background: path.join(here, 'src/background.ts') }, format: 'esm' },
  { entryPoints: { content: path.join(here, 'src/content.ts'), 'page-ready': path.join(here, 'src/page-ready.ts') }, format: 'iife' },
  { entryPoints: { popup: path.join(here, 'src/popup.tsx'), options: path.join(here, 'src/options.tsx'), panel: path.join(here, 'src/panel.tsx') }, format: 'iife' },
];

copyStatic();
if (watch) {
  for (const b of builds) (await esbuild.context({ ...common, ...b, outdir: dist })).watch();
  console.log('[extension] watching…');
} else {
  await Promise.all(builds.map((b) => esbuild.build({ ...common, ...b, outdir: dist })));
  console.log(`[extension] built to ${dist} (API ${apiOrigin}, localhost content scripts: ${includeLocalhost})`);
}
