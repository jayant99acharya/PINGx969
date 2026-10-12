import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Profile } from '@pingx969/shared';
import { api } from '../api';
import { ErrorBox, Icon, Loading, useLoad, errMsg } from '../ui';

type Path = (string | number)[];

function get(obj: unknown, path: Path): unknown {
  return path.reduce<unknown>((o, k) => (o as Record<string | number, unknown>)?.[k], obj);
}
function setIn<T>(obj: T, path: Path, value: unknown): T {
  const copy = structuredClone(obj) as Record<string | number, unknown>;
  let cur = copy;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]] as Record<string | number, unknown>;
  cur[path[path.length - 1]] = value;
  return copy as T;
}


const ProfileCtx = createContext<{ profile: Profile; update: (path: Path, value: unknown) => void }>(null as never);

/** Text field bound to a profile path (module-level so inputs keep focus across renders). */
function T({ path, label, type = 'text', placeholder, help }: { path: Path; label: string; type?: string; placeholder?: string; help?: string }) {
  const { profile, update } = useContext(ProfileCtx);
  const id = `pf-${path.join('-')}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" type={type} value={String(get(profile, path) ?? '')} placeholder={placeholder} onChange={(e) => update(path, e.target.value)} />
      {help && <span className="help">{help}</span>}
    </div>
  );
}

function TriState({ path, label }: { path: Path; label: string }) {
  const { profile, update } = useContext(ProfileCtx);
  const id = `pf-${path.join('-')}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={String(get(profile, path))} onChange={(e) => update(path, e.target.value)}>
        <option value="unset">Not set (ask me)</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </div>
  );
}

/** Every edit is persisted automatically (debounced) — the extension always sees the latest. */
export function ProfilePage() {
  const { data, error, loading, reload } = useLoad(() => api<{ profile: Profile; updatedAt: string }>('/profile'));
  const [profile, setProfile] = useState<Profile | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Profile | null>(null);

  useEffect(() => {
    if (data) setProfile(data.profile);
  }, [data]);

  const save = async (p: Profile) => {
    setState('saving');
    try {
      await api('/profile', { method: 'PUT', body: { profile: p } });
      if (latest.current === p) setState('saved');
    } catch (e) {
      setState('error');
      setSaveError(errMsg(e));
    }
  };
  const update = (path: Path, value: unknown) => {
    setProfile((p) => {
      if (!p) return p;
      const next = setIn(p, path, value);
      latest.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(next), 600);
      setState('saving');
      return next;
    });
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (loading && !profile) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!profile) return null;

  return (
    <ProfileCtx.Provider value={{ profile, update }}>
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div>
          <h1>Profile</h1>
          <p>The single source of truth for autofill. Stored encrypted; changes save automatically.</p>
        </div>
        <span className={`badge ${state === 'error' ? 'badge-bad' : state === 'saved' ? 'badge-good' : ''}`} role="status" aria-live="polite">
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'All changes saved' : state === 'error' ? 'Save failed' : 'Up to date'}
        </span>
      </div>
      {state === 'error' && <div className="alert alert-error">{saveError}</div>}

      <div className="card stack">
        <h2>Personal</h2>
        <div className="form-grid">
          <T path={['personal', 'firstName']} label="First name" />
          <T path={['personal', 'middleName']} label="Middle name" />
          <T path={['personal', 'lastName']} label="Last name" />
          <T path={['personal', 'preferredName']} label="Preferred name" />
          <T path={['personal', 'email']} label="Email" type="email" />
          <T path={['personal', 'phone']} label="Phone" type="tel" />
          <T path={['personal', 'pronouns']} label="Pronouns" />
          <T path={['personal', 'headline']} label="Headline" placeholder="Senior Software Engineer" />
        </div>
      </div>

      <div className="card stack">
        <h2>Location</h2>
        <div className="form-grid">
          <T path={['location', 'address1']} label="Address" />
          <T path={['location', 'address2']} label="Address line 2" />
          <T path={['location', 'city']} label="City" />
          <T path={['location', 'state']} label="State / province" />
          <T path={['location', 'postalCode']} label="ZIP / postal code" />
          <T path={['location', 'country']} label="Country" />
        </div>
      </div>

      <div className="card stack">
        <h2>Links</h2>
        <div className="form-grid">
          <T path={['links', 'linkedin']} label="LinkedIn" type="url" />
          <T path={['links', 'github']} label="GitHub" type="url" />
          <T path={['links', 'portfolio']} label="Portfolio" type="url" />
          <T path={['links', 'website']} label="Website" type="url" />
          <T path={['links', 'twitter']} label="Twitter / X" type="url" />
        </div>
      </div>

      <div className="card stack">
        <h2>Work authorization</h2>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="pf-auth">Authorized to work in (comma-separated)</label>
            <input
              id="pf-auth"
              className="input"
              defaultValue={profile.workAuthorization.authorizedCountries.join(', ')}
              placeholder="United States, Canada"
              onBlur={(e) => update(['workAuthorization', 'authorizedCountries'], e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
            />
          </div>
          <TriState path={['workAuthorization', 'requiresSponsorship']} label="Require visa sponsorship?" />
          <T path={['workAuthorization', 'citizenship']} label="Citizenship" />
          <T path={['workAuthorization', 'visaStatus']} label="Visa status" />
          <T path={['workAuthorization', 'securityClearance']} label="Security clearance" />
        </div>
      </div>

      <div className="card stack">
        <h2>Preferences</h2>
        <div className="form-grid">
          <T path={['preferences', 'desiredSalary']} label="Desired salary" placeholder="$170,000" />
          <T path={['preferences', 'noticePeriod']} label="Notice period" placeholder="2 weeks" />
          <T path={['preferences', 'availableStartDate']} label="Available start date" />
          <TriState path={['preferences', 'willingToRelocate']} label="Willing to relocate?" />
          <div className="field">
            <label htmlFor="pf-remote">Work arrangement</label>
            <select id="pf-remote" className="input" value={profile.preferences.remotePreference} onChange={(e) => update(['preferences', 'remotePreference'], e.target.value)}>
              <option value="unset">Not set</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">On-site</option>
              <option value="any">Any</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="pf-years">Years of experience (override)</label>
            <input id="pf-years" className="input" type="number" min={0} max={70} value={profile.yearsOfExperienceOverride ?? ''} placeholder="Calculated from your roles" onChange={(e) => update(['yearsOfExperienceOverride'], e.target.value === '' ? null : Number(e.target.value))} />
          </div>
        </div>
      </div>

      <div className="card stack">
        <div className="spread">
          <h2>Experience</h2>
          <button className="btn btn-sm" onClick={() => update(['experience'], [...profile.experience, { company: '', title: '', location: '', startDate: '', endDate: '', current: false, description: '' }])}>
            <Icon name="plus" /> Add role
          </button>
        </div>
        {profile.experience.map((e, i) => (
          <div key={i} className="change stack">
            <div className="form-grid">
              <T path={['experience', i, 'company']} label="Company" />
              <T path={['experience', i, 'title']} label="Title" />
              <T path={['experience', i, 'location']} label="Location" />
              <T path={['experience', i, 'startDate']} label="Start (YYYY-MM)" />
              <T path={['experience', i, 'endDate']} label="End (YYYY-MM)" />
            </div>
            <div className="spread">
              <label className="checkbox">
                <input type="checkbox" checked={e.current} onChange={(ev) => update(['experience', i, 'current'], ev.target.checked)} /> I currently work here
              </label>
              <button className="btn btn-sm btn-danger btn-ghost" onClick={() => update(['experience'], profile.experience.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card stack">
        <div className="spread">
          <h2>Education</h2>
          <button className="btn btn-sm" onClick={() => update(['education'], [...profile.education, { school: '', degree: '', field: '', startDate: '', endDate: '', gpa: '' }])}>
            <Icon name="plus" /> Add education
          </button>
        </div>
        {profile.education.map((_, i) => (
          <div key={i} className="change stack">
            <div className="form-grid">
              <T path={['education', i, 'school']} label="School" />
              <T path={['education', i, 'degree']} label="Degree" />
              <T path={['education', i, 'field']} label="Field of study" />
              <T path={['education', i, 'endDate']} label="Graduation (YYYY)" />
              <T path={['education', i, 'gpa']} label="GPA" />
            </div>
            <div>
              <button className="btn btn-sm btn-danger btn-ghost" onClick={() => update(['education'], profile.education.filter((__, j) => j !== i))}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card stack">
        <h2>Skills</h2>
        <div className="field">
          <label htmlFor="pf-skills">Skills (comma-separated)</label>
          <textarea id="pf-skills" className="input" defaultValue={profile.skills.join(', ')} onBlur={(e) => update(['skills'], e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
        </div>
        <div className="field">
          <label htmlFor="pf-confirmed">Skills you confirmed (used by the optimizer even if not in a resume)</label>
          <textarea id="pf-confirmed" className="input" defaultValue={profile.confirmedSkills.join(', ')} onBlur={(e) => update(['confirmedSkills'], e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
          <span className="help">Only list skills you genuinely have. These may be added to tailored resumes.</span>
        </div>
      </div>

      <div className="card stack">
        <h2>Voluntary self-identification</h2>
        <p className="muted small">Optional and sensitive. Stored encrypted and only used to answer the same questions on applications. Leave blank to be asked each time.</p>
        <div className="form-grid">
          <T path={['eeo', 'gender']} label="Gender" placeholder="e.g. Prefer not to say" />
          <T path={['eeo', 'raceEthnicity']} label="Race / ethnicity" />
          <T path={['eeo', 'hispanicLatino']} label="Hispanic / Latino" />
          <T path={['eeo', 'veteranStatus']} label="Veteran status" />
          <T path={['eeo', 'disabilityStatus']} label="Disability status" />
        </div>
      </div>

      <div className="card stack">
        <h2>Cover letter template</h2>
        <div className="field">
          <label htmlFor="pf-cover">Template ({'{{company}}'} and {'{{title}}'} are replaced automatically)</label>
          <textarea id="pf-cover" className="input" style={{ minHeight: 160 }} value={profile.documents.coverLetterTemplate} onChange={(e) => update(['documents', 'coverLetterTemplate'], e.target.value)} />
        </div>
      </div>
    </div>
    </ProfileCtx.Provider>
  );
}
