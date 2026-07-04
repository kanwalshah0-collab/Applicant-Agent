'use strict';

const express      = require('express');
const router       = express.Router();
const storage      = require('../utils/candidate-storage');
const resumeParser = require('../utils/resume-parser');

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
    let targetRoles, targetSalary, nonNegotiables;
    try {
      targetRoles    = parseJsonField(req.body.targetRoles,    'targetRoles');
      targetSalary   = parseJsonField(req.body.targetSalary,   'targetSalary');
      nonNegotiables = parseJsonField(req.body.nonNegotiables, 'nonNegotiables');
    } catch (parseErr) {
      return res.status(400).json({ error: parseErr.message });
    }

    if (!Array.isArray(targetRoles) || targetRoles.length === 0) {
      return res.status(400).json({ error: 'targetRoles must be a non-empty array' });
    }
    if (!Array.isArray(nonNegotiables) || nonNegotiables.length === 0) {
      return res.status(400).json({ error: 'nonNegotiables must be a non-empty array' });
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
      }
    }

    // -- normalise salary --
    const salary =
      targetSalary && typeof targetSalary === 'object'
        ? { min: targetSalary.min ?? null, max: targetSalary.max ?? null }
        : { min: null, max: null };

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
    });

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
    const { name, email, location, targetRoles, targetSalary, nonNegotiables, availability } = req.body;
    const updates = {};

    if (name        !== undefined) updates.name     = String(name).trim();
    if (location    !== undefined) updates.location = String(location).trim();

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

module.exports = router;
