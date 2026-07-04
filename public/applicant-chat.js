'use strict';

// Globals injected by the server template (public.js → buildPage):
//   CANDIDATE_ID          — string, e.g. "abc123"
//   RECRUITER_ID_FALLBACK — server-generated ID, used only when localStorage is empty
//   INITIAL_GREETING      — first agent message to render on a fresh session

// ── Recruiter identity ────────────────────────────────────────────────────────
// Each recruiter gets a stable ID per candidate stored in localStorage so that
// returning to the same link resumes their existing conversation thread.

const RID_KEY     = 'rid_' + CANDIDATE_ID;
const recruiterId = (() => {
  const stored = localStorage.getItem(RID_KEY);
  if (stored) return stored;
  localStorage.setItem(RID_KEY, RECRUITER_ID_FALLBACK);
  return RECRUITER_ID_FALLBACK;
})();

const HISTORY_KEY = `chat_${CANDIDATE_ID}_${recruiterId}`;

// ── State ─────────────────────────────────────────────────────────────────────

let conversationHistory = []; // array of { role, content, timestamp }
let isSending           = false;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const chatWindow     = document.getElementById('chat-window');
const recruiterInput = document.getElementById('recruiterInput');
const sendBtn        = document.getElementById('sendBtn');

// ── Keyboard handling ─────────────────────────────────────────────────────────
// Replace the inline onkeydown so Shift+Enter is a no-op and plain Enter sends.

recruiterInput.onkeydown = null;
recruiterInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  const saved = loadHistory();

  if (saved && saved.length > 0) {
    conversationHistory = saved;
    conversationHistory.forEach(msg => renderMessage(msg.role, msg.content, msg.timestamp, false));
  } else {
    // Fresh session: display greeting and seed it into history so the LLM
    // has context when the recruiter sends their first message.
    const ts      = new Date().toISOString();
    const greeting = { role: 'agent', content: INITIAL_GREETING, timestamp: ts };
    conversationHistory = [greeting];
    renderMessage('agent', INITIAL_GREETING, ts, false);
    saveHistory();
  }

  scrollToBottom();
  recruiterInput.focus();
}

// ── Send message ──────────────────────────────────────────────────────────────

async function sendMessage() {
  if (isSending) return;

  const text = recruiterInput.value.trim();
  if (!text) return;

  isSending = true;
  recruiterInput.value = '';
  setInputEnabled(false);

  const ts = new Date().toISOString();
  renderMessage('recruiter', text, ts, true);
  conversationHistory.push({ role: 'recruiter', content: text, timestamp: ts });
  saveHistory();

  const typingEl = showTyping();

  try {
    const res = await fetch(`/api/chat/${CANDIDATE_ID}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recruiterId,
        message: text,
        conversationHistory,
        companyName: null,
      }),
    });

    typingEl.remove();

    if (res.status === 404) {
      // Candidate no longer exists
      window.location.href = '/';
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg  = res.status === 503
        ? 'Our AI is temporarily unavailable. Try again?'
        : 'Error: ' + (body.error || `HTTP ${res.status}`);
      showError(msg, text);
      return;
    }

    const data    = await res.json();
    const agentTs = new Date().toISOString();
    renderMessage('agent', data.response, agentTs, true);
    conversationHistory.push({ role: 'agent', content: data.response, timestamp: agentTs });
    saveHistory();

  } catch (err) {
    typingEl.remove();
    console.error('[applicant-chat] fetch error:', err);
    showError('Connection error. Check your internet.', text);
  } finally {
    isSending = false;
    setInputEnabled(true);
    recruiterInput.focus();
  }
}

// ── Message rendering ─────────────────────────────────────────────────────────

function formatContent(container, text) {
  const lines = text.split('\n');
  let ul = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { ul = null; continue; }
    if (/^[•\-\*]\s/.test(line.trim())) {
      if (!ul) { ul = document.createElement('ul'); container.appendChild(ul); }
      const li = document.createElement('li');
      li.textContent = line.trim().replace(/^[•\-\*]\s*/, '');
      ul.appendChild(li);
    } else {
      ul = null;
      const p = document.createElement('p');
      p.textContent = line;
      container.appendChild(p);
    }
  }
  if (!container.firstChild) {
    const p = document.createElement('p');
    p.textContent = text;
    container.appendChild(p);
  }
}

function renderMessage(role, content, timestamp, animate) {
  const wrap = document.createElement('div');
  wrap.className = `message message--${role}`;

  const body = document.createElement('div');
  body.className = 'msg-body';
  if (role === 'agent') {
    formatContent(body, content);
  } else {
    const p = document.createElement('p');
    p.textContent = content;
    body.appendChild(p);
  }
  wrap.appendChild(body);

  if (timestamp) {
    const tsEl = document.createElement('div');
    tsEl.textContent = formatTime(timestamp);
    tsEl.style.cssText = 'font-size:.7rem;opacity:.5;margin-top:4px;';
    wrap.appendChild(tsEl);
  }

  if (animate) {
    wrap.style.cssText += 'opacity:0;transform:translateY(6px);transition:opacity .18s,transform .18s;';
  }

  chatWindow.appendChild(wrap);
  scrollToBottom();

  if (animate) {
    requestAnimationFrame(() => {
      wrap.style.opacity  = '1';
      wrap.style.transform = 'translateY(0)';
    });
  }

  return wrap;
}

function showTyping() {
  const el = document.createElement('div');
  el.className = 'message message--typing';
  el.textContent = 'AI Representative is typing…';
  chatWindow.appendChild(el);
  scrollToBottom();
  return el;
}

function showError(msg, retryText) {
  const wrap = document.createElement('div');
  wrap.className  = 'message message--typing';
  wrap.style.color = '#dc2626';
  wrap.style.fontStyle = 'normal';

  const label = document.createElement('span');
  label.textContent = msg + ' ';

  const retryBtn = document.createElement('button');
  retryBtn.textContent = 'Retry';
  retryBtn.style.cssText =
    'background:none;border:none;color:#1a73e8;cursor:pointer;font-size:inherit;padding:0;text-decoration:underline;';
  retryBtn.addEventListener('click', () => {
    wrap.remove();
    recruiterInput.value = retryText;
    recruiterInput.focus();
  });

  wrap.appendChild(label);
  wrap.appendChild(retryBtn);
  chatWindow.appendChild(wrap);
  scrollToBottom();
}

// ── Utility ───────────────────────────────────────────────────────────────────

function setInputEnabled(on) {
  recruiterInput.disabled = !on;
  sendBtn.disabled        = !on;
}

function scrollToBottom() {
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(conversationHistory));
  } catch {
    // localStorage quota exceeded — non-fatal, history just won't persist across reloads
  }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ── Copy URL helper ───────────────────────────────────────────────────────────
// Exposed globally so any "Share" button in the page can call copyUrl().

function copyUrl() {
  const url = window.location.href;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).catch(() => fallbackCopy(url));
  } else {
    fallbackCopy(url);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

// ── Quick tags ────────────────────────────────────────────────────────────────

function sendQuickTag(question) {
  if (isSending) return;
  recruiterInput.value = question;
  sendMessage();
}

// ── Boot ──────────────────────────────────────────────────────────────────────

init();
