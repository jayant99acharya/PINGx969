/** Server configuration: production safety rules and environment parsing. */
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('loadConfig', () => {
  it('refuses to start in production without an encryption key', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.APP_ENCRYPTION_KEY;
    expect(() => loadConfig()).toThrow(/APP_ENCRYPTION_KEY is required in production/);
  });

  it('turns on secure cookies and same-origin dashboard in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ENCRYPTION_KEY = 'k'.repeat(44);
    delete process.env.COOKIE_SECURE;
    delete process.env.WEB_URL;
    const c = loadConfig();
    expect(c).toMatchObject({ isProd: true, cookieSecure: true, webUrl: '' });
  });

  it('reads ports, origins, limits and AI settings from the environment', () => {
    process.env.NODE_ENV = 'test';
    Object.assign(process.env, {
      PORT: '4555',
      ALLOWED_ORIGINS: 'https://a.example, https://b.example ,',
      RATE_LIMIT_AUTH: '7',
      AI_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-test',
      ALLOW_PRIVATE_URL_FETCH: 'true',
      COOKIE_SECURE: 'false',
    });
    const c = loadConfig({ encryptionKey: 'x' });
    expect(c.port).toBe(4555);
    expect(c.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(c.rateLimits.auth).toBe(7);
    expect(c).toMatchObject({ aiProvider: 'anthropic', anthropicApiKey: 'sk-test', allowPrivateUrlFetch: true, cookieSecure: false, logRequests: false });
  });

  it('defaults to safe local development settings', () => {
    process.env.NODE_ENV = 'test';
    for (const k of ['PORT', 'HOST', 'ALLOWED_ORIGINS', 'ALLOW_PRIVATE_URL_FETCH', 'AI_PROVIDER', 'COOKIE_SECURE']) delete process.env[k];
    const c = loadConfig({ encryptionKey: 'x' });
    expect(c).toMatchObject({ port: 4000, host: '127.0.0.1', aiProvider: 'heuristic', allowPrivateUrlFetch: false, cookieSecure: false });
    expect(c.allowedOrigins).toContain('http://localhost:4000');
  });
});
