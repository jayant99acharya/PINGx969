import fs from 'node:fs/promises';
import path from 'node:path';
import type { Cipher } from './crypto';

/** Object storage abstraction for uploaded documents. */
export interface ObjectStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/**
 * Local filesystem store; every object is encrypted with AES-256-GCM before it touches disk.
 * Keys are generated server-side (never user-controlled) and validated against traversal.
 */
export class LocalEncryptedStore implements ObjectStore {
  constructor(
    private root: string,
    private cipher: Cipher,
  ) {}

  private pathFor(key: string): string {
    if (!/^[a-z0-9/_-]+$/i.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return p;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const p = this.pathFor(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, this.cipher.encryptBytes(bytes), { mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    return this.cipher.decryptBytes(await fs.readFile(this.pathFor(key)));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.pathFor(key), { force: true });
  }
}

/** In-memory store for tests. */
export class MemoryStore implements ObjectStore {
  private m = new Map<string, Buffer>();
  async put(key: string, bytes: Uint8Array) {
    this.m.set(key, Buffer.from(bytes));
  }
  async get(key: string) {
    const v = this.m.get(key);
    if (!v) throw new Error('not found');
    return v;
  }
  async delete(key: string) {
    this.m.delete(key);
  }
}
