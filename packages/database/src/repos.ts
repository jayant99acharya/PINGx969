import {
  type ApplicationStatus,
  type JobAnalysis,
  type ParsedResume,
  type Profile,
  ProfileSchema,
  type ScoringWeights,
  type VersionPayload,
  emptyProfile,
} from '@pingx969/shared';
import type { Cipher } from './crypto';
import type { Db, Queryable } from './db';

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d ? String(d) : null);

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}
export interface SessionRow {
  id: string;
  userId: string;
  kind: 'web' | 'extension';
  csrfToken: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string;
  userAgent: string;
}
export interface Settings {
  scoringWeights: Partial<ScoringWeights> | null;
  aiProvider: string;
  autoLearn: boolean;
  showLauncher: boolean;
}
export interface ResumeRow {
  id: string;
  name: string;
  sourceFormat: ParsedResume['document']['format'];
  sourceDocumentId: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface JobRow {
  id: string;
  title: string;
  company: string;
  url: string;
  urlNormalized: string;
  location: string;
  seniority: string;
  workArrangement: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}
export interface JobDescriptionRow {
  id: string;
  jobId: string;
  rawText: string;
  source: string;
  analysis: JobAnalysis;
  provider: string;
  createdAt: string;
}
export interface VersionRow {
  id: string;
  resumeId: string;
  jobId: string | null;
  jobDescriptionId: string | null;
  label: string;
  company: string;
  jobTitle: string;
  jobUrl: string;
  matchBefore: number;
  matchAfter: number;
  provider: string;
  createdAt: string;
  updatedAt: string;
}
export interface ApplicationRow {
  id: string;
  jobId: string | null;
  resumeVersionId: string | null;
  company: string;
  jobTitle: string;
  jobUrl: string;
  status: ApplicationStatus;
  matchScore: number | null;
  notes: string;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AnswerRow {
  id: string;
  questionKey: string;
  rawQuestion: string;
  normalizedQuestion: string;
  answer: string;
  source: 'user' | 'learned' | 'imported' | 'profile';
  confidence: number;
  sensitive: boolean;
  useCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface FieldMappingRow {
  id: string;
  host: string;
  signature: string;
  label: string;
  fieldType: string;
  questionKey: string | null;
  createdAt: string;
  updatedAt: string;
}

type R = Record<string, unknown>;

export function normalizeUrl(raw: string): string {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const drop = /^(utm_|gh_src|source|ref|lever-source|src$|trk|gclid|fbclid)/i;
    const params = [...u.searchParams.entries()].filter(([k]) => !drop.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const q = new URLSearchParams(params).toString();
    const pathname = u.pathname.replace(/\/(apply|application)\/?$/i, '').replace(/\/+$/, '');
    return `${u.hostname.replace(/^www\./, '').toLowerCase()}${pathname.toLowerCase()}${q ? `?${q}` : ''}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** Data access with transparent encryption of personal data. All queries are user-scoped. */
export class Repos {
  constructor(
    public db: Db,
    private cipher: Cipher,
  ) {}

  private q(tx?: Queryable): Queryable {
    return tx ?? this.db;
  }

  // ------------------------------------------------------------ users / sessions
  async createUser(email: string, passwordHash: string, displayName: string): Promise<UserRow> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<R>('INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING *', [email.trim(), passwordHash, displayName]);
      const u = rows[0];
      await tx.query('INSERT INTO user_settings (user_id) VALUES ($1)', [u.id]);
      const profile = emptyProfile();
      profile.personal.email = email.trim();
      const [first, ...rest] = displayName.trim().split(/\s+/);
      profile.personal.firstName = first ?? '';
      profile.personal.lastName = rest.join(' ');
      await tx.query('INSERT INTO profiles (user_id, data_enc) VALUES ($1, $2)', [u.id, this.cipher.seal(profile)]);
      return this.mapUser(u);
    });
  }

  private mapUser(r: R): UserRow {
    return { id: String(r.id), email: String(r.email), displayName: String(r.display_name ?? ''), createdAt: iso(r.created_at)! };
  }

  async findUserByEmail(email: string): Promise<(UserRow & { passwordHash: string }) | null> {
    const { rows } = await this.db.query<R>('SELECT * FROM users WHERE lower(email) = lower($1)', [email.trim()]);
    return rows[0] ? { ...this.mapUser(rows[0]), passwordHash: String(rows[0].password_hash) } : null;
  }

  async getUser(id: string): Promise<(UserRow & { passwordHash: string }) | null> {
    const { rows } = await this.db.query<R>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? { ...this.mapUser(rows[0]), passwordHash: String(rows[0].password_hash) } : null;
  }

  async deleteUser(id: string): Promise<void> {
    await this.db.query('DELETE FROM users WHERE id = $1', [id]);
  }

  async createSession(userId: string, tokenHash: string, kind: 'web' | 'extension', csrf: string, expiresAt: Date, userAgent: string): Promise<SessionRow> {
    const { rows } = await this.db.query<R>(
      'INSERT INTO sessions (user_id, token_hash, kind, csrf_token, expires_at, user_agent) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [userId, tokenHash, kind, csrf, expiresAt.toISOString(), userAgent.slice(0, 300)],
    );
    return this.mapSession(rows[0]);
  }

  private mapSession(r: R): SessionRow {
    return {
      id: String(r.id),
      userId: String(r.user_id),
      kind: r.kind as SessionRow['kind'],
      csrfToken: String(r.csrf_token),
      expiresAt: iso(r.expires_at)!,
      revokedAt: iso(r.revoked_at),
      createdAt: iso(r.created_at)!,
      lastUsedAt: iso(r.last_used_at)!,
      userAgent: String(r.user_agent ?? ''),
    };
  }

  async findSessionByTokenHash(hash: string): Promise<SessionRow | null> {
    const { rows } = await this.db.query<R>('SELECT * FROM sessions WHERE token_hash = $1', [hash]);
    return rows[0] ? this.mapSession(rows[0]) : null;
  }

  async touchSession(id: string): Promise<void> {
    await this.db.query('UPDATE sessions SET last_used_at = now() WHERE id = $1', [id]);
  }

  async revokeSession(userId: string, id: string): Promise<boolean> {
    const { rows } = await this.db.query<R>('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id', [id, userId]);
    return rows.length > 0;
  }

  async listSessions(userId: string): Promise<SessionRow[]> {
    const { rows } = await this.db.query<R>('SELECT * FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_used_at DESC', [userId]);
    return rows.map((r) => this.mapSession(r));
  }

  // ------------------------------------------------------------ settings / profile
  async getSettings(userId: string): Promise<Settings> {
    const { rows } = await this.db.query<R>('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
    const r = rows[0] ?? {};
    return {
      scoringWeights: (r.scoring_weights as Partial<ScoringWeights>) ?? null,
      aiProvider: String(r.ai_provider ?? 'heuristic'),
      autoLearn: r.auto_learn !== false,
      showLauncher: r.show_launcher !== false,
    };
  }

  async updateSettings(userId: string, s: Partial<Settings>): Promise<Settings> {
    const cur = await this.getSettings(userId);
    const next = { ...cur, ...s };
    await this.db.query(
      `INSERT INTO user_settings (user_id, scoring_weights, ai_provider, auto_learn, show_launcher, updated_at) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (user_id) DO UPDATE SET scoring_weights = $2, ai_provider = $3, auto_learn = $4, show_launcher = $5, updated_at = now()`,
      [userId, next.scoringWeights ? JSON.stringify(next.scoringWeights) : null, next.aiProvider, next.autoLearn, next.showLauncher],
    );
    return next;
  }

  async getProfile(userId: string): Promise<{ profile: Profile; version: number; updatedAt: string }> {
    const { rows } = await this.db.query<R>('SELECT * FROM profiles WHERE user_id = $1', [userId]);
    if (!rows[0]) return { profile: emptyProfile(), version: 0, updatedAt: new Date(0).toISOString() };
    const parsed = ProfileSchema.safeParse(this.cipher.open(String(rows[0].data_enc)));
    return { profile: parsed.success ? parsed.data : emptyProfile(), version: Number(rows[0].version), updatedAt: iso(rows[0].updated_at)! };
  }

  async saveProfile(userId: string, profile: Profile): Promise<{ version: number; updatedAt: string }> {
    const { rows } = await this.db.query<R>(
      `INSERT INTO profiles (user_id, data_enc, version, updated_at) VALUES ($1, $2, 1, now())
       ON CONFLICT (user_id) DO UPDATE SET data_enc = $2, version = profiles.version + 1, updated_at = now() RETURNING version, updated_at`,
      [userId, this.cipher.seal(ProfileSchema.parse(profile))],
    );
    return { version: Number(rows[0].version), updatedAt: iso(rows[0].updated_at)! };
  }

  // ------------------------------------------------------------ documents
  async createDocument(userId: string, d: { kind: string; filename: string; mimeType: string; size: number; sha256: string; storageKey: string }, tx?: Queryable): Promise<string> {
    const { rows } = await this.q(tx).query<R>(
      'INSERT INTO documents (user_id, kind, filename, mime_type, size_bytes, sha256, storage_key) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [userId, d.kind, d.filename.slice(0, 255), d.mimeType, d.size, d.sha256, d.storageKey],
    );
    return String(rows[0].id);
  }

  async getDocument(userId: string, id: string): Promise<{ id: string; filename: string; mimeType: string; storageKey: string } | null> {
    const { rows } = await this.db.query<R>('SELECT * FROM documents WHERE id = $1 AND user_id = $2', [id, userId]);
    const r = rows[0];
    return r ? { id: String(r.id), filename: String(r.filename), mimeType: String(r.mime_type), storageKey: String(r.storage_key) } : null;
  }

  async listDocumentKeys(userId: string): Promise<string[]> {
    const { rows } = await this.db.query<R>('SELECT storage_key FROM documents WHERE user_id = $1', [userId]);
    return rows.map((r) => String(r.storage_key));
  }

  // ------------------------------------------------------------ resumes
  private mapResume(r: R): ResumeRow {
    return {
      id: String(r.id),
      name: String(r.name),
      sourceFormat: r.source_format as ResumeRow['sourceFormat'],
      sourceDocumentId: r.source_document_id ? String(r.source_document_id) : null,
      isDefault: !!r.is_default,
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
    };
  }

  async createResume(userId: string, name: string, format: string, documentId: string | null, parsed: ParsedResume): Promise<ResumeRow> {
    return this.db.transaction(async (tx) => {
      const { rows: existing } = await tx.query<R>('SELECT count(*)::int AS n FROM resumes WHERE user_id = $1', [userId]);
      const isDefault = Number(existing[0].n) === 0;
      const { rows } = await tx.query<R>(
        'INSERT INTO resumes (user_id, name, source_format, source_document_id, content_enc, is_default) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [userId, name.slice(0, 200), format, documentId, this.cipher.seal(parsed), isDefault],
      );
      return this.mapResume(rows[0]);
    });
  }

  async listResumes(userId: string): Promise<(ResumeRow & { versionCount: number })[]> {
    const { rows } = await this.db.query<R>(
      `SELECT r.*, (SELECT count(*)::int FROM resume_versions v WHERE v.resume_id = r.id) AS version_count
       FROM resumes r WHERE r.user_id = $1 ORDER BY r.is_default DESC, r.created_at DESC`,
      [userId],
    );
    return rows.map((r) => ({ ...this.mapResume(r), versionCount: Number(r.version_count) }));
  }

  async getResume(userId: string, id: string): Promise<(ResumeRow & { parsed: ParsedResume }) | null> {
    const { rows } = await this.db.query<R>('SELECT * FROM resumes WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!rows[0]) return null;
    return { ...this.mapResume(rows[0]), parsed: this.cipher.open<ParsedResume>(String(rows[0].content_enc)) };
  }

  async updateResumeParsed(userId: string, id: string, parsed: ParsedResume): Promise<void> {
    await this.db.query('UPDATE resumes SET content_enc = $3, updated_at = now() WHERE id = $1 AND user_id = $2', [id, userId, this.cipher.seal(parsed)]);
  }

  async updateResume(userId: string, id: string, patch: { name?: string; isDefault?: boolean }): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      if (patch.isDefault) await tx.query('UPDATE resumes SET is_default = false WHERE user_id = $1', [userId]);
      const { rows } = await tx.query<R>(
        'UPDATE resumes SET name = COALESCE($3, name), is_default = COALESCE($4, is_default), updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId, patch.name ?? null, patch.isDefault ?? null],
      );
      return rows.length > 0;
    });
  }

  async deleteResume(userId: string, id: string): Promise<string | null> {
    const { rows } = await this.db.query<R>(
      'DELETE FROM resumes WHERE id = $1 AND user_id = $2 RETURNING (SELECT storage_key FROM documents d WHERE d.id = resumes.source_document_id) AS storage_key, source_document_id',
      [id, userId],
    );
    if (!rows[0]) return null;
    if (rows[0].source_document_id) await this.db.query('DELETE FROM documents WHERE id = $1 AND user_id = $2', [rows[0].source_document_id, userId]);
    return rows[0].storage_key ? String(rows[0].storage_key) : '';
  }

  // ------------------------------------------------------------ jobs
  private mapJob(r: R): JobRow {
    return {
      id: String(r.id),
      title: String(r.title),
      company: String(r.company),
      url: String(r.url),
      urlNormalized: String(r.url_normalized),
      location: String(r.location),
      seniority: String(r.seniority),
      workArrangement: String(r.work_arrangement),
      source: String(r.source),
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
    };
  }

  async createJob(userId: string, j: { title: string; company: string; url: string; location: string; seniority: string; workArrangement: string; source: string }, jd: { rawText: string; source: string; analysis: JobAnalysis; provider: string }): Promise<{ job: JobRow; descriptionId: string }> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<R>(
        `INSERT INTO jobs (user_id, title, company, url, url_normalized, location, seniority, work_arrangement, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [userId, j.title.slice(0, 300), j.company.slice(0, 300), j.url.slice(0, 2048), normalizeUrl(j.url), j.location.slice(0, 200), j.seniority, j.workArrangement, j.source],
      );
      const job = this.mapJob(rows[0]);
      const d = await tx.query<R>('INSERT INTO job_descriptions (job_id, user_id, raw_text, source, analysis, provider) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [
        job.id,
        userId,
        jd.rawText,
        jd.source,
        JSON.stringify(jd.analysis),
        jd.provider,
      ]);
      return { job, descriptionId: String(d.rows[0].id) };
    });
  }

  async listJobs(userId: string): Promise<(JobRow & { versionCount: number; bestMatch: number | null })[]> {
    const { rows } = await this.db.query<R>(
      `SELECT j.*, (SELECT count(*)::int FROM resume_versions v WHERE v.job_id = j.id) AS version_count,
              (SELECT max(match_after) FROM resume_versions v WHERE v.job_id = j.id) AS best_match
       FROM jobs j WHERE j.user_id = $1 ORDER BY j.created_at DESC`,
      [userId],
    );
    return rows.map((r) => ({ ...this.mapJob(r), versionCount: Number(r.version_count), bestMatch: r.best_match == null ? null : Number(r.best_match) }));
  }

  async getJob(userId: string, id: string): Promise<(JobRow & { description: JobDescriptionRow | null }) | null> {
    const { rows } = await this.db.query<R>('SELECT * FROM jobs WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!rows[0]) return null;
    const d = await this.db.query<R>('SELECT * FROM job_descriptions WHERE job_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1', [id, userId]);
    const r = d.rows[0];
    return {
      ...this.mapJob(rows[0]),
      description: r
        ? { id: String(r.id), jobId: String(r.job_id), rawText: String(r.raw_text), source: String(r.source), analysis: r.analysis as JobAnalysis, provider: String(r.provider), createdAt: iso(r.created_at)! }
        : null,
    };
  }

  async deleteJob(userId: string, id: string): Promise<boolean> {
    const { rows } = await this.db.query<R>('DELETE FROM jobs WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
    return rows.length > 0;
  }

  /** Find a saved job matching an application page: by normalized URL, else company + title. */
  async findJobForPage(userId: string, url: string, company: string, title: string): Promise<JobRow | null> {
    const nu = normalizeUrl(url);
    if (nu) {
      const { rows } = await this.db.query<R>(
        `SELECT * FROM jobs WHERE user_id = $1 AND url_normalized <> '' AND ($2 LIKE url_normalized || '%' OR url_normalized LIKE $2 || '%') ORDER BY length(url_normalized) DESC LIMIT 1`,
        [userId, nu],
      );
      if (rows[0]) return this.mapJob(rows[0]);
    }
    if (company && title) {
      const { rows } = await this.db.query<R>(
        `SELECT * FROM jobs WHERE user_id = $1 AND lower(company) = lower($2) AND (lower(title) = lower($3) OR position(lower($3) in lower(title)) > 0 OR position(lower(title) in lower($3)) > 0) ORDER BY created_at DESC LIMIT 1`,
        [userId, company.trim(), title.trim()],
      );
      if (rows[0]) return this.mapJob(rows[0]);
    }
    return null;
  }

  // ------------------------------------------------------------ versions
  private mapVersion(r: R): VersionRow {
    return {
      id: String(r.id),
      resumeId: String(r.resume_id),
      jobId: r.job_id ? String(r.job_id) : null,
      jobDescriptionId: r.job_description_id ? String(r.job_description_id) : null,
      label: String(r.label),
      company: String(r.company),
      jobTitle: String(r.job_title),
      jobUrl: String(r.job_url),
      matchBefore: Number(r.match_before),
      matchAfter: Number(r.match_after),
      provider: String(r.provider),
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
    };
  }

  async createVersion(userId: string, v: Omit<VersionRow, 'id' | 'createdAt' | 'updatedAt'> & { payload: VersionPayload }): Promise<VersionRow> {
    const { rows } = await this.db.query<R>(
      `INSERT INTO resume_versions (resume_id, user_id, job_id, job_description_id, label, company, job_title, job_url, match_before, match_after, provider, payload_enc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [v.resumeId, userId, v.jobId, v.jobDescriptionId, v.label.slice(0, 300), v.company, v.jobTitle, v.jobUrl, v.matchBefore, v.matchAfter, v.provider, this.cipher.seal(v.payload)],
    );
    return this.mapVersion(rows[0]);
  }

  async listVersions(userId: string, filter: { resumeId?: string; jobId?: string } = {}): Promise<VersionRow[]> {
    const { rows } = await this.db.query<R>(
      `SELECT * FROM resume_versions WHERE user_id = $1 AND ($2::uuid IS NULL OR resume_id = $2) AND ($3::uuid IS NULL OR job_id = $3) ORDER BY created_at DESC`,
      [userId, filter.resumeId ?? null, filter.jobId ?? null],
    );
    return rows.map((r) => this.mapVersion(r));
  }

  async getVersion(userId: string, id: string): Promise<(VersionRow & { payload: VersionPayload }) | null> {
    const { rows } = await this.db.query<R>('SELECT * FROM resume_versions WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!rows[0]) return null;
    return { ...this.mapVersion(rows[0]), payload: this.cipher.open<VersionPayload>(String(rows[0].payload_enc)) };
  }

  async updateVersion(userId: string, id: string, patch: { label?: string; matchAfter?: number; payload?: VersionPayload }): Promise<boolean> {
    const { rows } = await this.db.query<R>(
      `UPDATE resume_versions SET label = COALESCE($3, label), match_after = COALESCE($4, match_after), payload_enc = COALESCE($5, payload_enc), updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId, patch.label ?? null, patch.matchAfter ?? null, patch.payload ? this.cipher.seal(patch.payload) : null],
    );
    return rows.length > 0;
  }

  async deleteVersion(userId: string, id: string): Promise<boolean> {
    const { rows } = await this.db.query<R>('DELETE FROM resume_versions WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
    return rows.length > 0;
  }

  async recordRun(userId: string, r: { resumeId: string; jobDescriptionId: string | null; versionId: string | null; provider: string; status: 'succeeded' | 'fallback' | 'failed'; durationMs: number; warnings: string[]; error?: string }): Promise<void> {
    await this.db.query(
      'INSERT INTO optimization_runs (user_id, resume_id, job_description_id, version_id, provider, status, duration_ms, warnings, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [userId, r.resumeId, r.jobDescriptionId, r.versionId, r.provider, r.status, Math.round(r.durationMs), JSON.stringify(r.warnings), r.error ?? null],
    );
  }

  // ------------------------------------------------------------ applications
  private mapApp(r: R): ApplicationRow {
    return {
      id: String(r.id),
      jobId: r.job_id ? String(r.job_id) : null,
      resumeVersionId: r.resume_version_id ? String(r.resume_version_id) : null,
      company: String(r.company),
      jobTitle: String(r.job_title),
      jobUrl: String(r.job_url),
      status: r.status as ApplicationStatus,
      matchScore: r.match_score == null ? null : Number(r.match_score),
      notes: String(r.notes ?? ''),
      appliedAt: iso(r.applied_at),
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
    };
  }

  async createApplication(userId: string, a: { jobId?: string | null; resumeVersionId?: string | null; company: string; jobTitle: string; jobUrl: string; status: ApplicationStatus; matchScore?: number | null; notes?: string }, eventData: Record<string, unknown> = {}): Promise<ApplicationRow> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<R>(
        `INSERT INTO applications (user_id, job_id, resume_version_id, company, job_title, job_url, url_normalized, status, match_score, notes, applied_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $8 = 'applied' THEN now() ELSE NULL END) RETURNING *`,
        [userId, a.jobId ?? null, a.resumeVersionId ?? null, a.company.slice(0, 300), a.jobTitle.slice(0, 300), a.jobUrl.slice(0, 2048), normalizeUrl(a.jobUrl), a.status, a.matchScore ?? null, (a.notes ?? '').slice(0, 10000)],
      );
      await tx.query('INSERT INTO application_events (application_id, user_id, type, to_status, data) VALUES ($1,$2,$3,$4,$5)', [rows[0].id, userId, 'created', a.status, JSON.stringify(eventData)]);
      return this.mapApp(rows[0]);
    });
  }

  async findApplicationByUrl(userId: string, url: string): Promise<ApplicationRow | null> {
    const nu = normalizeUrl(url);
    if (!nu) return null;
    const { rows } = await this.db.query<R>('SELECT * FROM applications WHERE user_id = $1 AND url_normalized = $2 ORDER BY created_at DESC LIMIT 1', [userId, nu]);
    return rows[0] ? this.mapApp(rows[0]) : null;
  }

  async getApplication(userId: string, id: string): Promise<ApplicationRow | null> {
    const { rows } = await this.db.query<R>('SELECT * FROM applications WHERE id = $1 AND user_id = $2', [id, userId]);
    return rows[0] ? this.mapApp(rows[0]) : null;
  }

  async listApplications(userId: string, f: { status?: string; q?: string } = {}): Promise<ApplicationRow[]> {
    const { rows } = await this.db.query<R>(
      `SELECT * FROM applications WHERE user_id = $1 AND ($2::text IS NULL OR status = $2)
       AND ($3::text IS NULL OR company ILIKE '%' || $3 || '%' OR job_title ILIKE '%' || $3 || '%') ORDER BY updated_at DESC`,
      [userId, f.status ?? null, f.q ? f.q.replace(/[%_\\]/g, (m) => `\\${m}`) : null],
    );
    return rows.map((r) => this.mapApp(r));
  }

  async updateApplication(userId: string, id: string, patch: Partial<Pick<ApplicationRow, 'status' | 'notes' | 'company' | 'jobTitle' | 'jobUrl' | 'resumeVersionId' | 'matchScore'>>, eventType = 'updated', eventData: Record<string, unknown> = {}): Promise<ApplicationRow | null> {
    return this.db.transaction(async (tx) => {
      const cur = await tx.query<R>('SELECT * FROM applications WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
      if (!cur.rows[0]) return null;
      const before = this.mapApp(cur.rows[0]);
      const next = { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as ApplicationRow;
      const { rows } = await tx.query<R>(
        `UPDATE applications SET status = $3, notes = $4, company = $5, job_title = $6, job_url = $7, url_normalized = $8, resume_version_id = $9, match_score = $10,
           applied_at = CASE WHEN $3 = 'applied' AND applied_at IS NULL THEN now() ELSE applied_at END, updated_at = now()
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [id, userId, next.status, next.notes.slice(0, 10000), next.company, next.jobTitle, next.jobUrl, normalizeUrl(next.jobUrl), next.resumeVersionId, next.matchScore],
      );
      if (before.status !== next.status) {
        await tx.query('INSERT INTO application_events (application_id, user_id, type, from_status, to_status, data) VALUES ($1,$2,$3,$4,$5,$6)', [id, userId, 'status_changed', before.status, next.status, JSON.stringify(eventData)]);
      } else if (eventType !== 'updated' || Object.keys(eventData).length) {
        await tx.query('INSERT INTO application_events (application_id, user_id, type, data) VALUES ($1,$2,$3,$4)', [id, userId, eventType, JSON.stringify(eventData)]);
      }
      return this.mapApp(rows[0]);
    });
  }

  async addApplicationEvent(userId: string, id: string, type: string, data: Record<string, unknown>): Promise<void> {
    await this.db.query('INSERT INTO application_events (application_id, user_id, type, data) SELECT id, user_id, $3, $4 FROM applications WHERE id = $1 AND user_id = $2', [id, userId, type, JSON.stringify(data)]);
  }

  async listApplicationEvents(userId: string, id: string) {
    const { rows } = await this.db.query<R>('SELECT * FROM application_events WHERE application_id = $1 AND user_id = $2 ORDER BY created_at ASC', [id, userId]);
    return rows.map((r) => ({ id: String(r.id), type: String(r.type), fromStatus: r.from_status as string | null, toStatus: r.to_status as string | null, data: r.data as Record<string, unknown>, createdAt: iso(r.created_at)! }));
  }

  async deleteApplication(userId: string, id: string): Promise<boolean> {
    const { rows } = await this.db.query<R>('DELETE FROM applications WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
    return rows.length > 0;
  }

  async applicationStats(userId: string) {
    const { rows } = await this.db.query<R>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS this_week,
              round(avg(match_score))::int AS avg_match,
              count(*) FILTER (WHERE status IN ('applied','interview','rejected','offer'))::int AS submitted,
              count(*) FILTER (WHERE status IN ('interview','offer'))::int AS interviews
       FROM applications WHERE user_id = $1`,
      [userId],
    );
    const by = await this.db.query<R>('SELECT status, count(*)::int AS n FROM applications WHERE user_id = $1 GROUP BY status', [userId]);
    const weekly = await this.db.query<R>(
      `SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week, count(*)::int AS n FROM applications
       WHERE user_id = $1 AND created_at > now() - interval '8 weeks' GROUP BY 1 ORDER BY 1`,
      [userId],
    );
    const r = rows[0];
    return {
      total: Number(r.total),
      thisWeek: Number(r.this_week),
      averageMatch: r.avg_match == null ? null : Number(r.avg_match),
      submitted: Number(r.submitted),
      interviews: Number(r.interviews),
      interviewRate: Number(r.submitted) ? Math.round((Number(r.interviews) / Number(r.submitted)) * 100) : null,
      byStatus: Object.fromEntries(by.rows.map((x) => [String(x.status), Number(x.n)])),
      weekly: weekly.rows.map((x) => ({ week: String(x.week), count: Number(x.n) })),
    };
  }

  // ------------------------------------------------------------ saved answers
  private mapAnswer(r: R): AnswerRow {
    return {
      id: String(r.id),
      questionKey: String(r.question_key),
      rawQuestion: String(r.raw_question),
      normalizedQuestion: String(r.normalized_question),
      answer: this.cipher.decrypt(String(r.answer_enc)),
      source: r.source as AnswerRow['source'],
      confidence: Number(r.confidence),
      sensitive: !!r.sensitive,
      useCount: Number(r.use_count),
      lastUsedAt: iso(r.last_used_at),
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
    };
  }

  async listAnswers(userId: string): Promise<AnswerRow[]> {
    const { rows } = await this.db.query<R>('SELECT * FROM saved_answers WHERE user_id = $1 ORDER BY updated_at DESC', [userId]);
    return rows.map((r) => this.mapAnswer(r));
  }

  async getAnswer(userId: string, id: string): Promise<AnswerRow | null> {
    const { rows } = await this.db.query<R>('SELECT * FROM saved_answers WHERE id = $1 AND user_id = $2', [id, userId]);
    return rows[0] ? this.mapAnswer(rows[0]) : null;
  }

  async upsertAnswer(userId: string, a: { questionKey: string; rawQuestion: string; normalizedQuestion: string; answer: string; source: AnswerRow['source']; confidence: number; sensitive: boolean }): Promise<AnswerRow> {
    const { rows } = await this.db.query<R>(
      `INSERT INTO saved_answers (user_id, question_key, raw_question, normalized_question, answer_enc, source, confidence, sensitive)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id, question_key) DO UPDATE SET raw_question = $3, normalized_question = $4, answer_enc = $5, source = $6, confidence = $7, sensitive = $8, updated_at = now()
       RETURNING *`,
      [userId, a.questionKey, a.rawQuestion.slice(0, 1000), a.normalizedQuestion.slice(0, 1000), this.cipher.encrypt(a.answer.slice(0, 10000)), a.source, a.confidence, a.sensitive],
    );
    return this.mapAnswer(rows[0]);
  }

  async updateAnswer(userId: string, id: string, answer: string): Promise<AnswerRow | null> {
    const { rows } = await this.db.query<R>("UPDATE saved_answers SET answer_enc = $3, source = 'user', confidence = 1, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *", [id, userId, this.cipher.encrypt(answer.slice(0, 10000))]);
    return rows[0] ? this.mapAnswer(rows[0]) : null;
  }

  async markAnswersUsed(userId: string, keys: string[]): Promise<void> {
    if (!keys.length) return;
    await this.db.query('UPDATE saved_answers SET use_count = use_count + 1, last_used_at = now() WHERE user_id = $1 AND question_key = ANY($2::text[])', [userId, keys]);
  }

  async deleteAnswer(userId: string, id: string): Promise<boolean> {
    const { rows } = await this.db.query<R>('DELETE FROM saved_answers WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
    return rows.length > 0;
  }

  // ------------------------------------------------------------ field mappings
  private mapMapping(r: R): FieldMappingRow {
    return { id: String(r.id), host: String(r.host), signature: String(r.signature), label: String(r.label), fieldType: String(r.field_type), questionKey: r.question_key ? String(r.question_key) : null, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)! };
  }

  async listMappings(userId: string): Promise<FieldMappingRow[]> {
    const { rows } = await this.db.query<R>('SELECT * FROM field_mappings WHERE user_id = $1 ORDER BY updated_at DESC', [userId]);
    return rows.map((r) => this.mapMapping(r));
  }

  async upsertMapping(userId: string, m: { host: string; signature: string; label: string; fieldType: string; questionKey: string | null }): Promise<FieldMappingRow> {
    const { rows } = await this.db.query<R>(
      `INSERT INTO field_mappings (user_id, host, signature, label, field_type, question_key) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, host, signature) DO UPDATE SET label = $4, field_type = $5, question_key = $6, updated_at = now() RETURNING *`,
      [userId, m.host.slice(0, 255), m.signature.slice(0, 500), m.label.slice(0, 500), m.fieldType, m.questionKey],
    );
    return this.mapMapping(rows[0]);
  }

  async deleteMapping(userId: string, id: string): Promise<boolean> {
    const { rows } = await this.db.query<R>('DELETE FROM field_mappings WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
    return rows.length > 0;
  }
}
