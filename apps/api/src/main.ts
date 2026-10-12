import { loadConfig } from './config';
import { createContext } from './context';
import { createApp } from './app';

async function main() {
  const config = loadConfig();
  const ctx = await createContext(config);
  const app = createApp(ctx);
  const server = app.listen(config.port, config.host, () => {
    console.log(`[api] PINGx969 API listening on http://${config.host}:${config.port} (db: ${ctx.db.kind}, ai: ${config.aiProvider})`);
    if (config.webDist) console.log(`[api] Serving dashboard from ${config.webDist}`);
  });
  const shutdown = async () => {
    server.close();
    await ctx.db.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error('[api] Failed to start:', e);
  process.exit(1);
});
