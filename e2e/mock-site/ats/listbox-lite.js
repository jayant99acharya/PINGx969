// Button-triggered listbox dropdowns as used by Workday ("Select One" buttons) and BambooHR
// (fab-SelectToggle): the menu is rendered into a portal at the end of <body> only while open,
// options are role="option", choosing one updates the button text and a hidden input.
window.mountListboxes = function mountListboxes(root) {
  (root || document).querySelectorAll('button[aria-haspopup="listbox"][data-options]:not([data-mounted])').forEach((btn) => {
    btn.setAttribute('data-mounted', '');
    const options = JSON.parse(btn.getAttribute('data-options'));
    const hidden = btn.parentElement.querySelector('input[type="hidden"]');
    let menu = null;
    const close = () => {
      menu?.remove();
      menu = null;
      btn.setAttribute('aria-expanded', 'false');
    };
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (menu) return close();
      document.querySelectorAll('.menu-portal').forEach((m) => m.dispatchEvent(new Event('px-close')));
      menu = document.createElement('ul');
      menu.className = 'menu-portal';
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('data-automation-id', 'activeListContainer');
      menu.addEventListener('px-close', close);
      options.forEach((label) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(btn.textContent.trim() === label));
        li.setAttribute('data-automation-id', 'promptOption');
        li.innerHTML = '<div></div>';
        li.firstChild.textContent = label;
        li.addEventListener('click', () => {
          btn.textContent = label;
          if (hidden) hidden.value = label;
          close();
          btn.dispatchEvent(new Event('change', { bubbles: true }));
        });
        menu.append(li);
      });
      const r = btn.getBoundingClientRect();
      menu.style.left = `${r.left + scrollX}px`;
      menu.style.top = `${r.bottom + scrollY}px`;
      document.body.append(menu);
      btn.setAttribute('aria-expanded', 'true');
    });
    document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    document.addEventListener('mousedown', (e) => {
      if (menu && !menu.contains(e.target) && e.target !== btn) close();
    });
  });
};
