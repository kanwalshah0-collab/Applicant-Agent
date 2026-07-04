'use strict';

const express        = require('express');
const router         = express.Router();
const storage        = require('../utils/candidate-storage');
const applicantAgent = require('../api/applicant-agent');

// ── Offer / status keyword detection ─────────────────────────────────────────
// Applied to the recruiter's raw message text. Order matters — more specific
// patterns (accepted, declined) are checked before the generic "offered" catch-all
// so a message like "we'd like to accept a counter-offer" doesn't get mis-tagged.

const STATUS_PATTERNS = [
  {
    pattern: /\b(accept(ed|ing|s)?|going\s+to\s+join|signed\s+(the\s+)?offer|taking\s+the\s+(role|offer|job))\b/i,
    status:  'accepted',
  },
  {
    pattern: /\b(declin(ed|ing|es?)|pass(ing)?\s+on|not\s+(a\s+)?fit|not\s+moving\s+forward|withdrawing|pulled\s+out)\b/i,
    status:  'declined',
  },
  {
    pattern: /\b(negotiat(e|ing|ion)|counter(-?\s*offer)?|revisit.*salary|salary.*revisit|push\s+back|meet\s+in\s+the\s+middle)\b/i,
    status:  'negotiating',
  },
  {
    pattern: /\b(offer(ed|ing|s)?|compensation\s+package|salary\s+offer|total\s+comp|base\s+salary|equity\s+offer)\b/i,
    status:  'offered',
  },
  {
    // Softer signal — salary mentioned but no explicit offer yet
    pattern: /\b(salary|compensation|pay|remuneration|wage|band|budget|range)\b/i,
    status:  'mentioned',
  },
];

function detectOfferStatus(message) {
  for (const { pattern, status } of STATUS_PATTERNS) {
    if (pattern.test(message)) return status;
  }
  return null;
}

// ── GET /api/chat/status ──────────────────────────────────────────────────────
// Quick health-check to verify API key config without making a real LLM call.

router.get('/status', (_req, res) => {
  res.json({
    primary:        process.env.PRIMARY_PROVIDER  || 'openrouter',
    fallback:       process.env.FALLBACK_PROVIDER || 'groq',
    useFallback:    process.env.USE_FALLBACK !== 'false',
    openrouterKey:  !!process.env.OPENROUTER_API_KEY,
    groqKey:        !!process.env.GROQ_API_KEY,
  });
});

// ── POST /api/chat/:candidateId ───────────────────────────────────────────────
// Recruiter sends a message; the agent responds on the candidate's behalf.

router.post('/:candidateId', async (req, res) => {
  const { candidateId } = req.params;
  const { recruiterId, message, companyName, conversationHistory } = req.body;

  // -- input validation --
  if (!recruiterId || typeof recruiterId !== 'string' || !recruiterId.trim()) {
    return res.status(400).json({ error: 'recruiterId is required' });
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message must be a non-empty string' });
  }

  const trimmedMessage = message.trim();

  // -- load candidate profile --
  let profile;
  try {
    profile = await storage.getProfile(candidateId);
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: `Candidate not found: ${candidateId}` });
    }
    console.error('[chat] getProfile error:', err);
    return res.status(500).json({ error: 'Failed to load candidate profile' });
  }

  // -- persist recruiter message before generating a response --
  // Saving first means the message is on disk even if Ollama times out.
  try {
    await storage.saveChatMessage(
      candidateId,
      recruiterId.trim(),
      'recruiter',
      trimmedMessage,
      companyName?.trim() || null
    );
  } catch (err) {
    console.error('[chat] saveChatMessage (recruiter) error:', err);
    return res.status(500).json({ error: 'Failed to save message' });
  }

  // -- keyword-driven status update (fire-and-forget, non-blocking) --
  const detectedStatus = detectOfferStatus(trimmedMessage);
  if (detectedStatus) {
    storage
      .updateConversationOfferStatus(candidateId, recruiterId.trim(), detectedStatus)
      .catch(err => console.error('[chat] updateConversationOfferStatus error:', err));
  }

  // -- build conversation context --
  // Client sends the full history from localStorage so the LLM always has context
  // even before the conversation is fully flushed to disk. Fall back to disk if
  // the client didn't send history (e.g. API consumers / legacy callers).
  const history =
    Array.isArray(conversationHistory) && conversationHistory.length > 0
      ? conversationHistory
      : await storage.getConversationHistory(candidateId, recruiterId.trim());

  // -- generate agent response --
  let agentResponse;
  try {
    agentResponse = await applicantAgent.generateAgentResponse(
      profile,
      history,
      trimmedMessage
    );
  } catch (err) {
    console.error('[chat] generateAgentResponse error:', err);

    if (err.status === 401) {
      return res.status(502).json({ error: 'AI service authentication failed. Check your API keys in .env.' });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: 'AI service rate limit reached. Please try again in a moment.' });
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'ECONNABORTED') {
      return res.status(503).json({ error: 'AI service unreachable. Check your internet connection.' });
    }
    return res.status(500).json({ error: 'Failed to generate agent response' });
  }

  // -- persist agent response (best-effort — client already has the data) --
  storage
    .saveChatMessage(candidateId, recruiterId.trim(), 'agent', agentResponse)
    .catch(err => console.error('[chat] saveChatMessage (agent) error:', err));

  console.log(
    `[chat] ${candidateId} ← ${recruiterId.trim()} (${detectedStatus || 'no-status'}):`,
    trimmedMessage.slice(0, 60)
  );

  return res.json({ response: agentResponse, candidateId, recruiterId: recruiterId.trim() });
});

// ── GET /api/chat/:candidateId/:recruiterId ───────────────────────────────────
// Returns the full message list for a conversation. Used by the dashboard
// transcript modal to render the chat thread.

router.get('/:candidateId/:recruiterId', async (req, res) => {
  const { candidateId, recruiterId } = req.params;
  try {
    const messages = await storage.getConversationHistory(candidateId, recruiterId);
    return res.json({ candidateId, recruiterId, messages });
  } catch (err) {
    console.error('[chat] getConversationHistory error:', err);
    return res.status(500).json({ error: 'Failed to retrieve conversation history' });
  }
});

module.exports = router;
