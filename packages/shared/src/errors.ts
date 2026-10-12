/** Errors with a stable code and a user-facing message (safe to show in the UI). */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const ErrorCodes = {
  UNSUPPORTED_FILE: 'unsupported_file',
  CORRUPTED_FILE: 'corrupted_file',
  FILE_TOO_LARGE: 'file_too_large',
  EMPTY_RESUME: 'empty_resume',
  EMPTY_JOB: 'empty_job_description',
  AI_FAILURE: 'ai_failure',
  VALIDATION: 'validation_error',
  UNAUTHORIZED: 'unauthorized',
  SESSION_EXPIRED: 'session_expired',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  RATE_LIMITED: 'rate_limited',
  CSRF: 'csrf_failed',
  CONFLICT: 'conflict',
  URL_FETCH_FAILED: 'url_fetch_failed',
} as const;
