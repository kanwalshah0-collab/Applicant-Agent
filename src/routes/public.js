'use strict';

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const storage = require('../utils/candidate-storage');

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateRecruiterId() {
  return 'r_' + crypto.randomBytes(6).toString('hex');
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSalary(salary) {
  if (!salary) return null;
  const fmt = n => (n ? `$${Math.round(n / 1000)}k` : null);
  const min  = fmt(salary.min);
  const max  = fmt(salary.max);
  if (min && max) return `${min}–${max}`;
  if (min) return `${min}+`;
  if (max) return `Up to ${max}`;
  return null;
}

function candidateHeadline(profile) {
  if (profile.strengths && profile.strengths.length > 0) return profile.strengths[0];
  if (profile.targetRoles && profile.targetRoles.length > 0) {
    return `${profile.seniority || 'Experienced'} ${profile.targetRoles[0]}`;
  }
  return 'Experienced Professional';
}

// ── Page builder ──────────────────────────────────────────────────────────────

function buildPage(profile, recruiterId) {
  const name      = profile.name || 'Candidate';
  const firstName = name.split(' ')[0];
  const headline  = candidateHeadline(profile);
  const salary    = formatSalary(profile.targetSalary);
  const roles     = (profile.targetRoles    || []).slice(0, 4);
  const nonneg    = (profile.nonNegotiables || []).slice(0, 6);
  const strengths = (profile.strengths      || []).slice(0, 3);
  const shareUrl  = profile.shareableUrl || '';

  // -- Meta badges (location + salary) --
  const metaBadges = [
    profile.location && `<span class="meta-badge">📍 ${escHtml(profile.location)}</span>`,
    salary           && `<span class="meta-badge">💰 ${escHtml(salary)}</span>`,
    profile.seniority && `<span class="meta-badge">🏅 ${escHtml(profile.seniority)}</span>`,
  ].filter(Boolean).join('\n          ');

  // -- Role pills (reuses .pill from styles.css) --
  const rolePills = roles.length > 0
    ? roles.map(r => `<span class="pill">${escHtml(r)}</span>`).join('\n          ')
    : '';

  // -- Achievement bullets --
  const achieveItems = strengths.length > 0
    ? strengths.map(s => `          <li>${escHtml(s)}</li>`).join('\n')
    : '          <li>Strong track record across multiple roles and projects</li>';

  // -- Non-negotiables as pills --
  const nonnegBlock = nonneg.length > 0
    ? `
        <div class="nn-section">
          <p class="nn-label">Non-Negotiables</p>
          <div class="nn-pills">
            ${nonneg.map(n => `<span class="pill pill--nn">✓ ${escHtml(n)}</span>`).join('\n            ')}
          </div>
        </div>`
    : '';

  // -- Initial greeting (injected safely via JSON.stringify) --
  const greeting = `Hi! I'm ${name}'s AI representative. I'm here to help you understand why they'd be an excellent fit for your team, and to discuss opportunities that align with their goals. What role are you hiring for?`;

  // Values injected into JS context — JSON.stringify handles quotes, newlines, etc.
  const jsData = [
    `const CANDIDATE_ID = ${JSON.stringify(profile.candidateId)};`,
    `const RECRUITER_ID_FALLBACK = ${JSON.stringify(recruiterId)};`,
    `const INITIAL_GREETING = ${JSON.stringify(greeting)};`,
  ].join('\n    ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escHtml(name)} — Meet My AI Representative</title>
  <link rel="stylesheet" href="/styles.css"/>
  <style>
    /* ── Page overrides ── */
    body  { background: #f0f2f5; }
    .container { max-width: 780px; padding-top: 32px; }

    /* ── Candidate header ── */
    .cand-header { margin-bottom: 0; }
    .cand-header h1 { font-size: 1.9rem; font-weight: 700; color: var(--gray-900); margin-bottom: 4px; }
    .cand-headline   { font-size: 1rem; color: var(--gray-500); margin-bottom: 14px; line-height: 1.5; }

    .meta-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .meta-badge {
      background: var(--gray-100);
      color: var(--gray-700);
      border-radius: 20px;
      padding: 4px 12px;
      font-size: .82rem;
      border: 1px solid var(--gray-200);
    }

    .role-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 18px; }

    /* Overrides for .url-row inside header */
    .cand-url-row { margin-bottom: 0; }
    .cand-url-row span { font-size: .8rem; }

    /* ── Non-negotiables ── */
    .nn-section { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--gray-100); }
    .nn-label { font-size: .75rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--gray-400); margin-bottom: 8px; }
    .nn-pills { display: flex; flex-wrap: wrap; gap: 6px; }
    .pill--nn {
      background: var(--green-50);
      color: var(--green-600);
      border: 1px solid #bbf7d0;
    }

    /* ── About section ── */
    .about-title {
      font-size: .78rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .06em;
      color: var(--teal-600);
      margin-bottom: 12px;
    }
    .achieve-list { padding-left: 18px; margin-bottom: 14px; }
    .achieve-list li { color: var(--gray-700); font-size: .93rem; margin-bottom: 7px; line-height: 1.5; }
    .about-cta { font-size: .93rem; color: var(--teal-700); font-weight: 500; }

    /* ── Chat ── */
    .chat-card { padding: 0; overflow: hidden; }
    .chat-header {
      padding: 14px 22px;
      border-bottom: 1px solid var(--gray-100);
      font-size: .82rem;
      font-weight: 600;
      color: var(--gray-500);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .chat-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--green-600);
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }

    #chat-window {
      height: 420px;
      overflow-y: auto;
      padding: 20px 22px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: var(--gray-50);
    }

    .message {
      max-width: 78%;
      padding: 10px 15px;
      border-radius: 18px;
      font-size: .93rem;
      line-height: 1.5;
      word-break: break-word;
    }
    .message--agent {
      background: #fff;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,.07);
      color: var(--gray-900);
    }
    .message--recruiter {
      background: var(--teal-600);
      color: #fff;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .message--typing {
      color: var(--gray-400);
      font-style: italic;
      font-size: .85rem;
      align-self: flex-start;
    }

    .chat-input-row {
      display: flex;
      gap: 10px;
      padding: 14px 18px;
      border-top: 1px solid var(--gray-100);
      background: #fff;
    }
    #recruiterInput {
      flex: 1;
      padding: 10px 16px;
      border: 1.5px solid var(--gray-200);
      border-radius: 24px;
      font-size: .93rem;
      outline: none;
      transition: border-color .15s;
      background: #fff;
      color: var(--gray-900);
    }
    #recruiterInput:focus { border-color: var(--teal-500); }
    #recruiterInput::placeholder { color: var(--gray-400); }
    #sendBtn {
      padding: 10px 24px;
      background: var(--teal-600);
      color: #fff;
      border: none;
      border-radius: 24px;
      font-size: .93rem;
      cursor: pointer;
      font-weight: 500;
      transition: opacity .15s;
      white-space: nowrap;
    }
    #sendBtn:hover:not(:disabled) { opacity: .88; }
    #sendBtn:disabled { opacity: .45; cursor: not-allowed; }

    /* ── Responsive ── */
    @media (max-width: 600px) {
      .cand-header h1 { font-size: 1.5rem; }
      #chat-window { height: 340px; }
      .message { max-width: 90%; }
    }

    /* ── Print ── */
    @media print {
      .chat-input-row, #sendBtn { display: none; }
      #chat-window { height: auto; overflow: visible; }
    }
  </style>
</head>
<body>
<div class="container">

  <!-- ═══ CANDIDATE HEADER ═══ -->
  <div class="card cand-header">
    <h1>${escHtml(name)}</h1>
    <p class="cand-headline">${escHtml(headline)}</p>

    <div class="meta-row">
      ${metaBadges}
    </div>

    ${rolePills ? `<div class="role-pills">\n          ${rolePills}\n        </div>` : ''}

    ${shareUrl ? `
    <div class="url-row cand-url-row" title="Share this link with the candidate's network">
      <span>${escHtml(shareUrl)}</span>
      <button class="button-primary" onclick="copyUrl()" aria-label="Copy candidate URL">Copy Link</button>
    </div>` : ''}
  </div>

  <!-- ═══ KEY HIGHLIGHTS ═══ -->
  <section class="card">
    <p class="about-title">Key Highlights</p>
    <ul class="achieve-list">
${achieveItems}
    </ul>
    ${nonnegBlock}
    <p class="about-cta" style="margin-top:${nonneg.length ? '16' : '0'}px">
      💬 Interested? Chat with ${escHtml(firstName)}'s AI representative below.
    </p>
  </section>

  <!-- ═══ CHAT ═══ -->
  <section class="card chat-card">
    <div class="chat-header">
      <div class="chat-dot"></div>
      ${escHtml(firstName)}'s AI Representative — online now
    </div>
    <div id="chat-window" role="log" aria-live="polite" aria-label="Conversation"></div>
    <div class="chat-input-row">
      <input
        id="recruiterInput"
        type="text"
        placeholder="Tell me about the role…"
        autocomplete="off"
        aria-label="Your message"
        onkeydown="if(event.key==='Enter') sendMessage()"
      />
      <button id="sendBtn" onclick="sendMessage()">Send</button>
    </div>
  </section>

</div>

<script>
  ${jsData}
</script>
<script src="/applicant-chat.js"></script>
</body>
</html>`;
}

// ── GET /candidate/:candidateId/data — public JSON profile ───────────────────
// Used by the static applicant.html SPA to fetch candidate info client-side.
// Never returns email, resume text, or any other private field.

router.get('/:candidateId/data', async (req, res) => {
  const { candidateId } = req.params;
  try {
    const profile = await storage.getProfile(candidateId);
    return res.json({
      candidateId:    profile.candidateId,
      name:           profile.name             || '',
      headline:       candidateHeadline(profile),
      location:       profile.location         || '',
      seniority:      profile.seniority        || 'Experienced',
      targetRoles:    profile.targetRoles      || [],
      targetSalary:   profile.targetSalary     || { min: null, max: null },
      nonNegotiables: profile.nonNegotiables   || [],
      strengths:      (profile.strengths || []).slice(0, 3),
      shareableUrl:   profile.shareableUrl     || '',
    });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    console.error('[public] GET /:candidateId/data error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /candidate/:candidateId ───────────────────────────────────────────────

router.get('/:candidateId', async (req, res) => {
  const { candidateId } = req.params;

  let profile;
  try {
    profile = await storage.getProfile(candidateId);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Not Found — Applicant Agent</title>
  <link rel="stylesheet" href="/styles.css"/>
</head>
<body>
<div class="container" style="text-align:center;padding-top:80px">
  <div class="card" style="max-width:420px;margin:0 auto">
    <div style="font-size:3rem;margin-bottom:12px">🔍</div>
    <h1 style="font-size:1.4rem;margin-bottom:8px">Candidate Not Found</h1>
    <p style="color:var(--gray-500);margin-bottom:24px">This link may be invalid or the profile may have been removed.</p>
    <a class="button-primary" href="/" style="text-decoration:none">Go Home</a>
  </div>
</div>
</body>
</html>`);
    }
    console.error('[public] getProfile error:', err);
    return res.status(500).send('Internal server error');
  }

  // Server-side recruiter ID is a fallback — the client overwrites it with
  // the value stored in localStorage so returning recruiters keep their thread.
  const recruiterId = generateRecruiterId();

  console.log(
    `[public] visit → candidate=${candidateId} rid=${recruiterId} ip=${req.ip}`
  );

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(buildPage(profile, recruiterId));
});

module.exports = router;
