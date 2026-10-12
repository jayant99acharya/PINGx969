import path from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { AppError, ErrorCodes } from '@pingx969/shared';
import type { AppContext } from './context';
import { clientIp, csrfProtection, errorHandler, rateLimit, requireAuth } from './middleware';
import { authRoutes } from './routes/auth';
import { resumeRoutes } from './routes/resumes';
import { jobRoutes } from './routes/jobs';
import { versionRoutes } from './routes/versions';
import { applicationRoutes } from './routes/applications';
import { answerRoutes, mappingRoutes } from './routes/answers';
import { accountRoutes, autofillRoutes, dashboardRoutes, profileRoutes, settingsRoutes } from './routes/account';

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', ctx.config.isProd ? 1 : false);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"], // docx-preview injects <style>
          'img-src': ["'self'", 'data:', 'blob:'],
          'font-src': ["'self'", 'data:'],
          'frame-src': ["'self'", 'blob:'],
          'object-src': ["'none'"],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'upgrade-insecure-requests': ctx.config.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: ctx.config.isProd,
    }),
  );
  app.use((req, _res, next) => {
    req.ctx = ctx;
    next();
  });
  if (ctx.config.logRequests) {
    app.use((req, res, next) => {
      const t = Date.now();
      res.on('finish', () => {
        if (req.path.startsWith('/api')) console.log(`[api] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - t}ms`);
      });
      next();
    });
  }
  app.use('/api', express.json({ limit: '1mb' }));

  const apiLimiter = rateLimit('api', () => ctx.config.rateLimits.api, ctx.config.rateLimits.windowMs, (req) => req.auth?.userId ?? clientIp(req));
  const heavyLimiter = rateLimit('heavy', () => ctx.config.rateLimits.heavy, ctx.config.rateLimits.windowMs, (req) => req.auth?.userId ?? clientIp(req));

  app.get('/api/health', async (_req, res) => {
    await ctx.db.query('SELECT 1');
    res.json({ ok: true, db: ctx.db.kind, webUrl: ctx.config.webUrl, providers: ctx.availableProviders().filter((p) => p.available).map((p) => p.name) });
  });
  app.use('/api/auth', authRoutes(ctx));

  const authed = express.Router();
  authed.use(requireAuth(), apiLimiter, csrfProtection());
  authed.use('/resumes', resumeRoutes(ctx, heavyLimiter));
  authed.use('/jobs', jobRoutes(ctx, heavyLimiter));
  authed.use('/versions', versionRoutes(ctx, heavyLimiter));
  authed.use('/applications', applicationRoutes(ctx));
  authed.use('/answers', answerRoutes(ctx));
  authed.use('/field-mappings', mappingRoutes(ctx));
  authed.use('/profile', profileRoutes(ctx));
  authed.use('/settings', settingsRoutes(ctx));
  authed.use('/account', accountRoutes(ctx));
  authed.use('/dashboard', dashboardRoutes(ctx));
  authed.use('/autofill', autofillRoutes(ctx));
  app.use('/api', authed);
  app.use('/api', (_req, _res, next) => next(new AppError(ErrorCodes.NOT_FOUND, 'Endpoint not found.', 404)));

  // Production: serve the built dashboard (same origin => no CORS needed).
  if (ctx.config.webDist) {
    app.use(express.static(ctx.config.webDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(ctx.config.webDist!, 'index.html')));
  }
  app.use(errorHandler());
  return app;
}
