/**
 * Runs in the page's MAIN world and only answers one question for the content script: "may we insert
 * UI yet?". Frameworks that hydrate the whole document (Remix / React Router framework mode, Next.js
 * App Router — e.g. Greenhouse job-boards) throw away and re-render the page if they find nodes they
 * did not render, and whether React has hydrated is only visible from the page's own JS world (React
 * attaches __reactFiber$ keys to elements it has claimed). It reads nothing else, sends nothing, and
 * the worst a page can do by imitating its event is make the launcher appear early.
 */
(() => {
  const w = window as unknown as { __pingx969Ready?: boolean };
  if (w.__pingx969Ready !== undefined) return;
  w.__pingx969Ready = false;
  const announce = () => {
    w.__pingx969Ready = true;
    document.dispatchEvent(new CustomEvent('pingx969:page-ready'));
  };
  document.addEventListener('pingx969:ask-ready', () => w.__pingx969Ready && announce());

  const inline = Array.from(document.scripts, (s) => (s.textContent ?? '').slice(0, 300)).join(' ');
  const wholeDocument = /__remixContext|__reactRouterContext|self\.__next_f/.test(inline);
  if (!wholeDocument) return announce();
  const hydrated = () => Object.keys(document.body ?? {}).some((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  const started = Date.now();
  const tick = () => (hydrated() || Date.now() - started > 15_000 ? announce() : setTimeout(tick, 100));
  tick();
})();
