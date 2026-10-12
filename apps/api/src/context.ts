import { Cipher, type Db, LocalEncryptedStore, type ObjectStore, Repos, createDb, migrate } from '@pingx969/database';
import { type AIProvider, HeuristicProvider, createProvider } from '@pingx969/resume-optimizer';
import { AppError, ErrorCodes } from '@pingx969/shared';
import type { Config } from './config';

export interface AppContext {
  config: Config;
  db: Db;
  repos: Repos;
  store: ObjectStore;
  cipher: Cipher;
  /** Resolve the AI provider to use for a request (falls back to local when unavailable). */
  provider(name?: string): AIProvider;
  availableProviders(): { name: string; available: boolean; external: boolean; model: string | null; reason?: string }[];
}

export async function createContext(config: Config, opts: { db?: Db; store?: ObjectStore; providerFactory?: (name: string) => AIProvider } = {}): Promise<AppContext> {
  const db = opts.db ?? (await createDb({ url: config.databaseUrl, dataDir: config.databaseUrl ? undefined : `${config.dataDir}/pglite` }));
  await migrate(db);
  const cipher = new Cipher(config.encryptionKey);
  const repos = new Repos(db, cipher);
  const store = opts.store ?? new LocalEncryptedStore(config.storageDir, cipher);
  const local = new HeuristicProvider();
  const provider = (name?: string): AIProvider => {
    const want = name || config.aiProvider;
    if (want === 'heuristic') return local;
    if (opts.providerFactory) return opts.providerFactory(want);
    if (want === 'anthropic') {
      if (!config.anthropicApiKey) throw new AppError(ErrorCodes.AI_FAILURE, 'The Anthropic provider is not configured on this server (missing ANTHROPIC_API_KEY).', 400);
      return createProvider({ provider: 'anthropic', anthropic: { apiKey: config.anthropicApiKey, model: config.aiModel, timeoutMs: Math.min(config.aiTimeoutMs, 120_000) } });
    }
    throw new AppError(ErrorCodes.VALIDATION, `Unknown AI provider "${want}".`, 400);
  };
  return {
    config,
    db,
    repos,
    store,
    cipher,
    provider,
    availableProviders: () => [
      { name: 'heuristic', available: true, external: false, model: null },
      {
        name: 'anthropic',
        available: !!config.anthropicApiKey || !!opts.providerFactory,
        external: true,
        model: config.aiModel || 'claude-opus-5',
        reason: config.anthropicApiKey ? undefined : 'Set ANTHROPIC_API_KEY on the server to enable.',
      },
    ],
  };
}
