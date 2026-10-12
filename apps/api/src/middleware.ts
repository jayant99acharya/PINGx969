import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { ZodError, type ZodType, type z } from 'zod';
import { AppError, ErrorCodes } from '@pingx969/shared';
import { type SessionRow, sha256 } from '@pingx969/database';
import type { AppContext } from './context';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: { userId: string; session: SessionRow; via: 'cookie' | 'bearer' };
    ctx: AppContext;
  }
}

export const SESSION_COOKIE = 'px_session';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* ignore bad cookie */
    }
  }
  return out;
}

/** Authenticate via HttpOnly session cookie (web) or Bearer token (extension). */
export function requireAuth(): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization;
    let token: string | undefined;
    let via: 'cookie' | 'bearer' = 'cookie';
    if (header?.startsWith('Bearer ')) {
      token = header.slice(7).trim();
      via = 'bearer';
    } else token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return next(new AppError(ErrorCodes.UNAUTHORIZED, 'Please sign in to continue.', 401));
    const session = await req.ctx.repos.findSessionByTokenHash(sha256(token));
    if (!session || session.revokedAt) return next(new AppError(ErrorCodes.UNAUTHORIZED, 'Your session is no longer valid. Please sign in again.', 401));
    if (new Date(session.expiresAt).getTime() < Date.now()) return next(new AppError(ErrorCodes.SESSION_EXPIRED, 'Your session has expired. Please sign in again.', 401));
    // Bearer tokens are only issued to the extension; cookies only to the web app.
    if ((via === 'bearer') !== (session.kind === 'extension')) return next(new AppError(ErrorCodes.UNAUTHORIZED, 'Invalid credentials for this client.', 401));
    if (Date.now() - new Date(session.lastUsedAt).getTime() > 5 * 60_000) void req.ctx.repos.touchSession(session.id);
    req.auth = { userId: session.userId, session, via };
    next();
  };
}

/**
 * CSRF protection for cookie-authenticated requests: state-changing methods must send the
 * per-session token in X-CSRF-Token, and a present Origin header must be an allowed origin.
 * Bearer-token requests are not CSRF-able (browsers never attach them automatically).
 */
export function csrfProtection(): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth || req.auth.via === 'bearer' || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && !req.ctx.config.allowedOrigins.includes(origin) && origin !== `${req.protocol}://${req.headers.host}`) {
      return next(new AppError(ErrorCodes.CSRF, 'Request origin not allowed.', 403));
    }
    if (req.headers['x-csrf-token'] !== req.auth.session.csrfToken) return next(new AppError(ErrorCodes.CSRF, 'Security token missing or invalid. Refresh the page and try again.', 403));
    next();
  };
}

/** Sliding-window in-memory rate limiter. */
export function rateLimit(name: string, limit: () => number, windowMs: number, key: (req: Request) => string): RequestHandler {
  const hits = new Map<string, number[]>();
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, v] of hits) {
      const kept = v.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept);
      else hits.delete(k);
    }
  }, windowMs);
  timer.unref?.();
  return (req, res, next) => {
    const k = `${name}:${key(req)}`;
    const now = Date.now();
    const arr = (hits.get(k) ?? []).filter((t) => t > now - windowMs);
    const max = limit();
    if (arr.length >= max) {
      res.setHeader('Retry-After', Math.ceil((arr[0] + windowMs - now) / 1000));
      return next(new AppError(ErrorCodes.RATE_LIMITED, 'Too many requests. Please slow down and try again shortly.', 429));
    }
    arr.push(now);
    hits.set(k, arr);
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - arr.length)));
    next();
  };
}

export const clientIp = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';

export function body<T extends ZodType>(schema: T, req: Request): z.infer<T> {
  return schema.parse(req.body ?? {});
}

export function query<T extends ZodType>(schema: T, req: Request): z.infer<T> {
  return schema.parse(req.query ?? {});
}

export function errorHandler() {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details && !(err.details as { cause?: string }).cause ? err.details : undefined } });
    }
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: {
          code: ErrorCodes.VALIDATION,
          message: 'Some fields are invalid: ' + err.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'input'} — ${i.message}`).join('; '),
          details: err.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    if (err instanceof multer.MulterError) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({ error: { code: tooBig ? ErrorCodes.FILE_TOO_LARGE : ErrorCodes.VALIDATION, message: tooBig ? 'Files must be 5 MB or smaller.' : `Upload failed: ${err.message}` } });
    }
    const e = err as { type?: string; status?: number; message?: string };
    if (e?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: ErrorCodes.VALIDATION, message: 'The request body is not valid JSON.' } });
    if (e?.type === 'entity.too.large') return res.status(413).json({ error: { code: ErrorCodes.FILE_TOO_LARGE, message: 'The request is too large.' } });
    console.error(`[api] ${req.method} ${req.path} failed:`, err);
    return res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong on our side. Please try again.' } });
  };
}

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10, fieldSize: 100 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(pdf|docx|txt|md|markdown|json)$/i.test(file.originalname);
    if (!ok) return cb(new AppError(ErrorCodes.UNSUPPORTED_FILE, 'Unsupported file type. Upload PDF, DOCX, TXT, Markdown, or JSON.', 415));
    cb(null, true);
  },
});

export function uid(req: Request): string {
  if (!req.auth) throw new AppError(ErrorCodes.UNAUTHORIZED, 'Please sign in to continue.', 401);
  return req.auth.userId;
}

export function notFound(what: string): AppError {
  return new AppError(ErrorCodes.NOT_FOUND, `${what} not found.`, 404);
}
