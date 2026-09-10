export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatDate(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-YE', { year: 'numeric', month: 'short', day: 'numeric' })
      .format(new Date(`${value}T12:00:00`));
  } catch {
    return value;
  }
}

export function toast(message, type = 'success') {
  const host = document.querySelector('#toast-host');
  if (!host) return;
  const element = document.createElement('div');
  element.className = `toast toast-${type}`;
  element.innerHTML = `<i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i><span>${escapeHtml(message)}</span>`;
  host.appendChild(element);
  setTimeout(() => element.classList.add('show'), 20);
  setTimeout(() => {
    element.classList.remove('show');
    setTimeout(() => element.remove(), 250);
  }, 3200);
}

export function setBusy(button, busy, label = 'جارٍ الحفظ...') {
  if (!button) return;
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${label}`;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
  }
}
