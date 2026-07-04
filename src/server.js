'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs').promises;

const profileRouter   = require('./routes/profile');
const chatRouter      = require('./routes/chat');
const publicRouter    = require('./routes/public');
const dashboardRouter = require('./routes/dashboard');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Railway (and most PaaS) terminate TLS at an edge proxy and forward plain HTTP
// internally, setting X-Forwarded-Proto. Trust that header so req.protocol reports
// "https" correctly — otherwise generated shareable links would say "http://".
app.set('trust proxy', 1);

// ── Multer ────────────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

const upload = multer({
  dest: path.join(__dirname, '../uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Resume must be a PDF or DOCX file'));
    }
  },
});

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── Health check (Railway) ───────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// ── Routes ────────────────────────────────────────────────────────────────────

// Profile API — multer runs only for the multipart create-profile POST
app.use('/api/profile', (req, res, next) => {
  if (req.method === 'POST' && req.path === '/create-profile') {
    return upload.single('resume')(req, res, err => {
      if (err) {
        // Multer validation errors (wrong file type, too large) → 400
        const status = err instanceof multer.MulterError ? 400
          : err.message.includes('PDF or DOCX') ? 400
          : 500;
        return res.status(status).json({ error: err.message });
      }
      next();
    });
  }
  next();
}, profileRouter);

// Chat API  — POST /api/chat/:candidateId, GET /api/chat/:cid/:rid
app.use('/api/chat', chatRouter);

// Public candidate page — GET /candidate/:candidateId serves the static SPA shell;
// GET /candidate/:candidateId/data (sub-path, not matched here) falls through to
// publicRouter which returns safe JSON profile data for the SPA to render.
app.get('/candidate/:candidateId', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/applicant.html'));
});
app.use('/candidate', publicRouter);

// Server-rendered dashboard (password-protected) — GET /api/dashboard/:candidateId
app.use('/api/dashboard', dashboardRouter);

// Client-side dashboard SPA — /dashboard/:candidateId loads the static shell.
// ?candidateId=X or ?id=X on the bare /dashboard path redirects to /dashboard/X.
app.get(['/dashboard', '/dashboard/'], (req, res) => {
  const id = req.query.candidateId || req.query.id;
  if (id && id.trim()) return res.redirect(302, `/dashboard/${id.trim()}`);
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

app.get('/dashboard/:candidateId', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

// Home page is served as a static file from public/index.html (via express.static above).

// ── Error handlers ────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Startup ───────────────────────────────────────────────────────────────────

async function ensureDirs() {
  const dirs = [
    path.join(__dirname, '../data'),
    path.join(__dirname, '../data/profiles'),
    path.join(__dirname, '../data/conversations'),
    path.join(__dirname, '../uploads'),
  ];
  await Promise.all(dirs.map(d => fs.mkdir(d, { recursive: true })));
}


async function start() {
  await ensureDirs();

  const server = app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\nApplicant Agent running on port ${PORT}`);
    console.log(`  Create profile : http://localhost:${PORT}/create-profile.html`);
    console.log(`  Candidate page : http://localhost:${PORT}/candidate/<id>`);
    console.log(`  Dashboard      : http://localhost:${PORT}/dashboard/<id>`);

    if (!process.env.CANDIDATE_PASSWORD) {
      console.warn('  ⚠  CANDIDATE_PASSWORD not set — dashboard access will be blocked');
    }

    console.log('');
  });

  function shutdown(signal) {
    console.log(`\n${signal} received — shutting down gracefully`);
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
    // Force-exit if graceful close takes too long
    setTimeout(() => process.exit(1), 8000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

process.on('uncaughtException', err => {
  console.error('[UNCAUGHT EXCEPTION]', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = app;
