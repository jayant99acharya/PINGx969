/** Serves the mock job-application pages (e2e/mock-site) on http://localhost:4100 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../e2e/mock-site');
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

export function startMockSite(port = Number(process.env.MOCK_SITE_PORT || 4100)): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let p = decodeURIComponent(url.pathname);
    if (p === '/') p = '/index.html';
    const file = path.join(dir, path.normalize(p).replace(/^([/\\])+/, ''));
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (p === '/index.html') {
        res.writeHead(200, { 'Content-Type': types['.html'] });
        const list = (sub: string) =>
          fs
            .readdirSync(path.join(dir, sub))
            .filter((f) => f.endsWith('.html') && !f.endsWith('-frame.html'))
            .map((f) => `<li><a href="/${sub ? `${sub}/` : ''}${f}">${f}</a></li>`)
            .join('');
        return res.end(`<!doctype html><title>Mock job applications</title><h1>Mock job applications</h1><ul>${list('')}</ul><h2>ATS replicas</h2><ul>${list('ats')}</ul>`);
      }
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  startMockSite().then(() => console.log('[mock-site] http://localhost:4100'));
}
