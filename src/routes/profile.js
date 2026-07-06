'use strict';

const express      = require('express');
const fs           = require('fs').promises;
const path         = require('path');
const crypto       = require('crypto');
const multer       = require('multer');
const router       = express.Router();
const storage      = require('../utils/candidate-storage');
const resumeParser = require('../utils/resume-parser');

const VALID_WORK_ARRANGEMENTS = ['remote', 'onsite', 'hybrid'];
const PROFESSIONAL_SUMMARY_MAX_LENGTH = 200;

// ── Auth ──────────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const pw = process.env.CANDIDATE_PASSWORD;
  if (!pw || req.query.password !== pw) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// FormData sends everything as strings. Fields that were JSON.stringify'd by the
// client need to be parsed back before we can validate or store them.
function parseJsonField(value, fieldName) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return value; // already parsed (JSON body request)
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${fieldName} is not valid JSON`);
  }
}

// ── POST /api/profile/create-profile ─────────────────────────────────────────

router.post('/create-profile', async (req, res) => {
  try {
    const { name, email, location } = req.body;

    // -- required field checks --
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'email must be a valid address' });
    }
    if (!location || !location.trim()) {
      return res.status(400).json({ error: 'location is required' });
    }

    // -- JSON fields sent as strings from FormData --
    let targetRoles, targetSalary, nonNegotiables, workArrangement;
    try {
      targetRoles     = parseJsonField(req.body.targetRoles,     'targetRoles');
      targetSalary    = parseJsonField(req.body.targetSalary,    'targetSalary');
      nonNegotiables  = parseJsonField(req.body.nonNegotiables,  'nonNegotiables');
      workArrangement = parseJsonField(req.body.workArrangement, 'workArrangement') || [];
    } catch (parseErr) {
      return res.status(400).json({ error: parseErr.message });
    }

    if (!Array.isArray(targetRoles) || targetRoles.length === 0) {
      return res.status(400).json({ error: 'targetRoles must be a non-empty array' });
    }
    if (!Array.isArray(nonNegotiables) || nonNegotiables.length === 0) {
      return res.status(400).json({ error: 'nonNegotiables must be a non-empty array' });
    }

    // -- work arrangement (optional, multi-select) --
    if (!Array.isArray(workArrangement) || workArrangement.some(w => !VALID_WORK_ARRANGEMENTS.includes(w))) {
      return res.status(400).json({
        error: `workArrangement must be an array containing only: ${VALID_WORK_ARRANGEMENTS.join(', ')}`,
      });
    }

    // -- duplicate email check --
    const existing = await storage.findProfileByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'A profile with that email already exists' });
    }

    // -- resume parsing (optional — client always sends one but API is lenient) --
    let resumeText = '';
    let strengths  = [];
    let skills     = [];
    let seniority  = 'Mid';

    if (req.file) {
      const mime = req.file.mimetype;
      try {
        if (mime === 'application/pdf') {
          resumeText = await resumeParser.parsePDF(req.file.path);
        } else if (
          mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          mime === 'application/msword'
        ) {
          resumeText = await resumeParser.parseDOCX(req.file.path);
        } else {
          return res.status(400).json({ error: 'Resume must be a PDF or DOCX file' });
        }

        const extracted = resumeParser.extractCandidateStrengths(resumeText);
        strengths = extracted.strengths;
        skills    = extracted.skills;
        seniority = extracted.seniority;
      } catch (parseErr) {
        console.error('Resume parsing failed:', parseErr);
        return res.status(400).json({ error: `Resume parsing failed: ${parseErr.message}` });
      } finally {
        // Multer writes the upload to disk under uploads/ — only the extracted
        // text is needed after this point, so remove the temp file either way.
        await fs.unlink(req.file.path).catch(() => {});
      }
    }

    // -- normalise salary --
    const salary =
      targetSalary && typeof targetSalary === 'object'
        ? { min: targetSalary.min ?? null, max: targetSalary.max ?? null }
        : { min: null, max: null };

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

    const { candidateId, shareableUrl } = await storage.createProfile({
      name:           name.trim(),
      email:          email.trim().toLowerCase(),
      location:       location.trim(),
      resume:         resumeText,
      strengths,
      skills,
      seniority,
      targetRoles,
      targetSalary:   salary,
      nonNegotiables,
      workArrangement,
    }, baseUrl);

    return res.status(201).json({ success: true, candidateId, shareableUrl });
  } catch (err) {
    console.error('POST /create-profile error:', err);
    return res.status(500).json({ error: 'Failed to create profile' });
  }
});

// ── GET /api/profile/exists/:candidateId (public — no auth) ──────────────────

router.get('/exists/:candidateId', async (req, res) => {
  try {
    await storage.getProfile(req.params.candidateId);
    return res.json({ exists: true });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.json({ exists: false });
    }
    return res.status(500).json({ error: 'Failed to check candidate' });
  }
});

// ── GET /api/profile/candidate/:candidateId ───────────────────────────────────

router.get('/candidate/:candidateId', requireAuth, async (req, res) => {
  try {
    const profile = await storage.getProfile(req.params.candidateId);
    return res.json(profile);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('GET /candidate/:candidateId error:', err);
    return res.status(500).json({ error: 'Failed to retrieve profile' });
  }
});

// ── PUT /api/profile/candidate/:candidateId ───────────────────────────────────

router.put('/candidate/:candidateId', requireAuth, async (req, res) => {
  try {
    const { name, email, whatsapp, calendlyLink, location, targetRoles, targetSalary, nonNegotiables, availability, workArrangement, hideSalary, professionalSummary, topSkills } = req.body;
    const updates = {};

    if (name        !== undefined) updates.name     = String(name).trim();
    if (location    !== undefined) updates.location = String(location).trim();
    if (whatsapp    !== undefined) updates.whatsapp = String(whatsapp).trim();

    if (calendlyLink !== undefined) {
      const trimmed = String(calendlyLink).trim();
      if (trimmed && !/^https?:\/\/\S+$/i.test(trimmed)) {
        return res.status(400).json({ error: 'calendlyLink must be a valid URL' });
      }
      updates.calendlyLink = trimmed;
    }

    if (professionalSummary !== undefined) {
      const trimmed = String(professionalSummary).trim();
      if (trimmed.length > PROFESSIONAL_SUMMARY_MAX_LENGTH) {
        return res.status(400).json({
          error: `professionalSummary must be ${PROFESSIONAL_SUMMARY_MAX_LENGTH} characters or fewer`,
        });
      }
      updates.professionalSummary = trimmed;
    }

    if (email !== undefined) {
      const trimmed = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return res.status(400).json({ error: 'email must be a valid address' });
      }
      updates.email = trimmed;
    }

    if (targetRoles !== undefined) {
      if (!Array.isArray(targetRoles)) {
        return res.status(400).json({ error: 'targetRoles must be an array' });
      }
      updates.targetRoles = targetRoles;
    }

    if (nonNegotiables !== undefined) {
      if (!Array.isArray(nonNegotiables)) {
        return res.status(400).json({ error: 'nonNegotiables must be an array' });
      }
      updates.nonNegotiables = nonNegotiables;
    }

    if (topSkills !== undefined) {
      if (!Array.isArray(topSkills) || topSkills.some(s => typeof s !== 'string')) {
        return res.status(400).json({ error: 'topSkills must be an array of strings' });
      }
      updates.topSkills = topSkills.map(s => s.trim()).filter(Boolean);
    }

    if (targetSalary !== undefined) {
      if (typeof targetSalary !== 'object' || targetSalary === null) {
        return res.status(400).json({ error: 'targetSalary must be an object with min and max' });
      }
      updates.targetSalary = {
        min: targetSalary.min ?? null,
        max: targetSalary.max ?? null,
      };
    }

    const VALID_AVAILABILITY = ['open', 'interviewing', 'closed'];
    if (availability !== undefined) {
      if (!VALID_AVAILABILITY.includes(availability)) {
        return res.status(400).json({
          error: `availability must be one of: ${VALID_AVAILABILITY.join(', ')}`,
        });
      }
      updates.availability = availability;
    }

    if (workArrangement !== undefined) {
      if (!Array.isArray(workArrangement) || workArrangement.some(w => !VALID_WORK_ARRANGEMENTS.includes(w))) {
        return res.status(400).json({
          error: `workArrangement must be an array containing only: ${VALID_WORK_ARRANGEMENTS.join(', ')}`,
        });
      }
      updates.workArrangement = workArrangement;
    }

    if (hideSalary !== undefined) {
      if (typeof hideSalary !== 'boolean') {
        return res.status(400).json({ error: 'hideSalary must be a boolean' });
      }
      updates.hideSalary = hideSalary;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    const updated = await storage.updateProfile(req.params.candidateId, updates);
    return res.json(updated);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('PUT /candidate/:candidateId error:', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ── GET /api/profile/candidate/:candidateId/conversations ─────────────────────

router.get('/candidate/:candidateId/conversations', requireAuth, async (req, res) => {
  try {
    const conversations = await storage.getAllConversations(req.params.candidateId);
    return res.json(conversations);
  } catch (err) {
    console.error('GET /candidate/:candidateId/conversations error:', err);
    return res.status(500).json({ error: 'Failed to retrieve conversations' });
  }
});

// ── GET /api/profile/candidate/:candidateId/conversations/:recruiterId ────────

router.get('/candidate/:candidateId/conversations/:recruiterId', requireAuth, async (req, res) => {
  const { candidateId, recruiterId } = req.params;
  try {
    await storage.getProfile(candidateId); // 404 if candidate doesn't exist
    const messages = await storage.getConversationHistory(candidateId, recruiterId);
    return res.json(messages);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('GET conversations/:recruiterId error:', err);
    return res.status(500).json({ error: 'Failed to retrieve transcript' });
  }
});

// ── GET /api/profile/candidate/:candidateId/offers ───────────────────────────
// getCandidateOffers returns { recruiterId, companyName, offerStatus, lastContact }.
// salaryOffered is not persisted by the current storage layer; the profile's
// targetSalary is included so the dashboard can show context.

router.get('/candidate/:candidateId/offers', requireAuth, async (req, res) => {
  try {
    const [profile, rawOffers] = await Promise.all([
      storage.getProfile(req.params.candidateId).catch(() => null),
      storage.getCandidateOffers(req.params.candidateId),
    ]);

    const targetSalary = profile?.targetSalary ?? { min: null, max: null };

    const offers = rawOffers.map(offer => ({
      recruiterId:   offer.recruiterId,
      companyName:   offer.companyName  || null,
      offerStatus:   offer.offerStatus  || 'mentioned',
      lastContact:   offer.lastContact,
      targetSalary,
    }));

    return res.json(offers);
  } catch (err) {
    console.error('GET /candidate/:candidateId/offers error:', err);
    return res.status(500).json({ error: 'Failed to retrieve offers' });
  }
});

// ── Additional documents (candidate-only — never exposed to recruiters) ──────

const DOC_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/png',
  'image/jpeg',
]);

const docStorage = multer.diskStorage({
  destination: async (req, _file, cb) => {
    try {
      const dir = storage.documentDir(req.params.candidateId);
      await fs.mkdir(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, crypto.randomBytes(8).toString('hex') + ext);
  },
});

const uploadDoc = multer({
  storage: docStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB, consistent with resume limit
  fileFilter(_req, file, cb) {
    if (DOC_ALLOWED_MIME_TYPES.has(file.mimetype)) return cb(null, true);
    cb(new Error('Document must be a PDF, DOC, DOCX, PNG, or JPG file'));
  },
});

// ── POST /api/profile/candidate/:candidateId/documents ───────────────────────

router.post(
  '/candidate/:candidateId/documents',
  requireAuth,
  async (req, res, next) => {
    try {
      await storage.getProfile(req.params.candidateId);
      next();
    } catch {
      return res.status(404).json({ error: 'Candidate not found' });
    }
  },
  (req, res, next) => {
    uploadDoc.single('document')(req, res, err => {
      if (!err) return next();
      const status = err instanceof multer.MulterError ? 400
        : err.message.includes('must be a PDF') ? 400
        : 500;
      return res.status(status).json({ error: err.message });
    });
  },
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'document file is required' });
      const entry = await storage.addDocument(req.params.candidateId, {
        id: req.file.filename,
        originalName: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      });
      return res.status(201).json(entry);
    } catch (err) {
      console.error('POST .../documents error:', err);
      return res.status(500).json({ error: 'Failed to save document' });
    }
  }
);

// ── GET /api/profile/candidate/:candidateId/documents ────────────────────────

router.get('/candidate/:candidateId/documents', requireAuth, async (req, res) => {
  try {
    const profile = await storage.getProfile(req.params.candidateId);
    return res.json(profile.additionalDocuments || []);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('GET .../documents error:', err);
    return res.status(500).json({ error: 'Failed to retrieve documents' });
  }
});

// ── GET /api/profile/candidate/:candidateId/documents/:documentId (download) ─

router.get('/candidate/:candidateId/documents/:documentId', requireAuth, async (req, res) => {
  const { candidateId, documentId } = req.params;
  try {
    const doc = await storage.getDocument(candidateId, documentId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const filePath = storage.documentFilePath(candidateId, documentId);
    res.download(filePath, doc.originalName, err => {
      if (err && !res.headersSent) {
        console.error('GET .../documents/:id download error:', err);
        res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: 'File could not be downloaded' });
      }
    });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('GET .../documents/:id error:', err);
    return res.status(500).json({ error: 'Failed to retrieve document' });
  }
});

// ── DELETE /api/profile/candidate/:candidateId/documents/:documentId ─────────

router.delete('/candidate/:candidateId/documents/:documentId', requireAuth, async (req, res) => {
  const { candidateId, documentId } = req.params;
  try {
    const doc = await storage.getDocument(candidateId, documentId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    await storage.removeDocument(candidateId, documentId);
    return res.json({ success: true });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    console.error('DELETE .../documents/:id error:', err);
    return res.status(500).json({ error: 'Failed to delete document' });
  }
});

module.exports = router;
