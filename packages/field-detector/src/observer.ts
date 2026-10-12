import { shadowRoots } from './dom';

const CONTROL = 'input, select, textarea, [role="radio"], [role="checkbox"], [role="combobox"], [role="listbox"], button[aria-pressed], button[aria-haspopup="listbox"]';

/**
 * Watch for dynamically added/revealed form fields (multi-step forms, "Add another",
 * conditional questions, web components rendering into shadow roots). Calls `onChange`
 * (debounced) when the set of controls may have changed.
 */
export function watchForFields(root: Node, onChange: () => void, debounceMs = 350): () => void {
  const win = (root as Document).defaultView ?? (root as Element).ownerDocument?.defaultView;
  if (!win?.MutationObserver) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      observeShadows();
      onChange();
    }, debounceMs);
  };
  const relevant = (n: Node): boolean => {
    if (n.nodeType !== 1) return false;
    const el = n as Element;
    if (el.closest('[data-px-ui]') || el.hasAttribute('data-px-ui')) return false;
    // Custom elements usually render their controls into a shadow root after insertion.
    return el.matches(CONTROL) || el.tagName.includes('-') || !!el.querySelector?.(CONTROL);
  };
  const obs = new win.MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') {
        if (Array.from(m.addedNodes).some(relevant) || Array.from(m.removedNodes).some(relevant)) return trigger();
      } else if (m.type === 'attributes' && relevant(m.target)) {
        return trigger();
      }
    }
  });
  const options: MutationObserverInit = { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'disabled', 'aria-expanded'] };
  const watched = new WeakSet<Node>();
  const observeShadows = () => {
    const start = (root as Document).documentElement ?? (root as Element);
    for (const sr of shadowRoots(start as Element)) {
      if (watched.has(sr)) continue;
      watched.add(sr);
      obs.observe(sr, options);
    }
  };
  obs.observe(root, options);
  observeShadows();
  return () => {
    obs.disconnect();
    if (timer) clearTimeout(timer);
  };
}
