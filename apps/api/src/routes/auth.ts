import { Router, type Response } from 'express';
import { z } from 'zod';
import { AppError, ErrorCodes } from '@pingx969/shared';
import { hashPassword, randomToken, sha256, verifyPassword } from '@pingx969/database';
import { SESSION_COOKIE, body, clientIp, rateLimit, requireAuth, csrfProtection, uid } from '../middleware';
import type { AppContext } from '../context';

const Credentials = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
  client: z.enum(['web', 'extension']).default('web'),
});
const Register = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
  name: z.string().trim().min(1).max(100),
});

// Constant-time-ish login: verify against a dummy hash when the user doesn't exist.
let dummyHash: Promise<string> | null = null;

export function authRoutes(ctx: AppContext): Router {
  const r = Router();
  const authLimiter = rateLimit('auth', () => ctx.config.rateLimits.auth, ctx.config.rateLimits.windowMs, (req) => `${clientIp(req)}:${String(req.body?.email ?? '').toLowerCase()}`);

  const issue = async (res: Response, userId: string, kind: 'web' | 'extension', ua: string) => {
    const token = randomToken();
    const csrf = randomToken(18);
    const days = kind === 'web' ? ctx.config.sessionTtlDays : ctx.config.extensionTokenTtlDays;
    const expires = new Date(Date.now() + days * 86400_000);
    const session = await ctx.repos.createSession(userId, sha256(token), kind, csrf, expires, ua);
    if (kind === 'web') {
      res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: ctx.config.cookieSecure, path: '/', expires });
      return { csrfToken: csrf, expiresAt: session.expiresAt };
    }
    return { token, expiresAt: session.expiresAt, sessionId: session.id };
  };

  r.post('/register', authLimiter, async (req, res) => {
    const input = body(Register, req);
    if (await ctx.repos.findUserByEmail(input.email)) throw new AppError(ErrorCodes.CONFLICT, 'An account with this email already exists. Try signing in.', 409);
    const user = await ctx.repos.createUser(input.email, await hashPassword(input.password), input.name);
    const s = await issue(res, user.id, 'web', String(req.headers['user-agent'] ?? ''));
    res.status(201).json({ user, ...s });
  });

  r.post('/login', authLimiter, async (req, res) => {
    const input = body(Credentials, req);
    const user = await ctx.repos.findUserByEmail(input.email);
    dummyHash ??= hashPassword('dummy-password-for-timing');
    const ok = user ? await verifyPassword(input.password, user.passwordHash) : (await verifyPassword(input.password, await dummyHash), false);
    if (!user || !ok) throw new AppError(ErrorCodes.UNAUTHORIZED, 'Incorrect email or password.', 401);
    const { passwordHash: _ph, ...publicUser } = user;
    void _ph;
    const s = await issue(res, user.id, input.client, String(req.headers['user-agent'] ?? ''));
    res.json({ user: publicUser, ...s });
  });

  r.get('/me', requireAuth(), async (req, res) => {
    const user = await ctx.repos.getUser(uid(req));
    if (!user) throw new AppError(ErrorCodes.UNAUTHORIZED, 'Account not found.', 401);
    const { passwordHash: _ph, ...publicUser } = user;
    void _ph;
    res.json({ user: publicUser, csrfToken: req.auth!.via === 'cookie' ? req.auth!.session.csrfToken : undefined, client: req.auth!.session.kind, expiresAt: req.auth!.session.expiresAt });
  });

  r.post('/logout', requireAuth(), csrfProtection(), async (req, res) => {
    await ctx.repos.revokeSession(uid(req), req.auth!.session.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  r.get('/sessions', requireAuth(), async (req, res) => {
    const list = await ctx.repos.listSessions(uid(req));
    res.json({ sessions: list.map((s) => ({ id: s.id, kind: s.kind, createdAt: s.createdAt, lastUsedAt: s.lastUsedAt, expiresAt: s.expiresAt, userAgent: s.userAgent, current: s.id === req.auth!.session.id })) });
  });

  r.delete('/sessions/:id', requireAuth(), csrfProtection(), async (req, res) => {
    const ok = await ctx.repos.revokeSession(uid(req), String(req.params.id));
    if (!ok) throw new AppError(ErrorCodes.NOT_FOUND, 'Session not found.', 404);
    res.json({ ok: true });
  });

  return r;
}
