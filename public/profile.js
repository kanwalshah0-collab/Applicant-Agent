'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

// ── State ─────────────────────────────────────────────────────────────────────

let selectedFile = null;

// ── Page setup ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const dropZone  = document.getElementById('dropZone');

  // File input change
  fileInput.addEventListener('change', e => {
    if (e.target.files[0]) handleFileSelect(e.target.files[0]);
  });

  // Drag-and-drop
  dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('over');
    if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]);
  });

  // Checkbox highlight sync
  document.querySelectorAll('.nn-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.closest('.check-item').classList.toggle('checked', cb.checked);
    });
  });

  // Clear field error on input so user gets immediate feedback
  ['name', 'email', 'location', 'roles', 'salaryMin', 'salaryMax'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => clearFieldError('err-' + (id.startsWith('salary') ? 'salary' : id)));
  });
});

// ── File handling ─────────────────────────────────────────────────────────────

function handleFileSelect(file) {
  if (!ALLOWED_TYPES.has(file.type) && !/\.(pdf|docx?)$/i.test(file.name)) {
    showFieldError('err-resume', 'Please upload a PDF or DOCX file.');
    return;
  }
  if (file.size > MAX_SIZE) {
    showFieldError('err-resume', 'File is too large (max 10MB).');
    return;
  }
  clearFieldError('err-resume');
  selectedFile = file;
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('dropZone').classList.add('has-file');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function formatCurrency(num) {
  return '$' + Number(num).toLocaleString('en-US');
}

function formatTargetRoles(input) {
  return input.split(',').map(r => r.trim()).filter(Boolean);
}

function generateShareMessage(targetRoles, shareableUrl) {
  const role = targetRoles[0] || 'new opportunities';
  return `I'm actively exploring ${role} opportunities.\n\nMeet my AI representative and let's start a conversation:\n${shareableUrl}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Validation helpers ────────────────────────────────────────────────────────

function showFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
}

function clearFieldError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = '';
  el.classList.remove('visible');
}

function clearAllErrors() {
  document.querySelectorAll('.form-error').forEach(el => {
    el.textContent = '';
    el.classList.remove('visible');
  });
  const ge = document.getElementById('globalError');
  if (ge) { ge.textContent = ''; ge.classList.remove('visible'); }
}

function showGlobalError(msg) {
  const ge = document.getElementById('globalError');
  if (!ge) return;
  ge.textContent = msg;
  ge.classList.add('visible');
  ge.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Clipboard helper ──────────────────────────────────────────────────────────

function copyToClipboard(text, btn, originalLabel) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = originalLabel; }, 1800);
  }).catch(() => {
    // Fallback for browsers that block clipboard without HTTPS
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = originalLabel; }, 1800);
  });
}

// ── Loading state ─────────────────────────────────────────────────────────────

function setLoading(on) {
  const btn     = document.getElementById('submitBtn');
  const spinner = document.getElementById('spinner');
  btn.disabled  = on;
  btn.classList.toggle('loading', on);
  if (spinner) spinner.style.display = on ? 'block' : 'none';
}

// ── Submit ────────────────────────────────────────────────────────────────────

async function submitProfile() {
  clearAllErrors();
  let valid = true;

  // Name
  const name = document.getElementById('name').value.trim();
  if (!name) {
    showFieldError('err-name', 'Name is required.');
    valid = false;
  }

  // Email
  const email = document.getElementById('email').value.trim();
  if (!email) {
    showFieldError('err-email', 'Email is required and must be valid.');
    valid = false;
  } else if (!validateEmail(email)) {
    showFieldError('err-email', 'Email is required and must be valid.');
    valid = false;
  }

  // Location
  const location = document.getElementById('location').value.trim();
  if (!location) {
    showFieldError('err-location', 'Location is required.');
    valid = false;
  }

  // Resume
  if (!selectedFile) {
    showFieldError('err-resume', 'Resume is required (PDF or DOCX).');
    valid = false;
  }

  // Target roles
  const rolesRaw   = document.getElementById('roles').value.trim();
  const targetRoles = formatTargetRoles(rolesRaw);
  if (targetRoles.length === 0) {
    showFieldError('err-roles', 'At least one target role is required.');
    valid = false;
  }

  // Salary — numeric check first, then range check
  const salaryMinRaw = document.getElementById('salaryMin').value;
  const salaryMaxRaw = document.getElementById('salaryMax').value;
  let salaryMin = null;
  let salaryMax = null;
  let salaryOk  = true;

  if (salaryMinRaw !== '' && isNaN(Number(salaryMinRaw))) {
    showFieldError('err-salary', 'Salary range must be numeric.');
    valid = false; salaryOk = false;
  }
  if (salaryOk && salaryMaxRaw !== '' && isNaN(Number(salaryMaxRaw))) {
    showFieldError('err-salary', 'Salary range must be numeric.');
    valid = false; salaryOk = false;
  }
  if (salaryOk) {
    salaryMin = salaryMinRaw !== '' ? parseInt(salaryMinRaw, 10) : null;
    salaryMax = salaryMaxRaw !== '' ? parseInt(salaryMaxRaw, 10) : null;
    if (salaryMin !== null && salaryMax !== null && salaryMin >= salaryMax) {
      showFieldError('err-salary', 'Min salary must be less than max salary.');
      valid = false;
    }
  }

  // Non-negotiables
  const nonNegotiables = [];
  document.querySelectorAll('.nn-checkbox:checked').forEach(cb => nonNegotiables.push(cb.dataset.label));
  const customNn = document.getElementById('customNn').value.trim();
  if (customNn) nonNegotiables.push(customNn);
  if (nonNegotiables.length === 0) {
    showFieldError('err-nonneg', 'Select at least one non-negotiable.');
    valid = false;
  }

  if (!valid) {
    // Scroll to first visible error
    const firstErr = document.querySelector('.form-error.visible');
    if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const formData = new FormData();
  formData.append('name',             name);
  formData.append('email',            email);
  formData.append('location',         location);
  formData.append('targetRoles',      JSON.stringify(targetRoles));
  formData.append('nonNegotiables',   JSON.stringify(nonNegotiables));
  formData.append('targetSalary',     JSON.stringify({ min: salaryMin, max: salaryMax }));
  formData.append('resume',           selectedFile);

  setLoading(true);

  try {
    const res  = await fetch('/api/profile/create-profile', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      showGlobalError('Error creating profile: ' + (data.error || `HTTP ${res.status}`));
      return;
    }

    showSuccess(data, name, email, location, targetRoles, salaryMin, salaryMax);
  } catch (err) {
    showGlobalError('Error creating profile: Could not reach the server. Check your connection and try again.');
  } finally {
    setLoading(false);
  }
}

// ── Success screen ────────────────────────────────────────────────────────────

function showSuccess(data, name, email, location, targetRoles, salaryMin, salaryMax) {
  document.getElementById('form-section').style.display = 'none';

  const result = document.getElementById('result');
  result.classList.add('visible');

  const url = data.shareableUrl;
  document.getElementById('shareableUrl').textContent    = url;
  document.getElementById('candidateIdDisplay').textContent = data.candidateId;

  // LinkedIn share
  const post = generateShareMessage(targetRoles, url);
  document.getElementById('linkedInText').value = post;
  document.getElementById('linkedInBtn').href   =
    'https://www.linkedin.com/feed/?shareActive=true&text=' + encodeURIComponent(post);

  // Profile preview
  document.getElementById('previewName').textContent = name;

  const salaryStr = salaryMin && salaryMax
    ? `${formatCurrency(salaryMin)} – ${formatCurrency(salaryMax)}`
    : salaryMin ? formatCurrency(salaryMin) + '+'
    : '';

  document.getElementById('previewMeta').textContent =
    [location, salaryStr].filter(Boolean).join(' · ');

  const pillsEl = document.getElementById('previewPills');
  pillsEl.innerHTML = targetRoles.slice(0, 4)
    .map(r => `<span class="pill">${escHtml(r)}</span>`)
    .join('');

  // Persist candidate ID so "View Dashboard" works
  localStorage.setItem('dash_cid', data.candidateId);

  result.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Action handlers ───────────────────────────────────────────────────────────

function copyUrl() {
  const url = document.getElementById('shareableUrl').textContent;
  const btn = document.getElementById('copyBtn');
  copyToClipboard(url, btn, 'Copy');
}

function copyPost() {
  const text = document.getElementById('linkedInText').value;
  const btn  = document.getElementById('copyPostBtn');
  copyToClipboard(text, btn, 'Copy Post Text');
}

function goToDashboard() {
  const cid = document.getElementById('candidateIdDisplay').textContent;
  if (cid) window.location.href = `/dashboard/${cid}`;
}
