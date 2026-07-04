'use strict';

const express = require('express');
const router  = express.Router();
const storage = require('../utils/candidate-storage');

// ── Auth ──────────────────────────────────────────────────────────────────────

function isAuthenticated(req) {
  const pw = process.env.CANDIDATE_PASSWORD;
  return pw && req.query.password === pw;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtSalary(n) {
  if (!n) return '—';
  return '$' + Number(n).toLocaleString('en-US');
}

function fmtSalaryRange(sal) {
  if (!sal) return '—';
  const min = sal.min ? `$${Math.round(sal.min / 1000)}k` : null;
  const max = sal.max ? `$${Math.round(sal.max / 1000)}k` : null;
  if (min && max) return `${min} – ${max}`;
  if (min) return `${min}+`;
  if (max) return `Up to ${max}`;
  return '—';
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return '—'; }
}

function statusBadge(status) {
  const map = {
    offered:     ['badge--offered',     'Offered'],
    negotiating: ['badge--negotiating', 'Negotiating'],
    accepted:    ['badge--accepted',    'Accepted'],
    declined:    ['badge--declined',    'Declined'],
    mentioned:   ['badge--mentioned',   'Mentioned'],
  };
  const [cls, label] = map[status] || ['badge--active', 'Active'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function availBadge(avail) {
  const map = {
    open:         ['avail--open',         'Open to opportunities'],
    interviewing: ['avail--interviewing', 'Actively interviewing'],
    closed:       ['avail--closed',       'Not looking'],
  };
  const [cls, label] = map[avail] || ['avail--open', 'Open'];
  return `<span class="avail-badge ${cls}">${label}</span>`;
}

function computeAnalytics(conversations) {
  const total = conversations.length;
  if (total === 0) return { total: 0, offerCount: 0, convRate: 0, avgMsgs: 0, topCompanies: '—' };

  const offerStatuses = new Set(['offered', 'negotiating', 'accepted']);
  const offerCount = conversations.filter(c => offerStatuses.has(c.offerStatus)).length;

  const convRate = Math.round((offerCount / total) * 100);

  const avgMsgs = Math.round(
    conversations.reduce((sum, c) => sum + (c.messageCount || 0), 0) / total
  );

  const companyCounts = {};
  conversations.forEach(c => {
    if (c.companyName) {
      companyCounts[c.companyName] = (companyCounts[c.companyName] || 0) + 1;
    }
  });
  const topCompanies = Object.entries(companyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => name)
    .join(', ') || '—';

  return { total, offerCount, convRate, avgMsgs, topCompanies };
}

// ── GET /api/dashboard/:candidateId ──────────────────────────────────────────

router.get('/:candidateId', async (req, res) => {
  if (!isAuthenticated(req)) {
    return res.status(401).send(buildLoginPage(req.params.candidateId));
  }

  const { candidateId } = req.params;
  const password = req.query.password;

  let profile, conversations, offers;
  try {
    profile       = await storage.getProfile(candidateId);
    conversations = await storage.getAllConversations(candidateId);
    offers        = await storage.getCandidateOffers(candidateId);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).send(build404Page());
    }
    console.error('[dashboard] load error:', err);
    return res.status(500).send('Internal server error');
  }

  const analytics = computeAnalytics(conversations);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(buildDashboard(profile, conversations, offers, analytics, password));
});

// ── Login page ────────────────────────────────────────────────────────────────

function buildLoginPage(candidateId) {
  const cid = escHtml(candidateId);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Dashboard Login — Applicant Agent</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:#fff;border-radius:16px;padding:40px 36px;box-shadow:0 2px 16px rgba(0,0,0,.1);width:100%;max-width:380px}
    h1{font-size:1.35rem;font-weight:700;margin-bottom:6px;color:#0f766e}
    p{color:#6b7280;font-size:.9rem;margin-bottom:24px}
    input{width:100%;padding:11px 14px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:.95rem;outline:none;margin-bottom:12px;transition:border-color .15s}
    input:focus{border-color:#14b8a6}
    button{width:100%;padding:12px;background:#0d9488;color:#fff;border:none;border-radius:8px;font-size:.95rem;cursor:pointer;font-weight:500;transition:opacity .15s}
    button:hover{opacity:.9}
    .err{color:#dc2626;font-size:.82rem;margin-top:8px;display:none}
    .hint{font-size:.78rem;color:#9ca3af;margin-top:16px;text-align:center}
  </style>
</head>
<body>
  <div class="card">
    <h1>🎯 Career Dashboard</h1>
    <p>Enter your password to access your private dashboard.</p>
    <input id="pw" type="password" placeholder="Dashboard password"
           onkeydown="if(event.key==='Enter')login()" autocomplete="current-password"/>
    <button onclick="login()">Sign In</button>
    <p class="err" id="err">Incorrect password. Please try again.</p>
    <p class="hint">Password is set via the CANDIDATE_PASSWORD environment variable.</p>
  </div>
  <script>
    function login() {
      var pw = document.getElementById('pw').value.trim();
      if (!pw) return;
      var url = '/api/dashboard/${cid}?password=' + encodeURIComponent(pw);
      fetch(url, { redirect: 'follow' }).then(function(r) {
        if (r.status === 401) {
          document.getElementById('err').style.display = 'block';
        } else if (r.ok) {
          localStorage.setItem('dash_pw_${cid}', pw);
          window.location.href = url;
        }
      }).catch(function() {
        document.getElementById('err').textContent = 'Connection error. Try again.';
        document.getElementById('err').style.display = 'block';
      });
    }
  </script>
</body>
</html>`;
}

// ── 404 page ──────────────────────────────────────────────────────────────────

function build404Page() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Not Found — Applicant Agent</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
    .card{background:#fff;border-radius:16px;padding:48px 40px;box-shadow:0 2px 16px rgba(0,0,0,.1);max-width:400px;width:100%}
    h1{font-size:1.3rem;font-weight:700;margin-bottom:8px;color:#374151}
    p{color:#6b7280;margin-bottom:28px}
    a{display:inline-block;padding:11px 24px;background:#0d9488;color:#fff;border-radius:8px;text-decoration:none;font-weight:500}
    a:hover{opacity:.9}
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:3rem;margin-bottom:14px">🔍</div>
    <h1>Candidate Not Found</h1>
    <p>This dashboard link may be invalid or the profile may have been removed.</p>
    <a href="/">Go Home</a>
  </div>
</body>
</html>`;
}

// ── Dashboard HTML ────────────────────────────────────────────────────────────

function buildDashboard(profile, conversations, offers, analytics, password) {
  const cid        = profile.candidateId;
  const shareUrl   = profile.shareableUrl || '';
  const targetSal  = fmtSalaryRange(profile.targetSalary);
  const roles      = (profile.targetRoles    || []).map(escHtml).join(', ') || '—';
  const nonneg     = (profile.nonNegotiables || []).map(escHtml).join(' · ') || '—';

  // ── Conversation rows ──────────────────────────────────────────────────────
  const convRows = conversations.length === 0
    ? '<tr><td colspan="6" class="empty-cell">No conversations yet — share your link with recruiters!</td></tr>'
    : conversations
        .sort((a, b) => (b.lastContact || '').localeCompare(a.lastContact || ''))
        .map(c => {
          const rid  = escHtml(c.recruiterId);
          const ecid = escHtml(cid);
          return `<tr>
          <td>${escHtml(c.companyName || '—')}</td>
          <td>${fmtDate(c.firstContact)}</td>
          <td>${fmtDate(c.lastContact)}</td>
          <td>${c.messageCount || 0}</td>
          <td>${statusBadge(c.offerStatus)}</td>
          <td><button class="btn-sm" onclick="viewTranscript('${ecid}','${rid}')">Transcript</button></td>
        </tr>`;
        }).join('\n');

  // ── Offer cards ────────────────────────────────────────────────────────────
  const offerCards = offers.length === 0
    ? '<p class="empty-msg">No offers flagged yet. When recruiters mention compensation, they will appear here.</p>'
    : offers.map(o => {
        const rid = escHtml(o.recruiterId);
        const ecid = escHtml(cid);
        return `<div class="offer-card">
          <div class="offer-company">${escHtml(o.companyName || 'Unknown Company')}</div>
          <div class="offer-row"><span>Status</span>${statusBadge(o.offerStatus)}</div>
          <div class="offer-row"><span>Your target</span><strong>${targetSal}</strong></div>
          <div class="offer-row"><span>Last contact</span><span>${fmtDate(o.lastContact)}</span></div>
          <button class="btn-sm" style="margin-top:10px;width:100%" onclick="viewTranscript('${ecid}','${rid}')">View Transcript</button>
        </div>`;
      }).join('\n');

  // ── Inline JS (safe: all values go through JSON.stringify) ─────────────────
  const jsData = `
  const CANDIDATE_ID   = ${JSON.stringify(cid)};
  const SHAREABLE_URL  = ${JSON.stringify(shareUrl)};
  const DASHBOARD_PW   = ${JSON.stringify(password)};

  function copyUrl() {
    navigator.clipboard.writeText(SHAREABLE_URL).catch(function() {
      var ta = document.createElement('textarea');
      ta.value = SHAREABLE_URL;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }).then(function() {
      var btn = document.getElementById('copy-btn');
      var orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(function() { btn.textContent = orig; }, 1800);
    });
  }

  function escText(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  async function viewTranscript(candidateId, recruiterId) {
    var overlay = document.getElementById('tx-overlay');
    var body    = document.getElementById('tx-body');
    var title   = document.getElementById('tx-title');
    title.textContent = recruiterId;
    body.innerHTML = '<p class="tx-loading">Loading…</p>';
    overlay.classList.add('open');
    try {
      var res = await fetch('/api/chat/' + candidateId + '/' + recruiterId);
      var data = await res.json();
      var msgs = data.messages || [];
      if (msgs.length === 0) { body.innerHTML = '<p class="tx-loading">No messages in this conversation.</p>'; return; }
      title.textContent = data.recruiterId || recruiterId;
      body.innerHTML = msgs.map(function(m) {
        var role = m.role === 'agent' ? 'agent' : 'recruiter';
        var ts   = m.timestamp ? new Date(m.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
        return '<div class="tx-msg tx-msg--' + role + '"><div class="tx-bubble">' + escText(m.content) + '</div>'
          + (ts ? '<div class="tx-ts">' + ts + '</div>' : '') + '</div>';
      }).join('');
      body.scrollTop = body.scrollHeight;
    } catch(e) {
      body.innerHTML = '<p class="tx-loading" style="color:#dc2626">Failed to load transcript.</p>';
    }
  }

  function closeTranscript() { document.getElementById('tx-overlay').classList.remove('open'); }

  document.getElementById('tx-overlay').addEventListener('click', function(e) {
    if (e.target === this) closeTranscript();
  });

  function logout() {
    localStorage.removeItem('dash_pw_' + CANDIDATE_ID);
    localStorage.removeItem('dash_pw');
    localStorage.removeItem('dash_cid');
    window.location.href = '/dashboard/' + CANDIDATE_ID;
  }
`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Career Dashboard — ${escHtml(profile.name || 'Candidate')}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;background:#f0f2f5;color:#1a1a1a;line-height:1.5}

    /* ── Nav ── */
    nav{background:#0f766e;color:#fff;padding:14px 28px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50}
    nav .brand{font-size:1.05rem;font-weight:700;letter-spacing:.01em}
    nav .new-dash{font-size:.82rem;color:rgba(255,255,255,.75);text-decoration:none;margin-right:16px}
    nav .new-dash:hover{color:#fff}
    nav .logout{background:rgba(255,255,255,.15);border:none;color:#fff;padding:7px 16px;border-radius:20px;cursor:pointer;font-size:.85rem;font-weight:500;transition:background .15s}
    nav .logout:hover{background:rgba(255,255,255,.25)}

    /* ── Layout ── */
    .container{max-width:1000px;margin:0 auto;padding:28px 16px 60px;display:flex;flex-direction:column;gap:20px}

    /* ── Card ── */
    .card{background:#fff;border-radius:14px;box-shadow:0 1px 5px rgba(0,0,0,.08);padding:24px 28px}
    .section-title{font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#0d9488;margin-bottom:16px}

    /* ── Profile ── */
    .profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 28px;font-size:.92rem;margin-bottom:16px}
    .pf-label{font-size:.75rem;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px}
    .pf-val{color:#111}
    .url-row{display:flex;align-items:center;gap:10px;background:#f9fafb;border:1.5px solid #e5e7eb;border-radius:8px;padding:10px 14px;margin-top:14px}
    .url-row span{flex:1;font-size:.83rem;color:#0f766e;word-break:break-all;font-weight:500}
    .btn-copy{padding:7px 16px;background:#0d9488;color:#fff;border:none;border-radius:20px;font-size:.82rem;cursor:pointer;font-weight:500;white-space:nowrap;transition:opacity .15s}
    .btn-copy:hover{opacity:.88}

    /* ── Availability badge ── */
    .avail-badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:.78rem;font-weight:500}
    .avail--open{background:#dcfce7;color:#15803d}
    .avail--interviewing{background:#dbeafe;color:#1d4ed8}
    .avail--closed{background:#f3f4f6;color:#6b7280}

    /* ── Analytics ── */
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px}
    .stat-card{background:#f8fafc;border-radius:10px;padding:18px;text-align:center}
    .stat-val{font-size:1.8rem;font-weight:700;color:#0d9488;line-height:1}
    .stat-val.sm{font-size:1.1rem}
    .stat-lbl{font-size:.78rem;color:#6b7280;margin-top:6px}

    /* ── Table ── */
    .table-wrap{overflow-x:auto;margin-top:4px}
    table{width:100%;border-collapse:collapse;font-size:.9rem;min-width:560px}
    th{text-align:left;padding:8px 12px;border-bottom:2px solid #f0f0f0;color:#9ca3af;font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
    td{padding:11px 12px;border-bottom:1px solid #f5f5f5;vertical-align:middle}
    tr:last-child td{border-bottom:none}
    tr:hover td{background:#fafafa}
    .empty-cell{text-align:center;color:#9ca3af;padding:32px;font-size:.9rem}

    /* ── Badges ── */
    .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.76rem;font-weight:500;text-transform:capitalize}
    .badge--active,.badge--mentioned{background:#dcfce7;color:#15803d}
    .badge--offered{background:#dbeafe;color:#1d4ed8}
    .badge--negotiating{background:#fef9c3;color:#854d0e}
    .badge--accepted{background:#d1fae5;color:#065f46}
    .badge--declined{background:#fee2e2;color:#991b1b}
    .btn-sm{padding:5px 14px;border-radius:20px;border:1.5px solid #e5e7eb;background:#fff;font-size:.8rem;cursor:pointer;font-weight:500;color:#374151;white-space:nowrap;transition:border-color .15s,background .15s}
    .btn-sm:hover{border-color:#0d9488;background:#f0fdfa;color:#0d9488}

    /* ── Offers ── */
    .offer-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-top:4px}
    .offer-card{border:1.5px solid #e5e7eb;border-radius:10px;padding:18px}
    .offer-company{font-weight:700;font-size:1rem;margin-bottom:12px;color:#111}
    .offer-row{display:flex;justify-content:space-between;align-items:center;font-size:.87rem;padding:5px 0;border-bottom:1px solid #f5f5f5}
    .offer-row:last-of-type{border-bottom:none}
    .offer-row span:first-child{color:#9ca3af}
    .empty-msg{color:#9ca3af;font-size:.9rem;padding:12px 0}

    /* ── Transcript modal ── */
    #tx-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;align-items:center;justify-content:center;padding:16px}
    #tx-overlay.open{display:flex}
    #tx-modal{background:#fff;border-radius:16px;width:100%;max-width:620px;max-height:82vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.18)}
    #tx-header{padding:16px 20px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;justify-content:space-between}
    #tx-header strong{font-size:1rem}
    #tx-title{font-size:.82rem;color:#9ca3af;font-weight:400;margin-top:2px}
    #tx-body{overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:10px;flex:1;background:#f9fafb}
    .tx-msg{display:flex;flex-direction:column;max-width:80%}
    .tx-msg--agent{align-self:flex-start}
    .tx-msg--recruiter{align-self:flex-end}
    .tx-bubble{padding:9px 14px;border-radius:16px;font-size:.9rem;line-height:1.5;word-break:break-word}
    .tx-msg--agent .tx-bubble{background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.07)}
    .tx-msg--recruiter .tx-bubble{background:#0d9488;color:#fff}
    .tx-ts{font-size:.7rem;opacity:.5;margin-top:3px}
    .tx-msg--recruiter .tx-ts{text-align:right}
    .tx-loading{text-align:center;color:#9ca3af;padding:24px;font-size:.9rem}
    #tx-close{background:none;border:none;font-size:1.3rem;cursor:pointer;color:#9ca3af;padding:4px;line-height:1;transition:color .15s}
    #tx-close:hover{color:#374151}

    /* ── Responsive ── */
    @media(max-width:600px){
      .profile-grid{grid-template-columns:1fr}
      nav{padding:12px 16px}
    }
  </style>
</head>
<body>

<nav>
  <span class="brand">🎯 Career Dashboard</span>
  <div style="display:flex;align-items:center">
    <a class="new-dash" href="/dashboard/${escHtml(cid)}">New Dashboard →</a>
    <button class="logout" onclick="logout()">Logout</button>
  </div>
</nav>

<div class="container">

  <!-- ══ PROFILE ══ -->
  <section class="card">
    <p class="section-title">Your Profile</p>
    <div class="profile-grid">
      <div><p class="pf-label">Name</p><p class="pf-val">${escHtml(profile.name || '—')}</p></div>
      <div><p class="pf-label">Email</p><p class="pf-val">${escHtml(profile.email || '—')}</p></div>
      <div><p class="pf-label">Location</p><p class="pf-val">${escHtml(profile.location || '—')}</p></div>
      <div><p class="pf-label">Availability</p><p class="pf-val">${availBadge(profile.availability)}</p></div>
      <div><p class="pf-label">Target Roles</p><p class="pf-val">${roles}</p></div>
      <div><p class="pf-label">Target Salary</p><p class="pf-val">${targetSal}</p></div>
      <div style="grid-column:1/-1"><p class="pf-label">Non-Negotiables</p><p class="pf-val">${nonneg}</p></div>
    </div>
    <div class="url-row">
      <span>${escHtml(shareUrl)}</span>
      <button class="btn-copy" id="copy-btn" onclick="copyUrl()">Copy Link</button>
    </div>
  </section>

  <!-- ══ ANALYTICS ══ -->
  <section class="card">
    <p class="section-title">Analytics</p>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-val">${analytics.total}</div>
        <div class="stat-lbl">Recruiter Visits</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${analytics.offerCount}</div>
        <div class="stat-lbl">Offers Received</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${analytics.convRate}%</div>
        <div class="stat-lbl">Conversion Rate</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${analytics.avgMsgs}</div>
        <div class="stat-lbl">Avg Messages / Conv.</div>
      </div>
      <div class="stat-card">
        <div class="stat-val sm">${escHtml(analytics.topCompanies)}</div>
        <div class="stat-lbl">Top Companies</div>
      </div>
      <div class="stat-card">
        <div class="stat-val sm">${escHtml((profile.targetRoles || [])[0] || '—')}</div>
        <div class="stat-lbl">Primary Target Role</div>
      </div>
    </div>
  </section>

  <!-- ══ CONVERSATIONS ══ -->
  <section class="card">
    <p class="section-title">Recruiter Conversations</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>First Contact</th>
            <th>Last Contact</th>
            <th>Messages</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>${convRows}</tbody>
      </table>
    </div>
  </section>

  <!-- ══ OFFERS ══ -->
  <section class="card">
    <p class="section-title">Offers</p>
    <div class="offer-grid">${offerCards}</div>
  </section>

</div>

<!-- ══ TRANSCRIPT MODAL ══ -->
<div id="tx-overlay">
  <div id="tx-modal">
    <div id="tx-header">
      <div>
        <strong>Conversation Transcript</strong>
        <div id="tx-title"></div>
      </div>
      <button id="tx-close" onclick="closeTranscript()" aria-label="Close">✕</button>
    </div>
    <div id="tx-body"></div>
  </div>
</div>

<script>${jsData}</script>
</body>
</html>`;
}

module.exports = router;
