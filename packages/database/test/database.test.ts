import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cipher, LocalEncryptedStore, Repos, createDb, hashPassword, migrate, normalizeUrl, verifyPassword } from '../src';

describe('crypto', () => {
  it('encrypts with authentication and detects tampering', () => {
    const c = new Cipher(Cipher.generateKey());
    const sealed = c.seal({ ssn: 'secret', n: 1 });
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain('secret');
    expect(c.open(sealed)).toEqual({ ssn: 'secret', n: 1 });
    const raw = Buffer.from(sealed.slice(3), 'base64');
    raw[raw.length - 1] ^= 1;
    expect(() => c.decrypt(`v1:${raw.toString('base64')}`)).toThrow();
    expect(() => new Cipher(Cipher.generateKey()).decrypt(sealed)).toThrow();
    expect(() => new Cipher('dG9vLXNob3J0')).toThrow(/32 bytes/);
  });

  it('hashes passwords with scrypt and verifies in constant time', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h).toMatch(/^scrypt\$/);
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
});

describe('encrypted object store', () => {
  it('stores ciphertext on disk and rejects path traversal', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-store-'));
    const store = new LocalEncryptedStore(dir, new Cipher(Cipher.generateKey()));
    await store.put('u1/resumes/abc', new TextEncoder().encode('my resume'));
    expect(fs.readFileSync(path.join(dir, 'u1/resumes/abc')).toString()).not.toContain('my resume');
    expect((await store.get('u1/resumes/abc')).toString()).toBe('my resume');
    await expect(store.put('../escape', new Uint8Array([1]))).rejects.toThrow(/Invalid storage key/);
    await store.delete('u1/resumes/abc');
    await expect(store.get('u1/resumes/abc')).rejects.toThrow();
  });
});

describe('migrations and repositories', () => {
  it('migrates idempotently and enforces per-user data isolation', async () => {
    const db = await createDb({ dataDir: 'memory://' });
    expect(await migrate(db)).toEqual(['001_init.sql']);
    expect(await migrate(db)).toEqual([]);
    const tables = (await db.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1")).rows.map((r) => r.table_name);
    expect(tables).toEqual(expect.arrayContaining(['users', 'profiles', 'resumes', 'resume_versions', 'jobs', 'job_descriptions', 'applications', 'saved_answers', 'field_mappings', 'documents', 'optimization_runs', 'application_events', 'sessions', 'user_settings']));
    const repos = new Repos(db, new Cipher(Cipher.generateKey()));
    const a = await repos.createUser('a@example.com', 'x', 'A');
    const b = await repos.createUser('b@example.com', 'x', 'B');
    const saved = await repos.upsertAnswer(a.id, { questionKey: 'k', rawQuestion: 'Q', normalizedQuestion: 'Q', answer: 'secret answer', source: 'user', confidence: 1, sensitive: true });
    expect(await repos.getAnswer(b.id, saved.id)).toBeNull();
    expect(await repos.deleteAnswer(b.id, saved.id)).toBe(false);
    const enc = (await db.query<{ answer_enc: string }>('SELECT answer_enc FROM saved_answers')).rows[0].answer_enc;
    expect(enc).not.toContain('secret');
    // upsert by normalized key updates instead of duplicating
    await repos.upsertAnswer(a.id, { questionKey: 'k', rawQuestion: 'Q2', normalizedQuestion: 'Q', answer: 'updated', source: 'learned', confidence: 0.8, sensitive: true });
    expect((await repos.listAnswers(a.id)).map((x) => x.answer)).toEqual(['updated']);
    // case-insensitive unique email
    await expect(repos.createUser('A@EXAMPLE.COM', 'x', 'dup')).rejects.toThrow();
    // cascade delete
    await repos.deleteUser(a.id);
    expect((await db.query('SELECT * FROM saved_answers')).rows).toHaveLength(0);
    await db.close();
  });

  it('normalizes job URLs for matching', () => {
    expect(normalizeUrl('https://www.Boards.greenhouse.io/acme/jobs/123?gh_src=abc&utm_source=li')).toBe('boards.greenhouse.io/acme/jobs/123');
    expect(normalizeUrl('https://jobs.lever.co/acme/uuid/apply')).toBe('jobs.lever.co/acme/uuid');
  });
});
