'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const PROFILES_DIR = path.join(__dirname, '../../data/profiles');
const CONVERSATIONS_DIR = path.join(__dirname, '../../data/conversations');

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateCandidateId() {
  return crypto.randomBytes(4).toString('hex'); // 8 hex chars
}

async function ensureDirectoryExists(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function formatDate(date = new Date()) {
  return date instanceof Date ? date.toISOString() : new Date(date).toISOString();
}

function profilePath(candidateId) {
  return path.join(PROFILES_DIR, `${candidateId}.json`);
}

function conversationPath(candidateId, recruiterId) {
  return path.join(CONVERSATIONS_DIR, candidateId, `${recruiterId}.json`);
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Failed to read ${filePath}: ${err.message}`);
  }
}

async function writeJson(filePath, data) {
  try {
    await ensureDirectoryExists(path.dirname(filePath));
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Failed to write ${filePath}:`, err);
    throw err;
  }
}

// ── Profile functions ─────────────────────────────────────────────────────────

/**
 * Creates a new candidate profile and persists it to disk.
 * @param {{ name, email, resume, targetRoles, targetSalary, nonNegotiables, location, strengths }} candidateData
 * @param {string} baseUrl — origin to build the shareable link from, e.g. "https://myapp.up.railway.app"
 * @returns {{ candidateId: string, shareableUrl: string }}
 */
async function createProfile(candidateData, baseUrl) {
  await ensureDirectoryExists(PROFILES_DIR);

  const candidateId = generateCandidateId();
  const shareableUrl = `${baseUrl}/candidate/${candidateId}`;
  const now = formatDate();

  const profile = {
    candidateId,
    name: candidateData.name || '',
    email: candidateData.email || '',
    resume: candidateData.resume || '',
    strengths: candidateData.strengths || [],
    targetRoles: candidateData.targetRoles || [],
    targetSalary: candidateData.targetSalary || { min: null, max: null },
    nonNegotiables: candidateData.nonNegotiables || [],
    location: candidateData.location || '',
    createdAt: now,
    shareableUrl,
  };

  await writeJson(profilePath(candidateId), profile);
  return { candidateId, shareableUrl };
}

/**
 * Retrieves a candidate profile by ID. Throws if not found.
 * @param {string} candidateId
 * @returns {Object} full profile
 */
async function getProfile(candidateId) {
  if (!candidateId || typeof candidateId !== 'string') {
    throw new Error('Invalid candidateId');
  }

  const data = await readJson(profilePath(candidateId));
  if (!data) {
    throw new Error(`Profile not found for candidateId: ${candidateId}`);
  }
  return data;
}

/**
 * Merges updates into an existing profile and persists the result.
 * @param {string} candidateId
 * @param {Object} updates — any subset of profile fields
 * @returns {Object} updated profile
 */
async function updateProfile(candidateId, updates) {
  const profile = await getProfile(candidateId);

  const IMMUTABLE = ['candidateId', 'createdAt', 'shareableUrl'];
  const sanitized = Object.fromEntries(
    Object.entries(updates).filter(([key]) => !IMMUTABLE.includes(key))
  );

  const updated = { ...profile, ...sanitized };
  await writeJson(profilePath(candidateId), updated);
  return updated;
}

/**
 * Scans all profiles to find one with a matching email (case-insensitive).
 * @param {string} email
 * @returns {Object|null} first matching profile, or null if none found
 */
async function findProfileByEmail(email) {
  if (!email) return null;
  let files;
  try {
    files = await fs.readdir(PROFILES_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const lower = email.toLowerCase();
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const data = await readJson(path.join(PROFILES_DIR, file));
    if (data && (data.email || '').toLowerCase() === lower) return data;
  }
  return null;
}

/**
 * Looks up a profile using its shareable URL.
 * @param {string} shareableUrl — e.g. "http://localhost:3000/candidate/abc12345"
 * @returns {Object|null} profile, or null if URL is malformed or profile missing
 */
async function getProfileByUrl(shareableUrl) {
  const match = shareableUrl.match(/\/candidate\/([a-f0-9]{8})(?:\/|$)/);
  if (!match) return null;

  const candidateId = match[1];
  try {
    return await getProfile(candidateId);
  } catch {
    return null;
  }
}

// ── Conversation functions ────────────────────────────────────────────────────

/**
 * Appends a message to a conversation, creating the file if it doesn't exist.
 * @param {string} candidateId
 * @param {string} recruiterId
 * @param {'recruiter'|'agent'} role
 * @param {string} message
 * @param {string|null} companyName — captured once and stored if not already set
 * @returns {Object} updated conversation
 */
async function saveChatMessage(candidateId, recruiterId, role, message, companyName = null) {
  const filePath = conversationPath(candidateId, recruiterId);
  const now = formatDate();

  let conversation = await readJson(filePath);

  if (!conversation) {
    conversation = {
      candidateId,
      recruiterId,
      companyName: companyName || null,
      messages: [],
      offerStatus: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (companyName && !conversation.companyName) {
    conversation.companyName = companyName;
  }

  conversation.messages.push({ role, content: message, timestamp: now });
  conversation.updatedAt = now;

  await writeJson(filePath, conversation);
  return conversation;
}

/**
 * Updates the offerStatus on an existing conversation. No-op if no conversation file exists yet.
 * @param {string} candidateId
 * @param {string} recruiterId
 * @param {string} status — e.g. "offered" | "negotiating" | "accepted" | "declined"
 */
async function updateConversationOfferStatus(candidateId, recruiterId, status) {
  const filePath = conversationPath(candidateId, recruiterId);
  const conversation = await readJson(filePath);
  if (!conversation) return;
  conversation.offerStatus = status;
  conversation.updatedAt = formatDate();
  await writeJson(filePath, conversation);
}

/**
 * Returns all messages in a conversation, or [] if none exists.
 * @param {string} candidateId
 * @param {string} recruiterId
 * @returns {Array<{role, content, timestamp}>}
 */
async function getConversationHistory(candidateId, recruiterId) {
  const data = await readJson(conversationPath(candidateId, recruiterId));
  return data ? data.messages : [];
}

/**
 * Lists summary info for every recruiter who has chatted with the candidate.
 * @param {string} candidateId
 * @returns {Array<{recruiterId, companyName, messageCount, firstContact, lastContact, offerStatus}>}
 */
async function getAllConversations(candidateId) {
  const dir = path.join(CONVERSATIONS_DIR, candidateId);
  let files;
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const jsonFiles = files.filter(f => f.endsWith('.json'));

  const summaries = await Promise.all(
    jsonFiles.map(async (file) => {
      const data = await readJson(path.join(dir, file));
      if (!data) return null;
      const messages = data.messages || [];
      return {
        recruiterId: data.recruiterId,
        companyName: data.companyName || null,
        messageCount: messages.length,
        firstContact: data.createdAt,
        lastContact: data.updatedAt,
        offerStatus: data.offerStatus || null,
      };
    })
  );

  return summaries.filter(Boolean);
}

/**
 * Scans all conversations for offer mentions and explicit offerStatus flags.
 * Returns structured offer info for each conversation where an offer was detected.
 * @param {string} candidateId
 * @returns {Array<{recruiterId, companyName, offerStatus, lastContact}>}
 */
async function getCandidateOffers(candidateId) {
  const conversations = await getAllConversations(candidateId);

  const OFFER_KEYWORDS = /\boffer(ed|ing)?\b|\bcompensation package\b|\bsalary offer\b/i;

  const dir = path.join(CONVERSATIONS_DIR, candidateId);

  const offers = await Promise.all(
    conversations.map(async (summary) => {
      const data = await readJson(path.join(dir, `${summary.recruiterId}.json`));
      if (!data) return null;

      const hasOfferStatus = data.offerStatus && data.offerStatus !== null;
      const hasOfferKeyword = (data.messages || []).some(m => OFFER_KEYWORDS.test(m.content));

      if (!hasOfferStatus && !hasOfferKeyword) return null;

      return {
        recruiterId: data.recruiterId,
        companyName: data.companyName || null,
        offerStatus: data.offerStatus || 'mentioned',
        lastContact: data.updatedAt,
      };
    })
  );

  return offers.filter(Boolean);
}

/**
 * Deletes a single conversation file. Throws if the file does not exist.
 * @param {string} candidateId
 * @param {string} recruiterId
 */
async function deleteConversation(candidateId, recruiterId) {
  const filePath = conversationPath(candidateId, recruiterId);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Conversation not found: ${candidateId}/${recruiterId}`);
    }
    throw err;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  createProfile,
  getProfile,
  updateProfile,
  findProfileByEmail,
  getProfileByUrl,
  saveChatMessage,
  updateConversationOfferStatus,
  getConversationHistory,
  getAllConversations,
  getCandidateOffers,
  deleteConversation,
  // exposed for testing
  generateCandidateId,
  ensureDirectoryExists,
  formatDate,
};
