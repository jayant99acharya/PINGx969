import fs from 'node:fs';
import path from 'node:path';
import { Cipher } from '@pingx969/database';

export interface Config {
  env: 'development' | 'test' | 'production';
  isProd: boolean;
  port: number;
  host: string;
  databaseUrl: string | undefined;
  dataDir: string;
  storageDir: string;
  encryptionKey: string;
  /** Origins allowed to make cookie-authenticated, state-changing requests. */
  allowedOrigins: string[];
  cookieSecure: boolean;
  sessionTtlDays: number;
  extensionTokenTtlDays: number;
  aiProvider: string;
  anthropicApiKey: string | undefined;
  aiModel: string | undefined;
  aiTimeoutMs: number;
  allowPrivateUrlFetch: boolean;
  webDist: string | null;
  rateLimits: { auth: number; api: number; heavy: number; windowMs: number };
  logRequests: boolean;
  /** Where the dashboard lives (used for links from the extension). Empty = same origin as the API. */
  webUrl: string;
}

/** The monorepo root (npm runs workspace scripts from the package folder). */
export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg) && /"workspaces"/.test(fs.readFileSync(pkg, 'utf8'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

function loadDotEnv() {
  for (const p of [path.resolve(repoRoot(), '.env')]) {
    if (fs.existsSync(p)) {
      try {
        process.loadEnvFile(p);
      } catch {
        /* ignore malformed .env */
      }
      return;
    }
  }
}

function devKey(dataDir: string): string {
  const file = path.join(dataDir, 'dev-encryption.key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  fs.mkdirSync(dataDir, { recursive: true });
  const key = Cipher.generateKey();
  fs.writeFileSync(file, key, { mode: 0o600 });
  console.warn(`[config] APP_ENCRYPTION_KEY not set — generated a development key at ${file}. Set APP_ENCRYPTION_KEY in production.`);
  return key;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  if (process.env.NODE_ENV !== 'test') loadDotEnv();
  const env = (process.env.NODE_ENV as Config['env']) || 'development';
  const isProd = env === 'production';
  const root = repoRoot();
  const dataDir = path.resolve(root, process.env.DATA_DIR || 'data');
  const key = process.env.APP_ENCRYPTION_KEY || overrides.encryptionKey;
  if (isProd && !key) throw new Error('APP_ENCRYPTION_KEY is required in production');
  const port = Number(process.env.PORT || 4000);
  const webDistCandidate = path.resolve(root, process.env.WEB_DIST || 'apps/web/dist');
  const cfg: Config = {
    env,
    isProd,
    port,
    host: process.env.HOST || '127.0.0.1',
    databaseUrl: process.env.DATABASE_URL || undefined,
    dataDir,
    storageDir: path.resolve(process.env.STORAGE_DIR || path.join(dataDir, 'objects')),
    encryptionKey: key || devKey(dataDir),
    allowedOrigins: (process.env.ALLOWED_ORIGINS || `http://localhost:5173,http://127.0.0.1:5173,http://localhost:${port},http://127.0.0.1:${port}`)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
    sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 14),
    extensionTokenTtlDays: Number(process.env.EXTENSION_TOKEN_TTL_DAYS || 30),
    aiProvider: process.env.AI_PROVIDER || 'heuristic',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    aiModel: process.env.AI_MODEL || undefined,
    aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS || 90_000),
    allowPrivateUrlFetch: process.env.ALLOW_PRIVATE_URL_FETCH === 'true',
    webDist: fs.existsSync(path.join(webDistCandidate, 'index.html')) ? webDistCandidate : null,
    rateLimits: {
      auth: Number(process.env.RATE_LIMIT_AUTH || 20),
      api: Number(process.env.RATE_LIMIT_API || 600),
      heavy: Number(process.env.RATE_LIMIT_HEAVY || 60),
      windowMs: 60_000,
    },
    logRequests: process.env.LOG_REQUESTS !== 'false' && env !== 'test',
    // Production serves the dashboard from the API itself; development uses the Vite dev server.
    webUrl: process.env.WEB_URL ?? (isProd ? '' : 'http://localhost:5173'),
    ...overrides,
  };
  return cfg;
}
