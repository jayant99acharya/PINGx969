import type { Profile } from '@pingx969/shared';
import type { DetectedField, PageJobInfo } from '@pingx969/field-detector';

export interface SavedAnswerDto {
  id: string;
  questionKey: string;
  rawQuestion: string;
  normalizedQuestion: string;
  answer: string;
  source: string;
  updatedAt: string;
}

export interface Bootstrap {
  user: { id: string; email: string; displayName: string } | null;
  profile: Profile;
  profileVersion: number;
  answers: SavedAnswerDto[];
  mappings: { id: string; host: string; signature: string; label: string; fieldType: string; questionKey: string | null }[];
  settings: { autoLearn: boolean; showLauncher: boolean };
}

export interface VersionLite {
  id: string;
  label: string;
  matchAfter: number;
  company?: string;
  jobTitle?: string;
}

export interface PageContext {
  job: { id: string; title: string; company: string; url: string } | null;
  recommendedVersion: VersionLite | null;
  versions: VersionLite[];
  otherVersions: VersionLite[];
  defaultResume: { id: string; name: string } | null;
  application: { id: string; status: string } | null;
}

export interface FillItem {
  fieldId: string;
  value: string;
  overwrite?: boolean;
}

export interface FillResultDto {
  fieldId: string;
  ok: boolean;
  reason?: string;
}

/** Messages handled by the background service worker. */
export type BgRequest =
  | { type: 'auth/status' }
  | { type: 'auth/login'; apiUrl: string; email: string; password: string }
  | { type: 'auth/logout' }
  | { type: 'data/bootstrap'; force?: boolean }
  | { type: 'page/context'; url: string; title: string; company: string }
  | { type: 'answers/save'; question: string; answer: string; source: 'user' | 'learned'; questionKey?: string | null }
  | { type: 'answers/used'; keys: string[] }
  | { type: 'mappings/save'; host: string; signature: string; label: string; fieldType: string; questionKey: string | null }
  | { type: 'profile/learn'; patch: Record<string, unknown> }
  | { type: 'application/upsert'; jobUrl: string; company: string; jobTitle: string; jobId?: string | null; resumeVersionId?: string | null; matchScore?: number | null; fieldsFilled?: number; event?: 'autofilled' | 'opened' | 'resume_attached' }
  | { type: 'application/submitPending'; url: string; company: string; jobTitle: string; applicationId: string | null }
  | { type: 'application/checkPending'; url: string }
  | { type: 'application/markApplied'; applicationId: string }
  | { type: 'application/dismissPending' }
  | { type: 'resume/file'; versionId: string | null; resumeId: string | null }
  | { type: 'job/createAndOptimize'; url: string; title: string; company: string; description: string; resumeId?: string | null }
  | { type: 'open/dashboard'; path: string }
  | { type: 'open/options' }
  | { type: 'tab/scan'; tabId: number }
  | { type: 'content/register'; nonce: string }
  | { type: 'frame/host'; nonce: string; action: HostAction; count: number }
  | { type: 'panel/hello'; nonce: string }
  | { type: 'relay'; nonce: string; msg: ContentRequest }
  | { type: 'settings/update'; patch: Partial<Bootstrap['settings']> }
  | { type: 'permissions/enableAllSites' };

/** Messages handled by the content script (delivered via chrome.tabs.sendMessage). */
export type ContentRequest =
  | { type: 'content/state' }
  | { type: 'content/fill'; items: FillItem[]; resume?: { base64: string; name: string; mime: string; fieldId: string } | null; activate?: boolean }
  | { type: 'content/openPanel' }
  | { type: 'content/closePanel' }
  | { type: 'content/ping' }
  /** Top frame: show the launcher / panel on behalf of a form inside a subframe (iCIMS iframes). */
  | { type: 'content/host'; nonce: string; action: HostAction; count: number };

export type HostAction = 'show' | 'open' | 'close';

export interface ContentState {
  url: string;
  host: string;
  fields: DetectedField[];
  job: PageJobInfo;
  isApplication: boolean;
  adapter: string;
  userEdited: string[];
}

/** Broadcast from content script to its panel (filtered by nonce). */
export interface PanelEvent {
  type: 'panel/fieldsChanged' | 'panel/learned';
  nonce: string;
  data?: unknown;
}

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: string; code?: string };
export type Res<T> = Ok<T> | Err;

export async function bg<T>(msg: BgRequest): Promise<T> {
  const res = (await chrome.runtime.sendMessage(msg)) as Res<T> | undefined;
  if (!res) throw new Error('The extension background is not responding. Try reloading the extension.');
  if (!res.ok) {
    const e = new Error(res.error) as Error & { code?: string };
    e.code = res.code;
    throw e;
  }
  return res.data;
}
