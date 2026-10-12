// Shared mock-site behaviour: forms "submit" to a confirmation page without a backend.
document.querySelectorAll('form').forEach((form) => {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const company = document.title.split(/ at | - /).pop();
    window.location.href = '/submitted.html?from=' + encodeURIComponent(location.pathname) + '&company=' + encodeURIComponent(company || '');
  });
});
