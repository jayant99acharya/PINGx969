/**
 * Content script (isolated world). Detects fields, renders the launcher, hosts the review panel
 * iframe (an extension page the site cannot read), fills fields on request, watches for
 * dynamically added fields, learns answers the user types, and asks for submission
 * confirmation after the user submits. It never submits forms itself.
 */
import {
  type DetectedField,
  FILLED_ATTR,
  attachFile,
  detectFields,
  elementsFor,
  extractJobInfo,
  fillField,
  looksLikeApplication,
  pickAdapter,
  planFill,
  readValue,
  shadowRoots,
  watchForFields,
} from '@pingx969/field-detector';
import type { Bootstrap, ContentRequest, ContentState, FillResultDto, HostAction, PanelEvent } from './messages';
import { bg } from './messages';

declare global {
  interface Window {
    __pingx969Loaded?: boolean;
  }
}

if (!window.__pingx969Loaded) {
  window.__pingx969Loaded = true;
  void main();
}

const LEARNABLE_PROFILE: Record<string, string[]> = {
  phone: ['personal', 'phone'],
  city: ['location', 'city'],
  state: ['location', 'state'],
  postalCode: ['location', 'postalCode'],
  country: ['location', 'country'],
  address1: ['location', 'address1'],
  linkedin: ['links', 'linkedin'],
  github: ['links', 'github'],
  portfolio: ['links', 'portfolio'],
  website: ['links', 'website'],
  preferredName: ['personal', 'preferredName'],
};

async function main() {
  const nonce: string = crypto.randomUUID();
  let fields: DetectedField[] = [];
  let autofillActive = false;
  const userEdited = new Set<string>();
  let launcher: { host: HTMLElement; update: (n: number) => void } | null = null;
  let panel: HTMLElement | null = null;

  /**
   * Page-level UI lives in a custom element positioned only from inside its own shadow root:
   * no <div>, no inline style. Generic cosmetic filters in ad-block lists (e.g.
   * `head ~ div[style*="z-index"]`) would otherwise hide it, and `!important` in :host wins
   * over any page rule targeting the host. Built with DOM APIs only: pages with Trusted Types
   * (Google Forms, LinkedIn) reject innerHTML.
   */
  const mountUi = (kind: string, position: string, css = ''): { host: HTMLElement; root: ShadowRoot } => {
    const host = document.createElement('pingx969-ui');
    host.setAttribute('data-px-ui', kind);
    const root = host.attachShadow({ mode: 'open' });
    const decls = `all:initial;display:block;position:fixed;${position}`.split(';').filter(Boolean).map((d) => `${d}!important`).join(';');
    const style = document.createElement('style');
    style.textContent = `:host{${decls}}:host([hidden]){display:none!important}${css}`;
    root.append(style);
    document.documentElement.appendChild(host);
    return { host, root };
  };
  /**
   * Resolves once the page has loaded and its framework has hydrated. Inserting any element before
   * that makes apps that hydrate the whole document (Greenhouse job-boards: Remix/React) fail
   * hydration, throw the server DOM away and re-render it, taking our UI and observers with it.
   * Detection only adds attributes, which hydration tolerates, so it runs immediately; UI waits for
   * page-ready.js (MAIN world), with a timeout in case that script is not present.
   */
  const pageSettled: Promise<void> = (async () => {
    if (document.readyState !== 'complete') await new Promise((r) => addEventListener('load', r, { once: true }));
    await new Promise<void>((resolve) => {
      const done = () => {
        document.removeEventListener('pingx969:page-ready', done);
        clearTimeout(cap);
        resolve();
      };
      const cap = setTimeout(done, 8000);
      document.addEventListener('pingx969:page-ready', done);
      document.dispatchEvent(new CustomEvent('pingx969:ask-ready'));
    });
    await new Promise<void>((r) => requestIdleCallback(() => r(), { timeout: 1000 }));
  })();
  /** Re-attach our UI if the page re-rendered its document (or body) underneath it. */
  const reattach = () => {
    for (const host of [launcher?.host, panel]) if (host && !host.isConnected) document.documentElement.appendChild(host);
  };
  const h = (tag: string, attrs: Record<string, string> = {}, ...children: (Node | string)[]) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    node.append(...children);
    return node;
  };
  let data: Bootstrap | null = null;
  // Register this frame so the panel (extension iframe) can reach it through the background.
  await bg({ type: 'content/register', nonce }).catch(() => undefined);

  const getData = async (force = false) => {
    if (!data || force) data = await bg<Bootstrap>({ type: 'data/bootstrap', force });
    return data;
  };

  const scan = () => {
    const before = new Set(fields.map((f) => f.id));
    fields = detectFields(document, { url: location.href });
    listenInShadows();
    return fields.filter((f) => !before.has(f.id));
  };

  const state = (): ContentState => {
    const job = extractJobInfo(document, location.href);
    return { url: location.href, host: location.hostname, fields, job, isApplication: looksLikeApplication(fields), adapter: pickAdapter(location.href, document).name, userEdited: [...userEdited] };
  };

  const notifyPanel = (type: PanelEvent['type'], payload?: unknown) => {
    if (!panel && !panelInTop) return;
    void chrome.runtime.sendMessage({ type, nonce, data: payload } satisfies PanelEvent).catch(() => undefined);
  };

  // ---------------------------------------------------------------- subframes (iCIMS' content iframe and similar)
  // Frames sized to their content would put a fixed launcher far below the viewport, so a form inside a
  // subframe asks the top frame to show the launcher and host the panel. The panel still talks to this
  // frame through its nonce. Falls back to rendering here when the top frame has no content script.
  const inSubframe = window.top !== window;
  let panelInTop = false;
  const viaTop = async (action: HostAction, count = 0): Promise<boolean> => {
    if (!inSubframe) return false;
    // The top frame's script may still be starting (iframes often finish loading first): retry briefly.
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await bg({ type: 'frame/host', nonce, action, count });
        if (action === 'open') panelInTop = true;
        return true;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    return false;
  };

  // ---------------------------------------------------------------- launcher (shadow root; contains no personal data —
  // everything personal is shown only inside the extension-origin panel iframe)
  let launcherFor = nonce;
  /** Whether the extension can fill right now: signed in and the PINGx969 server reachable. */
  let connection: 'ok' | 'signin' | 'offline' = 'ok';
  const checkConnection = async (): Promise<Bootstrap | null> => {
    try {
      const d = await getData();
      connection = 'ok';
      return d;
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      connection = code === 'unauthorized' || code === 'session_expired' ? 'signin' : 'offline';
      return null;
    }
  };
  const showLauncher = async (count: number, forNonce = nonce) => {
    if (inSubframe) {
      if (fields.length < 3) return;
      if (await viaTop('show', count)) return;
    }
    launcherFor = forNonce;
    await pageSettled;
    if (!launcher) {
      const { host, root } = mountUi(
        'launcher',
        'right:20px;bottom:20px;z-index:2147483646',
        `button{all:initial;font:600 13px system-ui,-apple-system,Segoe UI,sans-serif;display:flex;align-items:center;gap:8px;background:#2a63d6;color:#fff;border-radius:999px;padding:10px 16px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}
        button:focus-visible{outline:3px solid #9cc0ff;outline-offset:2px}
        .x{all:initial;position:absolute;top:-8px;right:-8px;width:20px;height:20px;border-radius:50%;background:#333;color:#fff;font:12px system-ui;display:grid;place-items:center;cursor:pointer}`,
      );
      const label = h('span', { class: 't' }, 'Autofill');
      const go = h('button', { type: 'button', class: 'go', 'aria-label': 'Open PINGx969 autofill' }, h('span', {}, '⚡'), label);
      const x = h('span', { class: 'x', role: 'button', tabindex: '0', 'aria-label': 'Hide PINGx969 button' }, '×');
      root.append(go, x);
      go.addEventListener('click', () => void openPanel(launcherFor));
      x.addEventListener('click', () => host.remove());
      launcher = {
        host,
        update: (n) => {
          // Say up front when filling can't work, instead of only inside the panel.
          label.textContent = connection === 'signin' ? 'Autofill · sign in to fill' : connection === 'offline' ? 'Autofill · server offline' : `Autofill · ${n} field${n === 1 ? '' : 's'}`;
          host.setAttribute('data-px-state', connection);
        },
      };
    }
    launcher.update(count);
  };

  // ---------------------------------------------------------------- panel iframe (extension origin)
  let panelFor = nonce;
  const openPanel = async (forNonce = nonce) => {
    if (inSubframe && forNonce === nonce && (await viaTop('open'))) return;
    if (panel && panelFor !== forNonce) {
      panel.remove();
      panel = null;
    }
    panelFor = forNonce;
    await pageSettled;
    if (!panel) {
      const { host, root } = mountUi('panel-host', 'top:12px;right:12px;z-index:2147483647');
      const frame = document.createElement('iframe');
      frame.setAttribute('data-px-ui', 'panel');
      frame.title = 'PINGx969 autofill';
      frame.src = `${chrome.runtime.getURL('panel.html')}#${forNonce}`;
      frame.style.cssText = 'display:block;width:420px;max-width:calc(100vw - 24px);height:calc(100vh - 24px);border:0;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);background:#fff;color-scheme:normal;';
      frame.setAttribute('allow', '');
      root.append(frame);
      panel = host;
    } else panel.hidden = false;
    if (launcher) launcher.host.hidden = true;
  };
  const closePanel = async () => {
    if (panelInTop && (await viaTop('close'))) return;
    // Remove rather than hide: no idle extension frame stays in the page (reopening rebuilds it).
    panel?.remove();
    panel = null;
    if (launcher) launcher.host.hidden = false;
  };

  // ---------------------------------------------------------------- fill
  const doFill = async (req: Extract<ContentRequest, { type: 'content/fill' }>): Promise<FillResultDto[]> => {
    scan();
    const results: FillResultDto[] = [];
    for (const item of req.items) {
      const f = fields.find((x) => x.id === item.fieldId);
      if (!f) {
        results.push({ fieldId: item.fieldId, ok: false, reason: 'Field no longer on the page.' });
        continue;
      }
      if (userEdited.has(f.id) && !item.overwrite) {
        results.push({ fieldId: f.id, ok: false, reason: 'You edited this field — kept your value.' });
        continue;
      }
      results.push(await fillField(document, f, item.value, { overwrite: item.overwrite }));
    }
    if (req.resume) {
      const f = fields.find((x) => x.id === req.resume!.fieldId);
      if (f) {
        const bytes = Uint8Array.from(atob(req.resume.base64), (c) => c.charCodeAt(0));
        results.push(attachFile(document, f, { bytes, name: req.resume.name, type: req.resume.mime }));
      }
    }
    if (req.activate !== false) autofillActive = true;
    return results;
  };

  /** Auto-fill newly appeared fields (dynamic forms) after the user started autofill. */
  const fillNew = async (added: DetectedField[]) => {
    if (!autofillActive || !added.length) return;
    const d = await getData().catch(() => null);
    if (!d) return;
    const job = extractJobInfo(document, location.href);
    const plan = planFill(added, { profile: d.profile, answers: d.answers, mappings: d.mappings }, { host: location.hostname, company: job.company, title: job.title });
    for (const item of plan) {
      if (item.status !== 'ready') continue;
      const f = added.find((x) => x.id === item.fieldId)!;
      await fillField(document, f, item.value);
    }
  };

  // ---------------------------------------------------------------- learning from the user's own input
  const onUserInput = (target: HTMLElement | null) => {
    const id = target?.closest?.('[data-px-field]')?.getAttribute('data-px-field') ?? target?.getAttribute?.('data-px-field');
    if (!id) return;
    const f = fields.find((x) => x.id === id);
    if (!f || f.kind === 'file' || f.consent) return;
    const value = readValue(document, f);
    const stamped = elementsFor(document, f).map((el) => el.getAttribute(FILLED_ATTR)).find(Boolean);
    if (stamped === value) return;
    userEdited.add(f.id);
    void learn(f, value);
  };
  const onChange = (ev: Event) => ev.isTrusted && onUserInput(ev.composedPath()[0] as HTMLElement);
  document.addEventListener('change', onChange, true);
  // "change" is not composed: listen inside shadow roots (web-component forms) too.
  const listenedRoots = new WeakSet<ShadowRoot>();
  const listenInShadows = () => {
    for (const sr of shadowRoots(document.documentElement)) {
      if (listenedRoots.has(sr)) continue;
      listenedRoots.add(sr);
      sr.addEventListener('change', onChange, true);
    }
  };
  // Custom widgets (role="radio", aria-pressed buttons, listbox menus) never fire "change".
  document.addEventListener(
    'click',
    (ev) => {
      if (!ev.isTrusted) return;
      const t = ev.composedPath()[0] as HTMLElement;
      const id = t?.closest?.('[data-px-field]')?.getAttribute('data-px-field');
      const f = id ? fields.find((x) => x.id === id) : null;
      if (f && f.widget !== 'native') setTimeout(() => onUserInput(t), 200);
      else if (t?.closest?.('[role="option"]')) {
        // A listbox menu option: the menu is detached from its trigger, so re-read every listbox field shortly after.
        setTimeout(() => fields.filter((x) => x.widget === 'listbox').forEach((x) => onUserInput(elementsFor(document, x)[0] ?? null)), 200);
      }
    },
    true,
  );

  const learn = async (f: DetectedField, value: string) => {
    if (!value.trim()) return;
    const d = await getData().catch(() => null);
    if (!d || !d.settings.autoLearn) return;
    if (f.questionKey) {
      const existing = d.answers.find((a) => a.questionKey === f.questionKey);
      if (existing?.answer === value) return;
      const r = await bg<{ saved: boolean; queued: boolean }>({ type: 'answers/save', question: f.question || f.label, answer: value, source: 'learned', questionKey: f.questionKey }).catch(() => null);
      data = null; // refresh next time
      notifyPanel('panel/learned', { fieldId: f.id, label: f.label, queued: r?.queued ?? false });
    } else if (LEARNABLE_PROFILE[f.fieldType]) {
      const [section, key] = LEARNABLE_PROFILE[f.fieldType];
      const current = (d.profile as unknown as Record<string, Record<string, string>>)[section]?.[key];
      if (!current) {
        await bg({ type: 'profile/learn', patch: { [section]: { [key]: value } } }).catch(() => undefined);
        data = null;
        notifyPanel('panel/learned', { fieldId: f.id, label: f.label, profile: true });
      }
    }
  };

  // ---------------------------------------------------------------- submission detection (never submits)
  let submitRecorded = 0;
  const recordSubmitIntent = () => {
    if (Date.now() - submitRecorded < 2000) return;
    if (!autofillActive && !fields.some((f) => readValue(document, f))) return;
    submitRecorded = Date.now();
    const job = extractJobInfo(document, location.href);
    const urlAtSubmit = location.href;
    // Sent synchronously: the page usually navigates right after submit. The background
    // resolves which tracked application this is.
    void bg({ type: 'application/submitPending', url: urlAtSubmit, company: job.company, jobTitle: job.title, applicationId: null }).catch(() => undefined);
    // Single-page apps often show the confirmation without navigating.
    setTimeout(() => {
      if (location.href !== urlAtSubmit || !looksLikeApplication(detectFields(document, { url: location.href }))) void askSubmitted(true);
    }, 2500);
  };
  document.addEventListener('submit', (e) => e.isTrusted && (e.target as HTMLElement).querySelector?.('[data-px-field]') && recordSubmitIntent(), true);
  document.addEventListener(
    'click',
    (e) => {
      if (!e.isTrusted) return;
      const b = (e.composedPath()[0] as HTMLElement)?.closest?.('button, input[type="submit"], [role="button"]');
      if (!b || b.closest('[data-px-ui]')) return;
      const text = (b.textContent || (b as HTMLInputElement).value || '').trim();
      if (/^(submit|apply|send)( my)?( application| now)?$|submit application|apply now/i.test(text)) recordSubmitIntent();
    },
    true,
  );

  const askSubmitted = async (samePage = false) => {
    if (window.top !== window || document.querySelector('[data-px-ui="confirm"]')) return;
    type Pending = { company: string; jobTitle: string; applicationId: string | null } | null;
    let pending: Pending = null;
    // The background may still be resolving which application this is; wait briefly.
    for (let i = 0; i < 8; i++) {
      pending = await bg<Pending>({ type: 'application/checkPending', url: samePage ? '' : location.href }).catch(() => null);
      if (!pending || pending.applicationId) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!pending?.applicationId) return;
    await pageSettled;
    const what = [pending.jobTitle, pending.company].filter(Boolean).join(' at ') || 'this job';
    const { host, root } = mountUi(
      'confirm',
      'right:20px;bottom:20px;z-index:2147483647',
      `.c{font:14px system-ui,sans-serif;background:#fff;color:#14171c;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);padding:14px 16px;max-width:340px}
      .r{display:flex;gap:8px;margin-top:10px} button{font:600 13px system-ui;border-radius:8px;padding:8px 12px;border:1px solid #cbd0d8;background:#fff;cursor:pointer}
      .p{background:#2a63d6;color:#fff;border-color:#2a63d6}`,
    );
    const yes = h('button', { class: 'p yes' }, 'Yes, mark as applied');
    const no = h('button', { class: 'no' }, 'Not yet');
    const card = h('div', { class: 'c', role: 'dialog', 'aria-label': 'PINGx969' }, h('strong', {}, 'Did you submit your application?'), h('div', { class: 'w' }, what), h('div', { class: 'r' }, yes, no));
    root.append(card);
    yes.addEventListener('click', async () => {
      await bg({ type: 'application/markApplied', applicationId: pending.applicationId! }).catch(() => undefined);
      card.textContent = '✓ Marked as applied in your tracker.';
      setTimeout(() => host.remove(), 2500);
    });
    no.addEventListener('click', () => {
      void bg({ type: 'application/dismissPending' });
      host.remove();
    });
  };

  // ---------------------------------------------------------------- messages from popup / panel (via background)
  chrome.runtime.onMessage.addListener((msg: ContentRequest, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    (async () => {
      switch (msg.type) {
        case 'content/ping':
          return { ok: true, data: { nonce } };
        case 'content/state':
          scan();
          return { ok: true, data: { ...state(), nonce } };
        case 'content/fill':
          return { ok: true, data: await doFill(msg) };
        case 'content/openPanel':
          await openPanel();
          return { ok: true, data: true };
        case 'content/closePanel':
          await closePanel();
          return { ok: true, data: true };
        case 'content/host':
          // Only the top frame hosts UI for subframes.
          if (inSubframe) return { ok: false, error: 'Not the top frame' };
          if (msg.action === 'show') {
            await checkConnection();
            await showLauncher(msg.count, msg.nonce);
          }
          else if (msg.action === 'open') await openPanel(msg.nonce);
          else await closePanel();
          return { ok: true, data: true };
        default:
          return { ok: false, error: 'Unknown message' };
      }
    })()
      .then(sendResponse)
      .catch((e: Error) => sendResponse({ ok: false, error: e.message }));
    return true;
  });


  // ---------------------------------------------------------------- start
  scan();
  const refresh = async () => {
    const added = scan();
    reattach();
    if (looksLikeApplication(fields)) {
      const d = await checkConnection();
      if (d?.settings.showLauncher !== false) await showLauncher(fields.filter((f) => f.fieldType !== 'unknown').length);
    }
    if (added.length) {
      notifyPanel('panel/fieldsChanged', { added: added.map((f) => f.id) });
      await fillNew(added);
    }
  };
  await refresh();
  watchForFields(document, () => void refresh());
  void askSubmitted();
}
