'use strict';

const axios = require('axios');

const PRIMARY_PROVIDER  = process.env.PRIMARY_PROVIDER  || 'openrouter';
const FALLBACK_PROVIDER = process.env.FALLBACK_PROVIDER || 'groq';
const USE_FALLBACK      = process.env.USE_FALLBACK !== 'false';

const PROVIDERS = {
  openrouter: {
    url:   'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    headers: () => ({
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title':      'Applicant Agent',
    }),
  },
  groq: {
    url:   'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    headers: () => ({
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    }),
  },
};

// ── System prompt ─────────────────────────────────────────────────────────────

function initializeAgentSystemPrompt(candidateData) {
  if (!candidateData || typeof candidateData !== 'object') {
    throw new Error('candidateData is required');
  }

  const name           = candidateData.name || 'the candidate';
  const email          = candidateData.email || null;
  const phone          = candidateData.phone || null;
  const location       = candidateData.location || 'Location not specified';
  const targetRoles    = (candidateData.targetRoles || []).join(', ') || 'open to discussion';
  const nonNegotiables = (candidateData.nonNegotiables || []).join(', ') || 'none specified';
  const salaryMin      = candidateData.targetSalary?.min ? `$${candidateData.targetSalary.min.toLocaleString()}` : 'competitive';
  const salaryMax      = candidateData.targetSalary?.max ? `$${candidateData.targetSalary.max.toLocaleString()}` : 'market rate';
  const salaryRange    = `${salaryMin}–${salaryMax}`;

  const resumeText = (candidateData.resume || '').trim() || 'No resume text available.';

  const contactParts = [];
  if (email) contactParts.push(`email: ${email}`);
  if (phone) contactParts.push(`phone: ${phone}`);
  const contactInfo = contactParts.length
    ? contactParts.join(' or ')
    : 'the contact details on the resume';

  return `You are the AI representative speaking on behalf of ${name}, a job candidate. Answer recruiters STRICTLY from the resume and data below — never invent facts.

FORMATTING RULES (always follow):
- For skills, tools, or any list: use bullet points starting with "•"
- Convert long explanations into short, scannable bullet pointers (one idea per bullet)
- Prose answers: 2-3 sentences max
- Never write walls of text

STRICT CONTENT RULES:
- Only state facts explicitly present in RESUME below
- Never say "likely", "probably", or guess at anything
- If a recruiter asks something NOT answered by the resume or data below, say: "That's not something I have details on — please reach out to ${name} directly at ${contactInfo} for more information."
- Push back professionally if salary offered is below ${salaryRange}
- Always finish your sentence / bullet list before stopping

CANDIDATE DATA:
Name: ${name} | Location: ${location}
Target roles: ${targetRoles} | Salary range: ${salaryRange}
Non-negotiables: ${nonNegotiables}

RESUME (use this as the single source of truth):
${resumeText}`;
}

// ── Message builder ───────────────────────────────────────────────────────────

const MAX_MESSAGE_CHARS = 400;
const MAX_HISTORY_TURNS = 4;

function buildMessages(candidateData, history, currentMessage) {
  const messages = [{ role: 'system', content: initializeAgentSystemPrompt(candidateData) }];

  for (const msg of history) {
    messages.push({
      role:    msg.role === 'agent' ? 'assistant' : 'user',
      content: msg.content,
    });
  }

  messages.push({ role: 'user', content: currentMessage });
  return messages;
}

// ── LLM call ──────────────────────────────────────────────────────────────────

async function callLlmApi(messages, provider) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`Unknown provider: ${provider}`);

  try {
    const response = await axios.post(
      cfg.url,
      { model: cfg.model, messages, temperature: 0.5, max_tokens: 200 },
      { headers: cfg.headers(), timeout: 30000 }
    );
    return response.data.choices[0].message.content;
  } catch (err) {
    const status  = err.response?.status;
    const detail  = err.response?.data?.error?.message || err.message;
    const wrapped = new Error(`[${provider}] ${status ? `HTTP ${status}: ${detail}` : detail}`);
    wrapped.status   = status;
    wrapped.provider = provider;
    throw wrapped;
  }
}

// ── Agent response ────────────────────────────────────────────────────────────

async function generateAgentResponse(candidateData, conversationHistory, recruiterMessage) {
  if (!candidateData || typeof candidateData !== 'object') {
    throw new Error('candidateData is required');
  }
  if (!recruiterMessage || typeof recruiterMessage !== 'string' || !recruiterMessage.trim()) {
    throw new Error('recruiterMessage must be a non-empty string');
  }

  const trimmedMessage = recruiterMessage.trim();
  const cappedMessage  = trimmedMessage.length > MAX_MESSAGE_CHARS
    ? trimmedMessage.slice(0, MAX_MESSAGE_CHARS) + '… [message truncated]'
    : trimmedMessage;

  const recentHistory = Array.isArray(conversationHistory)
    ? conversationHistory.slice(-MAX_HISTORY_TURNS)
    : [];

  const messages  = buildMessages(candidateData, recentHistory, cappedMessage);
  const providers = [PRIMARY_PROVIDER, ...(USE_FALLBACK ? [FALLBACK_PROVIDER] : [])];

  let lastError;
  for (const provider of providers) {
    try {
      const content = await callLlmApi(messages, provider);
      return sanitizeResponse(content);
    } catch (err) {
      lastError = err;
      if (USE_FALLBACK && provider === PRIMARY_PROVIDER) {
        console.warn(`[agent] ${provider} failed (${err.message}), trying ${FALLBACK_PROVIDER}`);
      }
    }
  }

  throw lastError;
}

// ── Response sanitizer ────────────────────────────────────────────────────────

function sanitizeResponse(text) {
  const lines   = text.split('\n');
  const cleaned = [];
  for (const line of lines) {
    if (/^(human|recruiter|user)\s*:/i.test(line.trim())) break;
    cleaned.push(line);
  }
  return cleaned.join('\n').trim();
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  initializeAgentSystemPrompt,
  generateAgentResponse,
  PROVIDERS,
};
