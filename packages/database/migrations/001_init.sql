-- PINGx969 initial schema (PostgreSQL 14+; also runs on embedded PGlite)

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  display_name  text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  kind         text NOT NULL CHECK (kind IN ('web', 'extension')),
  csrf_token   text NOT NULL,
  user_agent   text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE user_settings (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  scoring_weights jsonb,
  ai_provider     text NOT NULL DEFAULT 'heuristic',
  auto_learn      boolean NOT NULL DEFAULT true,
  show_launcher   boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Entire profile is encrypted (AES-256-GCM) — it is all personal data.
CREATE TABLE profiles (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data_enc   text NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('resume_source', 'resume_export', 'job_description', 'cover_letter')),
  filename    text NOT NULL,
  mime_type   text NOT NULL,
  size_bytes  integer NOT NULL,
  sha256      text NOT NULL,
  storage_key text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_user_kind_idx ON documents (user_id, kind);

CREATE TABLE resumes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               text NOT NULL,
  source_format      text NOT NULL CHECK (source_format IN ('pdf', 'docx', 'txt', 'md', 'json')),
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  content_enc        text NOT NULL, -- encrypted ParsedResume JSON (document + normalized data + raw text)
  is_default         boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX resumes_user_idx ON resumes (user_id, created_at DESC);

CREATE TABLE jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            text NOT NULL DEFAULT '',
  company          text NOT NULL DEFAULT '',
  url              text NOT NULL DEFAULT '',
  url_normalized   text NOT NULL DEFAULT '',
  location         text NOT NULL DEFAULT '',
  seniority        text NOT NULL DEFAULT 'unknown',
  work_arrangement text NOT NULL DEFAULT 'unknown',
  source           text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'url', 'upload', 'extension')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_user_url_idx ON jobs (user_id, url_normalized);
CREATE INDEX jobs_user_company_idx ON jobs (user_id, lower(company));
CREATE INDEX jobs_user_created_idx ON jobs (user_id, created_at DESC);

CREATE TABLE job_descriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_text   text NOT NULL,
  source     text NOT NULL DEFAULT 'paste',
  analysis   jsonb NOT NULL,
  provider   text NOT NULL DEFAULT 'heuristic',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_descriptions_job_idx ON job_descriptions (job_id, created_at DESC);

CREATE TABLE resume_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_id          uuid NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id             uuid REFERENCES jobs(id) ON DELETE SET NULL,
  job_description_id uuid REFERENCES job_descriptions(id) ON DELETE SET NULL,
  label              text NOT NULL,
  company            text NOT NULL DEFAULT '',
  job_title          text NOT NULL DEFAULT '',
  job_url            text NOT NULL DEFAULT '',
  match_before       integer NOT NULL,
  match_after        integer NOT NULL,
  provider           text NOT NULL DEFAULT 'heuristic',
  payload_enc        text NOT NULL, -- encrypted VersionPayload (changes, generated resume, match, metadata)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX resume_versions_user_idx ON resume_versions (user_id, created_at DESC);
CREATE INDEX resume_versions_resume_idx ON resume_versions (resume_id);
CREATE INDEX resume_versions_job_idx ON resume_versions (job_id);

CREATE TABLE optimization_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resume_id          uuid REFERENCES resumes(id) ON DELETE CASCADE,
  job_description_id uuid REFERENCES job_descriptions(id) ON DELETE SET NULL,
  version_id         uuid REFERENCES resume_versions(id) ON DELETE SET NULL,
  provider           text NOT NULL,
  status             text NOT NULL CHECK (status IN ('succeeded', 'fallback', 'failed')),
  duration_ms        integer NOT NULL DEFAULT 0,
  warnings           jsonb NOT NULL DEFAULT '[]',
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX optimization_runs_user_idx ON optimization_runs (user_id, created_at DESC);

CREATE TABLE applications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id            uuid REFERENCES jobs(id) ON DELETE SET NULL,
  resume_version_id uuid REFERENCES resume_versions(id) ON DELETE SET NULL,
  company           text NOT NULL DEFAULT '',
  job_title         text NOT NULL DEFAULT '',
  job_url           text NOT NULL DEFAULT '',
  url_normalized    text NOT NULL DEFAULT '',
  status            text NOT NULL DEFAULT 'saved' CHECK (status IN ('saved', 'preparing', 'applied', 'interview', 'rejected', 'offer', 'withdrawn')),
  match_score       integer,
  notes             text NOT NULL DEFAULT '',
  applied_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX applications_user_status_idx ON applications (user_id, status);
CREATE INDEX applications_user_url_idx ON applications (user_id, url_normalized);
CREATE INDEX applications_user_created_idx ON applications (user_id, created_at DESC);

CREATE TABLE application_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type           text NOT NULL,
  from_status    text,
  to_status      text,
  data           jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX application_events_app_idx ON application_events (application_id, created_at);

-- Question text is the employer's (not personal); the answer is encrypted.
CREATE TABLE saved_answers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_key        text NOT NULL,
  raw_question        text NOT NULL,
  normalized_question text NOT NULL,
  answer_enc          text NOT NULL,
  source              text NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'learned', 'imported', 'profile')),
  confidence          real NOT NULL DEFAULT 1,
  sensitive           boolean NOT NULL DEFAULT false,
  use_count           integer NOT NULL DEFAULT 0,
  last_used_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX saved_answers_user_key_uq ON saved_answers (user_id, question_key);
CREATE INDEX saved_answers_user_updated_idx ON saved_answers (user_id, updated_at DESC);

-- User corrections of how a form field should be interpreted (per site).
CREATE TABLE field_mappings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host         text NOT NULL,
  signature    text NOT NULL,
  label        text NOT NULL DEFAULT '',
  field_type   text NOT NULL,
  question_key text,
  source       text NOT NULL DEFAULT 'user',
  confidence   real NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX field_mappings_uq ON field_mappings (user_id, host, signature);
