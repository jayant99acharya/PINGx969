/** Which browser is showing this page, for install instructions that match it. */
function detectBrowser(): { name: string; extensionsUrl: string | null; mobile: boolean } {
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands.map((b) => b.brand).join(' ') ?? '';
  const brave = (navigator as Navigator & { brave?: unknown }).brave !== undefined;
  if (/Edg\//.test(ua)) return { name: 'Microsoft Edge', extensionsUrl: 'edge://extensions', mobile };
  if (brave) return { name: 'Brave', extensionsUrl: 'brave://extensions', mobile };
  if (/OPR\//.test(ua)) return { name: 'Opera', extensionsUrl: 'opera://extensions', mobile };
  if (/Vivaldi/.test(ua)) return { name: 'Vivaldi', extensionsUrl: 'vivaldi://extensions', mobile };
  if (/Firefox\//.test(ua)) return { name: 'Firefox', extensionsUrl: null, mobile };
  if (/Safari\//.test(ua) && !/Chrome|Chromium/.test(ua + brands)) return { name: 'Safari', extensionsUrl: null, mobile };
  return { name: 'Chrome', extensionsUrl: 'chrome://extensions', mobile };
}

const SITES =
  'Greenhouse, Lever, Workday, Ashby, Workable, SmartRecruiters, Jobvite, JazzHR, BambooHR, iCIMS, Zoho Recruit, Oracle Cloud, Kula, Keka, Teamtailor, Rippling, Recruitee, Breezy HR, Personio, Google Forms and LinkedIn Easy Apply';

export function ExtensionPage() {
  const origin = window.location.origin.replace(':5173', ':4000');
  const browser = detectBrowser();
  const unsupported = browser.mobile || !browser.extensionsUrl;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div>
          <h1>Browser extension</h1>
          <p>Autofill job applications from your profile, reuse saved answers, and attach the right tailored resume.</p>
        </div>
      </div>

      {unsupported && (
        <div className="alert alert-warn">
          {browser.mobile
            ? 'Browser extensions don’t run on phones and tablets (Android or iOS). Open this page on a Windows, macOS, Linux or ChromeOS computer to install it. The rest of the dashboard works here.'
            : `${browser.name} isn’t supported yet. Use Chrome, Edge, Brave, Opera or Vivaldi on a computer.`}
        </div>
      )}

      <div className="card stack">
        <h2>Install in {unsupported ? 'Chrome, Edge, Brave, Opera or Vivaldi' : browser.name} (about 2 minutes)</h2>
        <ol className="stack" style={{ paddingLeft: 18, margin: 0, gap: 6 }}>
          <li>
            Get the extension folder: download <span className="kbd">pingx969-extension-…-localhost-4000.zip</span> from the project’s
            GitHub <strong>Releases</strong> page and unzip it — or, if you built the project yourself, use <span className="kbd">apps/extension/dist</span>.
          </li>
          <li>
            Open <span className="kbd">{browser.extensionsUrl ?? 'chrome://extensions'}</span> in the address bar and switch on <strong>Developer mode</strong>.
          </li>
          <li>
            Click <strong>Load unpacked</strong> and choose the unzipped folder (the one that contains <span className="kbd">manifest.json</span>).
          </li>
          <li>
            The options page opens: set the server to <span className="kbd">{origin}</span> and sign in with this account. Pin the extension from the
            puzzle-piece menu if you like.
          </li>
        </ol>
        <p className="muted small" style={{ margin: 0 }}>
          Keep this PINGx969 server running while you apply — the extension reads your profile from it. After updating the extension, click its
          reload icon on the extensions page.
        </p>
      </div>

      <div className="card stack">
        <h2>How it works</h2>
        <ul className="stack" style={{ paddingLeft: 18, margin: 0, gap: 6 }}>
          <li>
            On supported job sites ({SITES}) a small “⚡ Autofill” button appears. On any other site, click the toolbar icon and choose{' '}
            <strong>Scan this page</strong>.
          </li>
          <li>Review every value before it’s written. Fields that already have a value are never overwritten unless you choose to.</li>
          <li>Questions without a saved answer are never guessed — answer them once and tick “Remember this answer”.</li>
          <li>Consent boxes and e-signatures are always left to you, and the extension never submits an application.</li>
          <li>If the button says “sign in to fill” or “server offline”, open the extension’s options and check the server address and sign-in.</li>
        </ul>
      </div>
    </div>
  );
}
