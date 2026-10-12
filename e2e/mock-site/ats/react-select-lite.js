// Minimal imitation of react-select v5 as rendered by Greenhouse's job-boards forms:
// input[role=combobox] inside .select__control, options rendered only while the menu is open,
// selection shown in .select__single-value, typed text cleared on blur (the behaviour that
// breaks naive "type then blur" autofill).
(function () {
  let seq = 0;
  document.querySelectorAll('[data-rs-options]').forEach((wrap) => {
    const input = wrap.querySelector('input.select__input');
    const control = wrap.querySelector('.select__control');
    const placeholder = wrap.querySelector('.select__placeholder');
    const required = wrap.querySelector('input.requiredInput');
    const options = JSON.parse(wrap.getAttribute('data-rs-options'));
    const async = wrap.hasAttribute('data-rs-async'); // location: suggestions only after typing
    const id = input.id || `rs${seq++}`;
    let menu = null;
    let single = null;

    const close = () => {
      menu?.remove();
      menu = null;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-controls');
    };
    const choose = (label) => {
      close();
      input.value = '';
      placeholder.hidden = true;
      if (!single) {
        single = document.createElement('div');
        single.className = 'select__single-value';
        placeholder.after(single);
      }
      single.textContent = label;
      if (required) required.value = label;
    };
    const open = () => {
      const q = input.value.trim().toLowerCase();
      const list = options.filter((o) => !q || o.toLowerCase().includes(q));
      if (async && !q) return close();
      close();
      menu = document.createElement('div');
      menu.className = 'select__menu';
      const lb = document.createElement('div');
      lb.className = 'select__menu-list';
      lb.setAttribute('role', 'listbox');
      lb.id = `react-select-${id}-listbox`;
      if (!list.length) {
        const none = document.createElement('div');
        none.className = 'select__menu-notice--no-options';
        none.textContent = 'No options';
        lb.append(none);
      }
      list.forEach((label, i) => {
        const o = document.createElement('div');
        o.className = 'select__option';
        o.setAttribute('role', 'option');
        o.id = `react-select-${id}-option-${i}`;
        o.setAttribute('aria-selected', 'false');
        o.textContent = label;
        o.addEventListener('mousedown', (e) => {
          e.preventDefault();
          choose(label);
        });
        lb.append(o);
      });
      menu.append(lb);
      control.append(menu);
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-controls', lb.id);
    };
    const later = (fn) => (async ? setTimeout(fn, 150) : fn()); // location suggestions arrive asynchronously
    control.addEventListener('mousedown', (e) => {
      if (e.target.closest('[role="option"]')) return;
      if (e.target !== input) e.preventDefault();
      input.focus();
      if (menu) close();
      else open();
    });
    input.addEventListener('input', () => later(open));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && !menu) later(open);
      if (e.key === 'Escape') close();
    });
    input.addEventListener('blur', () => {
      close();
      input.value = ''; // react-select discards unselected input text
    });
  });
})();
