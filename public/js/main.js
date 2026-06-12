const form = document.getElementById('createForm');
const createBtn = document.getElementById('createBtn');
const toast = document.getElementById('toast');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

function getSavedEvents() {
  try {
    return JSON.parse(localStorage.getItem('wff:events') || '[]');
  } catch {
    return [];
  }
}

function renderSavedEvents() {
  const events = getSavedEvents();
  const box = document.getElementById('myEvents');
  if (!events.length) return;
  box.innerHTML = `
    <hr style="border: none; border-top: 1px solid var(--line); margin: 22px 0;" />
    <h3 style="font-size: 1rem; margin-bottom: 10px;">Your Events</h3>
    ${events
      .map(
        ev => `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 0; flex-wrap: wrap;">
        <strong style="font-size: 0.95rem;">${escapeHtml(ev.name)}</strong>
        <a class="btn btn-ghost btn-sm" href="/admin/${ev.id}?key=${ev.adminKey}">Open Dashboard</a>
      </div>`
      )
      .join('')}
  `;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('eventName').value.trim();
  if (!name) return;
  createBtn.disabled = true;
  createBtn.innerHTML = '<span class="spinner"></span> Creating…';
  try {
    const res = await fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create event');
    const events = getSavedEvents();
    events.unshift({ id: data.id, name: data.name, adminKey: data.adminKey });
    localStorage.setItem('wff:events', JSON.stringify(events.slice(0, 20)));
    localStorage.setItem(`wff:key:${data.id}`, data.adminKey);
    location.href = `/admin/${data.id}?key=${data.adminKey}`;
  } catch (err) {
    showToast(err.message);
    createBtn.disabled = false;
    createBtn.textContent = 'Create Event ✨';
  }
});

renderSavedEvents();
