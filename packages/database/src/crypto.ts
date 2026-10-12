import crypto from 'node:crypto';

/**
 * Field-level encryption (AES-256-GCM) for personal data at rest.
 * Format: "v1:" + base64(iv[12] | tag[16] | ciphertext). The key comes from
 * APP_ENCRYPTION_KEY (32 bytes, base64) and never leaves the server.
 */
export class Cipher {
  private key: Buffer;

  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, 'base64');
    if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes encoded as base64 (generate with: openssl rand -base64 32)');
    this.key = key;
  }

  static generateKey(): string {
    return crypto.randomBytes(32).toString('base64');
  }

  encryptBytes(plain: Uint8Array): Buffer {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(plain), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]);
  }

  decryptBytes(blob: Uint8Array): Buffer {
    const b = Buffer.from(blob);
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]);
  }

  encrypt(text: string): string {
    return `v1:${this.encryptBytes(Buffer.from(text, 'utf8')).toString('base64')}`;
  }

  decrypt(sealed: string): string {
    if (!sealed.startsWith('v1:')) throw new Error('Unknown ciphertext format');
    return this.decryptBytes(Buffer.from(sealed.slice(3), 'base64')).toString('utf8');
  }

  seal(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  open<T>(sealed: string): T {
    return JSON.parse(this.decrypt(sealed)) as T;
  }
}

export function sha256(data: Uint8Array | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), { N: Number(n), r: Number(r), p: Number(p) });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function scrypt(password: string, salt: Buffer, params: { N: number; r: number; p: number } = SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: params.N, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}
