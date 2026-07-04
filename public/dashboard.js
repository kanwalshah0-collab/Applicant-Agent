'use strict';

/* ─────────────────────────────────────────────────────────────
   State
───────────────────────────────────────────────────────────── */
const S = {
  candidateId: '',
  password: '',
  profile: null,
  conversations: [],
  offers: [],
  convSearch: '',
  convFilter: 'all',
  convSort: { key: 'lastContact', dir: 'desc' },
};

/* ─────────────────────────────────────────────────────────────
   Boot
───────────────────────────────────────────────────────────── */
function boot() {
  // Extract candidateId from URL path: /dashboard/abc123
  const parts = window.location.pathname.replace(/\/$/, '').split('/').filter(Boolean);
  S.candidateId = parts[parts.length - 1] || '';
  if (!S.candidateId || S.candidateId === 'dashboard') {
    window.location.href = '/';
    return;
  }

  // Password: URL query param → localStorage → show login
  const params = new URLSearchParams(window.location.search);
  S.password = params.get('password') || localStorage.getItem(`dash_pw_${S.candidateId}`) || '';

  if (!S.password) {
    showLoginOverlay();
    return;
  }

  loadAll();
}

/* ─────────────────────────────────────────────────────────────
   Auth
───────────────────────────────────────────────────────────── */
function showLoginOverlay(msg) {
  el('login-overlay').style.display = 'flex';
  el('loading-screen').style.display = 'none';
  if (msg) {
    el('login-error').textContent = msg;
    el('login-error').style.display = 'block';
  }
}

async function handleLogin() {
  const pw = el('login-password').value.trim();
  if (!pw) return;

  const btn = el('login-btn');
  btn.disabled = true;
  el('login-error').style.display = 'none';

  try {
    const r = await fetch(buildUrl(`/api/profile/candidate/${S.candidateId}`, pw));
    if (r.status === 401) {
      el('login-error').textContent = 'Incorrect password. Please try again.';
      el('login-error').style.display = 'block';
      return;
    }
    if (!r.ok) throw new Error(`${r.status}`);

    S.password = pw;
    localStorage.setItem(`dash_pw_${S.candidateId}`, pw);
    el('login-overlay').style.display = 'none';

    // Profile already fetched — store it and load the rest
    S.profile = await r.json();
    const [convs, offs] = await Promise.all([
      fetchJson(`/api/profile/candidate/${S.candidateId}/conversations`),
      fetchJson(`/api/profile/candidate/${S.candidateId}/offers`),
    ]);
    S.conversations = convs || [];
    S.offers = offs || [];

    renderAll();
    showDashboard();
  } catch {
    el('login-error').textContent = 'Could not connect to the server.';
    el('login-error').style.display = 'block';
  } finally {
    btn.disabled = false;
  }
}

function logout() {
  localStorage.removeItem(`dash_pw_${S.candidateId}`);
  localStorage.removeItem('dash_pw');
  localStorage.removeItem('dash_cid');
  window.location.href = `/dashboard/${S.candidateId}`;
}

/* ─────────────────────────────────────────────────────────────
   Data loading
───────────────────────────────────────────────────────────── */
function buildUrl(path, pw) {
  const password = pw ?? S.password;
  return `${path}?password=${encodeURIComponent(password)}`;
}

async function fetchJson(path) {
  const r = await fetch(buildUrl(path));
  if (r.status === 401) { showLoginOverlay('Session expired. Please sign in again.'); return null; }
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

async function loadAll() {
  try {
    const [profile, convs, offs] = await Promise.all([
      fetchJson(`/api/profile/candidate/${S.candidateId}`),
      fetchJson(`/api/profile/candidate/${S.candidateId}/conversations`),
      fetchJson(`/api/profile/candidate/${S.candidateId}/offers`),
    ]);

    if (!profile) return; // 401 already handled

    S.profile       = profile;
    S.conversations = convs  || [];
    S.offers        = offs   || [];

    localStorage.setItem(`dash_pw_${S.candidateId}`, S.password);
    renderAll();
    showDashboard();
  } catch (err) {
    console.error('loadAll:', err);
    el('loading-screen').innerHTML = `
      <div class="load-error">
        <p>Failed to load dashboard data.</p>
        <button class="button-primary" onclick="location.reload()" style="margin-top:12px">Retry</button>
      </div>`;
  }
}

function showDashboard() {
  el('loading-screen').style.display = 'none';
  el('dashboard').style.display = 'block';
}

/* ─────────────────────────────────────────────────────────────
   Tab switching
───────────────────────────────────────────────────────────── */
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.style.display = panel.dataset.tab === tab ? 'block' : 'none';
  });
}

/* ─────────────────────────────────────────────────────────────
   Render — all sections
───────────────────────────────────────────────────────────── */
function renderAll() {
  renderProfileSummary();
  renderAnalytics();
  renderRecentConvs();
  renderRecentOffers();
  renderConversationsTab();
  renderOffersTab();
  renderProfileTab();
}

/* ─── Profile summary (Overview card) ─── */
function renderProfileSummary() {
  const p = S.profile;
  el('profile-name').textContent     = p.name     || '—';
  el('profile-email').textContent    = p.email    || '—';
  el('profile-location').textContent = p.location || '—';
  el('profile-roles').textContent    = (p.targetRoles || []).join(', ') || '—';
  el('profile-salary').textContent   = fmtSalaryRange(p.targetSalary);
  el('profile-nonneg').textContent   = (p.nonNegotiables || []).join(', ') || '—';
  el('profile-url').textContent      = p.shareableUrl || '';

  const post = buildLinkedInPost(p);
  el('li-btn').href = 'https://www.linkedin.com/feed/?shareActive=true&text=' + encodeURIComponent(post);
}

function buildLinkedInPost(p) {
  const role = (p.targetRoles || [])[0] || 'new opportunities';
  return `I'm actively exploring ${role} roles.\n\nMeet my AI representative and let's start a conversation:\n${p.shareableUrl || ''}`;
}

/* ─── Analytics ─── */
function renderAnalytics() {
  const convs  = S.conversations;
  const offers = S.offers;
  const total  = convs.length;

  const convRate = total > 0 ? Math.round((offers.length / total) * 100) : 0;
  const avgMsgs  = total > 0
    ? Math.round(convs.reduce((s, c) => s + (c.messageCount || 0), 0) / total)
    : 0;

  // Top companies by visit frequency
  const companyCounts = {};
  convs.forEach(c => {
    const name = c.companyName || null;
    if (name) companyCounts[name] = (companyCounts[name] || 0) + 1;
  });
  const topCompanies = Object.entries(companyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name)
    .join(', ') || '—';

  const topRole = (S.profile.targetRoles || [])[0] || '—';

  el('stat-visits').textContent       = total;
  el('stat-offers').textContent       = offers.length;
  el('stat-rate').textContent         = convRate + '%';
  el('stat-avg-msgs').textContent     = avgMsgs;
  el('stat-top-companies').textContent = topCompanies;
  el('stat-top-role').textContent     = topRole;
}

/* ─── Recent conversations (Overview table, max 5) ─── */
function renderRecentConvs() {
  const recent = [...S.conversations]
    .sort((a, b) => new Date(b.lastContact || 0) - new Date(a.lastContact || 0))
    .slice(0, 5);

  el('recent-convs').innerHTML = recent.length === 0
    ? '<tr><td colspan="6" class="empty-row">No conversations yet. Share your link!</td></tr>'
    : recent.map(convRow).join('');
}

/* ─── Recent offers (Overview grid, max 3) ─── */
function renderRecentOffers() {
  const container = el('recent-offers');
  const recent = S.offers.slice(0, 3);
  if (recent.length === 0) {
    container.innerHTML = '<p class="empty-msg">No offers yet. Share your link to get started!</p>';
  } else {
    container.innerHTML = recent.map(offerCard).join('');
    container.classList.add('offers-grid');
  }
}

/* ─── Full conversations tab ─── */
function renderConversationsTab() {
  applyConvFilters();
}

/* ─── Full offers tab ─── */
function renderOffersTab() {
  const statusFilter = el('offer-filter')?.value || 'all';
  const filtered = statusFilter === 'all'
    ? S.offers
    : S.offers.filter(o => (o.offerStatus || 'mentioned') === statusFilter);

  const grid = el('offers-grid');
  if (!grid) return;

  if (filtered.length === 0) {
    grid.innerHTML = '<p class="empty-msg">No offers yet. Share your link to get started!</p>';
    grid.classList.remove('offers-grid');
  } else {
    grid.innerHTML = filtered.map(offerCard).join('');
    grid.classList.add('offers-grid');
  }
}

/* ─── Profile tab (read-only view) ─── */
function renderProfileTab() {
  const p = S.profile;
  el('pv-name').textContent     = p.name     || '—';
  el('pv-email').textContent    = p.email    || '—';
  el('pv-location').textContent = p.location || '—';
  el('pv-roles').textContent    = (p.targetRoles || []).join(', ') || '—';
  el('pv-salary').textContent   = fmtSalaryRange(p.targetSalary);
  el('pv-url').textContent      = p.shareableUrl || '';
  el('pv-cid').textContent      = p.candidateId  || '';
  el('pv-since').textContent    = p.createdAt ? fmtDate(p.createdAt) : '—';

  const availMap = { open: 'Open to opportunities', interviewing: 'Actively interviewing', closed: 'Not looking right now' };
  const availClass = { open: 'avail--open', interviewing: 'avail--interviewing', closed: 'avail--closed' };
  const avail = p.availability || 'open';
  el('pv-availability').innerHTML = `<span class="avail-badge ${availClass[avail] || 'avail--open'}">${availMap[avail] || avail}</span>`;

  const pillsEl = el('pv-nonneg-pills');
  const items = p.nonNegotiables || [];
  pillsEl.innerHTML = items.length > 0
    ? items.map(n => `<span class="pv-pill">${esc(n)}</span>`).join('')
    : '<span style="color:var(--gray-400);font-size:.88rem">—</span>';
}

/* ─────────────────────────────────────────────────────────────
   Conversations — search / filter / sort
───────────────────────────────────────────────────────────── */
function onConvSearch(value) {
  S.convSearch = value;
  applyConvFilters();
}

function onConvFilter(value) {
  S.convFilter = value;
  applyConvFilters();
}

function setConvSort(key) {
  if (S.convSort.key === key) {
    S.convSort.dir = S.convSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    S.convSort.key = key;
    S.convSort.dir = 'desc';
  }

  // Update sort indicators
  ['company', 'firstContact', 'lastContact', 'messageCount'].forEach(k => {
    const ind = el(`sort-${k}`);
    if (!ind) return;
    ind.textContent = k === S.convSort.key
      ? (S.convSort.dir === 'asc' ? '↑' : '↓')
      : '';
  });

  applyConvFilters();
}

function applyConvFilters() {
  let convs = [...S.conversations];

  // Search
  const q = S.convSearch.toLowerCase();
  if (q) {
    convs = convs.filter(c =>
      (c.companyName  || '').toLowerCase().includes(q) ||
      (c.recruiterId  || '').toLowerCase().includes(q)
    );
  }

  // Status filter
  if (S.convFilter === 'none') {
    convs = convs.filter(c => !c.offerStatus);
  } else if (S.convFilter !== 'all') {
    convs = convs.filter(c => c.offerStatus === S.convFilter);
  }

  // Sort
  convs.sort((a, b) => {
    let va, vb;
    switch (S.convSort.key) {
      case 'messageCount':
        va = a.messageCount || 0; vb = b.messageCount || 0; break;
      case 'company':
        va = (a.companyName || '￿').toLowerCase();
        vb = (b.companyName || '￿').toLowerCase(); break;
      case 'firstContact':
        va = new Date(a.firstContact || 0).getTime();
        vb = new Date(b.firstContact || 0).getTime(); break;
      default: // lastContact
        va = new Date(a.lastContact || 0).getTime();
        vb = new Date(b.lastContact || 0).getTime(); break;
    }
    return S.convSort.dir === 'asc'
      ? (va > vb ? 1 : va < vb ? -1 : 0)
      : (va < vb ? 1 : va > vb ? -1 : 0);
  });

  const tbody = el('convs-tbody');
  if (!tbody) return;
  tbody.innerHTML = convs.length === 0
    ? '<tr><td colspan="6" class="empty-row">No conversations match your filters.</td></tr>'
    : convs.map(convRow).join('');
}

/* ─────────────────────────────────────────────────────────────
   HTML fragments
───────────────────────────────────────────────────────────── */
function convRow(c) {
  const company   = esc(c.companyName || 'Anonymous');
  const firstDate = c.firstContact ? fmtDate(c.firstContact) : '—';
  const lastDate  = c.lastContact  ? fmtDate(c.lastContact)  : '—';
  const msgs      = c.messageCount || 0;
  const status    = c.offerStatus || 'active';
  const rid       = esc(c.recruiterId);
  return `<tr>
    <td>${company}</td>
    <td>${firstDate}</td>
    <td>${lastDate}</td>
    <td>${msgs}</td>
    <td>${renderBadge(status)}</td>
    <td><button class="btn-sm" onclick="openTranscript('${rid}')">View</button></td>
  </tr>`;
}

function offerCard(o) {
  const company    = esc(o.companyName || 'Unknown Company');
  const status     = o.offerStatus || 'mentioned';
  const date       = o.lastContact ? fmtDate(o.lastContact) : '—';
  const target     = fmtSalaryRange(S.profile?.targetSalary);
  const rid        = esc(o.recruiterId);
  return `<div class="offer-card">
    <div class="offer-header">
      <span class="offer-company">${company}</span>
      ${renderBadge(status)}
    </div>
    <div class="offer-rows">
      <div class="offer-row"><span>Your target range</span><strong>${target}</strong></div>
      <div class="offer-row"><span>Last contact</span><strong>${date}</strong></div>
    </div>
    <div class="offer-actions" style="margin-top:10px">
      <button class="btn-sm" onclick="openTranscript('${rid}')">View Conversation</button>
    </div>
  </div>`;
}

function renderBadge(status) {
  const labels = {
    active: 'Active', offered: 'Offered', negotiating: 'Negotiating',
    accepted: 'Accepted', declined: 'Declined', mentioned: 'Mentioned',
  };
  const label = labels[status] || esc(status);
  return `<span class="badge badge--${esc(status)}">${label}</span>`;
}

/* ─────────────────────────────────────────────────────────────
   Transcript modal
───────────────────────────────────────────────────────────── */
async function openTranscript(recruiterId) {
  const body = el('transcript-body');
  el('transcript-title').textContent = 'Loading…';
  body.innerHTML = '<div class="modal-loading">Loading conversation…</div>';
  el('modal-transcript').classList.add('open');

  try {
    const r = await fetch(`/api/chat/${S.candidateId}/${recruiterId}`);
    if (!r.ok) throw new Error(`${r.status}`);
    const data = await r.json();
    const msgs = data.messages || [];

    el('transcript-title').textContent = `Conversation · ${msgs.length} message${msgs.length !== 1 ? 's' : ''}`;

    if (msgs.length === 0) {
      body.innerHTML = '<p class="empty-msg">No messages in this conversation yet.</p>';
      return;
    }

    body.innerHTML = msgs.map(m => {
      const role = m.role === 'agent' ? 'agent' : 'recruiter';
      const time = m.timestamp ? fmtTime(m.timestamp) : '';
      return `<div class="chat-msg chat-msg--${role}">
        <div class="chat-bubble">${esc(m.content)}</div>
        ${time ? `<div class="chat-time">${time}</div>` : ''}
      </div>`;
    }).join('');

    body.scrollTop = body.scrollHeight;
  } catch (err) {
    body.innerHTML = '<p class="modal-error">Failed to load conversation. Please try again.</p>';
    console.error('openTranscript:', err);
  }
}

function printTranscript() {
  window.print();
}

/* ─────────────────────────────────────────────────────────────
   Edit profile modal
───────────────────────────────────────────────────────────── */
function openEditProfile() {
  const p = S.profile;

  // Pre-fill form from current state
  el('edit-location').value   = p.location || '';
  el('edit-roles').value      = (p.targetRoles || []).join(', ');
  el('edit-salary-min').value = p.targetSalary?.min || '';
  el('edit-salary-max').value = p.targetSalary?.max || '';
  el('edit-custom-nn').value  = '';
  el('edit-availability').value = p.availability || 'open';

  document.querySelectorAll('.edit-nn-checkbox').forEach(cb => {
    const checked = (p.nonNegotiables || []).includes(cb.dataset.label);
    cb.checked = checked;
    cb.closest('.check-item').classList.toggle('checked', checked);
  });

  el('edit-success').style.display = 'none';
  el('edit-error').style.display   = 'none';
  el('modal-edit').classList.add('open');
}

async function saveProfile() {
  const location   = el('edit-location').value.trim();
  const rolesRaw   = el('edit-roles').value.trim();
  const targetRoles = rolesRaw.split(',').map(r => r.trim()).filter(Boolean);
  const salaryMin  = parseInt(el('edit-salary-min').value, 10) || null;
  const salaryMax  = parseInt(el('edit-salary-max').value, 10) || null;
  const availability = el('edit-availability').value;

  const nonNegotiables = [];
  document.querySelectorAll('.edit-nn-checkbox:checked').forEach(cb => nonNegotiables.push(cb.dataset.label));
  const customNn = el('edit-custom-nn').value.trim();
  if (customNn) nonNegotiables.push(customNn);

  const saveBtn = el('save-btn');
  saveBtn.disabled = true;
  el('edit-success').style.display = 'none';
  el('edit-error').style.display   = 'none';

  try {
    const r = await fetch(buildUrl(`/api/profile/candidate/${S.candidateId}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location, targetRoles, targetSalary: { min: salaryMin, max: salaryMax }, nonNegotiables, availability }),
    });

    if (r.status === 401) { showLoginOverlay('Session expired.'); return; }
    if (!r.ok) throw new Error(`${r.status}`);

    S.profile = await r.json();
    el('edit-success').style.display = 'block';
    renderAll();

    setTimeout(() => closeModal('modal-edit'), 1000);
  } catch (err) {
    el('edit-error').style.display = 'block';
    console.error('saveProfile:', err);
  } finally {
    saveBtn.disabled = false;
  }
}

/* ─────────────────────────────────────────────────────────────
   Modal helpers
───────────────────────────────────────────────────────────── */
function closeModal(id) {
  el(id).classList.remove('open');
}

function onOverlayClick(event, modalId) {
  if (event.target === el(modalId)) closeModal(modalId);
}

/* ─────────────────────────────────────────────────────────────
   Clipboard
───────────────────────────────────────────────────────────── */
function copyUrl() {
  const url = S.profile?.shareableUrl || '';
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => {
    const btn = el('copy-url-btn');
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = orig; }, 1800);
  });
}

/* ─────────────────────────────────────────────────────────────
   Checkbox highlight sync (edit modal)
───────────────────────────────────────────────────────────── */
document.addEventListener('change', e => {
  if (e.target.classList.contains('edit-nn-checkbox')) {
    e.target.closest('.check-item').classList.toggle('checked', e.target.checked);
  }
});

/* ─────────────────────────────────────────────────────────────
   Formatters
───────────────────────────────────────────────────────────── */
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function fmtSalary(n) {
  if (!n) return '—';
  return '$' + Number(n).toLocaleString();
}

function fmtSalaryRange(sal) {
  if (!sal) return '—';
  if (sal.min && sal.max) return `${fmtSalary(sal.min)} – ${fmtSalary(sal.max)}`;
  if (sal.min) return `${fmtSalary(sal.min)}+`;
  if (sal.max) return `Up to ${fmtSalary(sal.max)}`;
  return '—';
}

/* ─────────────────────────────────────────────────────────────
   Utils
───────────────────────────────────────────────────────────── */
function el(id) { return document.getElementById(id); }

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─────────────────────────────────────────────────────────────
   Boot
───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', boot);
