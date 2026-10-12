import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { AppError, ErrorCodes } from '@pingx969/shared';

/** True for loopback, private, link-local, CGNAT, multicast and reserved ranges. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
}

/**
 * Fetch a public web page for job-description import with SSRF protection: http(s) only,
 * every hop's DNS result is validated and the connection is pinned to the validated IP,
 * redirects are re-validated, and size/time are bounded.
 */
export async function safeFetchText(rawUrl: string, opts: { allowPrivate?: boolean; maxBytes?: number; timeoutMs?: number } = {}): Promise<{ url: string; body: string; contentType: string }> {
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(ErrorCodes.URL_FETCH_FAILED, 'That does not look like a valid URL.', 400);
  }
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AppError(ErrorCodes.URL_FETCH_FAILED, 'Only http and https links can be imported.', 400);
    if (url.username || url.password) throw new AppError(ErrorCodes.URL_FETCH_FAILED, 'Links with embedded credentials are not allowed.', 400);
    let addrs: { address: string; family: number }[];
    try {
      addrs = net.isIP(url.hostname) ? [{ address: url.hostname, family: net.isIPv6(url.hostname) ? 6 : 4 }] : await dns.lookup(url.hostname, { all: true });
    } catch {
      throw new AppError(ErrorCodes.URL_FETCH_FAILED, `Could not resolve ${url.hostname}.`, 400);
    }
    if (!addrs.length) throw new AppError(ErrorCodes.URL_FETCH_FAILED, `Could not resolve ${url.hostname}.`, 400);
    if (!opts.allowPrivate && addrs.some((a) => isPrivateAddress(a.address))) {
      throw new AppError(ErrorCodes.URL_FETCH_FAILED, 'That address points to a private network and cannot be fetched.', 400);
    }
    // Every resolved address was validated above; prefer IPv4 (many hosts lack IPv6 routes).
    const ordered = [...addrs].sort((a, b) => a.family - b.family);
    const pinned = ordered[0];
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(
        url,
        {
          method: 'GET',
          headers: { 'User-Agent': 'PINGx969/1.0 (job description import)', Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9' },
          timeout: timeoutMs,
          // Pin the connection to the validated address. Node >= 20 asks for all addresses
          // (happy-eyeballs: options.all === true) and then expects an array.
          lookup: (_h, opts, cb) => {
            const done = cb as (e: Error | null, a: string | { address: string; family: number }[], f?: number) => void;
            if ((opts as { all?: boolean }).all) done(null, ordered.map((a) => ({ address: a.address, family: a.family })));
            else done(null, pinned.address, pinned.family);
          },
        },
        resolve,
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      req.end();
    }).catch((e: Error) => {
      throw new AppError(ErrorCodes.URL_FETCH_FAILED, e.message === 'timeout' ? 'The job page took too long to respond.' : 'The job page could not be reached.', 502);
    });
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      url = new URL(res.headers.location, url);
      continue;
    }
    if (!res.statusCode || res.statusCode >= 400) {
      res.resume();
      throw new AppError(ErrorCodes.URL_FETCH_FAILED, `The job page returned an error (${res.statusCode}). Try pasting the description instead.`, 502);
    }
    const contentType = String(res.headers['content-type'] ?? '');
    if (!/text\/html|text\/plain|application\/xhtml|application\/ld\+json|application\/json/i.test(contentType)) {
      res.resume();
      throw new AppError(ErrorCodes.URL_FETCH_FAILED, 'That link is not a web page. Try pasting the description instead.', 400);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    await new Promise<void>((resolve, reject) => {
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          res.destroy();
          reject(new AppError(ErrorCodes.URL_FETCH_FAILED, 'The job page is too large to import.', 413));
        } else chunks.push(c);
      });
      res.on('end', () => resolve());
      res.on('error', reject);
    });
    return { url: url.toString(), body: Buffer.concat(chunks).toString('utf8'), contentType };
  }
  throw new AppError(ErrorCodes.URL_FETCH_FAILED, 'Too many redirects.', 400);
}
