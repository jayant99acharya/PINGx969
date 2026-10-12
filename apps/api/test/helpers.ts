import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { Express } from 'express';
import { Cipher, MemoryStore, createDb } from '@pingx969/database';
import { loadConfig } from '../src/config';
import { createContext, type AppContext } from '../src/context';
import { createApp } from '../src/app';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const fixture = (p: string) => fs.readFileSync(path.join(root, 'fixtures', p));

export async function makeApp(overrides: Parameters<typeof loadConfig>[0] = {}): Promise<{ app: Express; ctx: AppContext }> {
  process.env.NODE_ENV = 'test';
  const config = loadConfig({ encryptionKey: Cipher.generateKey(), webDist: null, logRequests: false, ...overrides });
  const ctx = await createContext(config, { db: await createDb({ dataDir: 'memory://' }), store: new MemoryStore() });
  return { app: createApp(ctx), ctx };
}

export interface Session {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  userId: string;
}

export async function register(app: Express, email = `user${Math.random().toString(36).slice(2, 8)}@example.com`, password = 'correct-horse-battery'): Promise<Session> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({ email, password, name: 'Test User' }).expect(201);
  return { agent, csrf: res.body.csrfToken, userId: res.body.user.id };
}
