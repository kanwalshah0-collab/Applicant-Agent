'use strict';

const fs = require('fs').promises;
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

// ── File parsers ──────────────────────────────────────────────────────────────

async function parsePDF(filePath) {
  const buffer = await fs.readFile(filePath);
  const result = await pdfParse(buffer);
  return result.text || '';
}

async function parseDOCX(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value || '';
}

// ── Text analysis helpers ─────────────────────────────────────────────────────

const SENIORITY_KEYWORDS = {
  Executive:  /\b(C[ETO]O|Chief\s+\w+\s+Officer|President|Founder|Co-Founder|EVP|SVP)\b/i,
  Lead:       /\b(Lead|Principal|Staff|Head\s+of|Director)\b/i,
  Senior:     /\b(Senior|Sr\.?|Manager|Architect)\b/i,
  Mid:        /\b(Mid[-\s]?level|Specialist|Engineer\s+II|Developer\s+II)\b/i,
  Junior:     /\b(Junior|Jr\.?|Associate|Entry[-\s]?level|Intern)\b/i,
};

const IMPACT_PATTERN  = /\b(grew|scaled|increased|improved|launched|built|led|managed|directed|reduced|saved|delivered|shipped|drove|achieved|spearheaded)\b/i;
const METRIC_PATTERN  = /(\d[\d,]*\s*(%|x|times|million|billion|k\b|thousand|users|customers|revenue|mrr|arr|leads|conversion|nps|roi|latency|queries|requests|throughput))/i;
const LEADERSHIP_PATTERN = /\b(led|managed|directed|mentored|coached|supervised|oversaw)\s+\w*\s*(team|engineer|designer|analyst|report|people|person|member|cross[-\s]functional)/i;

function extractYearsOfExperience(text) {
  // Explicit "X years of experience" statements
  const explicit = text.match(/(\d+)\+?\s+years?\s+(of\s+)?(professional\s+)?(software|engineering|product|design|marketing|sales|finance|data|leadership)?\s*experience/i);
  if (explicit) return parseInt(explicit[1], 10);

  // Date range extraction — looks for years like 2015–2023 or Jan 2015 – Present
  const yearMatches = [...text.matchAll(/\b(20\d{2}|19[89]\d)\b/g)].map(m => parseInt(m[1], 10));
  if (yearMatches.length < 2) return 0;
  const earliest = Math.min(...yearMatches);
  const latest   = Math.max(...yearMatches);
  const currentYear = new Date().getFullYear();
  return Math.min(latest, currentYear) - earliest;
}

function detectSeniority(text, yearsOfExperience) {
  for (const [level, pattern] of Object.entries(SENIORITY_KEYWORDS)) {
    if (pattern.test(text)) return level;
  }
  if (yearsOfExperience >= 10) return 'Senior';
  if (yearsOfExperience >= 5)  return 'Mid';
  return 'Junior';
}

function extractHeadline(text) {
  // Try first non-empty line that looks like a job title (not just a name)
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const titlePatterns = /\b(Engineer|Developer|Manager|Designer|Analyst|Director|Lead|VP|Officer|Specialist|Consultant|Architect|Scientist|Executive|Founder|Head)\b/i;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i];
    if (line.length > 5 && line.length < 100 && titlePatterns.test(line)) {
      return line.replace(/\s+/g, ' ');
    }
  }
  // Fallback: return first substantive line
  return lines[0] ? lines[0].substring(0, 80) : '';
}

function extractStrengths(text) {
  const sentences = text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 20 && s.length < 200);

  const scored = sentences.map(sentence => {
    let score = 0;
    if (METRIC_PATTERN.test(sentence))    score += 3;
    if (IMPACT_PATTERN.test(sentence))    score += 2;
    if (LEADERSHIP_PATTERN.test(sentence)) score += 2;
    // Bonus for recent experience (sentence contains a recent year)
    if (/\b(202[0-9]|2019|2018)\b/.test(sentence)) score += 1;
    return { sentence, score };
  });

  return scored
    .filter(s => s.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(s => s.sentence.replace(/^[-•*]\s*/, ''));
}

function extractSkills(text) {
  const COMMON_SKILLS = [
    // Technical
    'JavaScript','TypeScript','Python','Java','Go','Rust','C#','C++','Swift','Kotlin','Ruby','PHP',
    'React','Vue','Angular','Node.js','Next.js','GraphQL','REST','SQL','PostgreSQL','MySQL','MongoDB',
    'Redis','Elasticsearch','Kafka','AWS','GCP','Azure','Docker','Kubernetes','Terraform','CI/CD',
    'Git','Linux','Machine Learning','Deep Learning','NLP','LLM','Data Science','Data Engineering',
    // Product / Business
    'Product Strategy','Product Management','Roadmap','OKRs','A/B Testing','User Research','UX',
    'Data Analysis','Analytics','Metrics','KPIs','Agile','Scrum','Lean','Growth',
    'Team Leadership','Cross-functional','Stakeholder Management','P&L','GTM','Sales','Marketing',
  ];

  const found = COMMON_SKILLS.filter(skill =>
    new RegExp(`\\b${skill.replace(/[.+]/g, '\\$&')}\\b`, 'i').test(text)
  );

  // Also look for comma-separated skills sections
  const skillsSection = text.match(/skills?[:\s]+([A-Za-z,\s|•\/]+?)(?:\n\n|\n[A-Z])/i);
  if (skillsSection) {
    const inline = skillsSection[1]
      .split(/[,|•\/\n]/)
      .map(s => s.trim())
      .filter(s => s.length > 2 && s.length < 40);
    inline.forEach(s => { if (!found.includes(s)) found.push(s); });
  }

  return [...new Set(found)].slice(0, 15);
}

function detectGaps(text) {
  const gaps = [];
  // Look for years that appear next to gap-indicating words
  const gapPattern = /\b(career\s+break|sabbatical|hiatus|gap|leave\s+of\s+absence|took\s+time|parental\s+leave|caregiver|relocation|personal\s+reason)\b/gi;
  let match;
  while ((match = gapPattern.exec(text)) !== null) {
    const context = text.substring(Math.max(0, match.index - 60), match.index + 120).trim();
    const yearRange = context.match(/\b(20\d{2})\s*[-–—]\s*(20\d{2}|present)/i);
    const description = yearRange
      ? `Career break ${yearRange[0]} (addressed: ${match[0].toLowerCase()})`
      : `Career break mentioned: ${match[0].toLowerCase()}`;
    gaps.push(description);
  }
  return [...new Set(gaps)].slice(0, 3);
}

function suggestRoles(text, seniority) {
  const ROLE_MAP = {
    Executive: ['Chief Product Officer', 'VP of Product', 'VP of Engineering', 'Chief Technology Officer'],
    Lead:      ['Head of Product', 'Director of Product', 'Director of Engineering', 'Principal Engineer', 'Engineering Manager'],
    Senior:    ['Senior Product Manager', 'Senior Software Engineer', 'Senior Data Scientist', 'Senior UX Designer', 'Technical Lead'],
    Mid:       ['Product Manager', 'Software Engineer', 'Data Analyst', 'UX Designer', 'DevOps Engineer'],
    Junior:    ['Associate Product Manager', 'Junior Developer', 'Junior Data Analyst', 'QA Engineer'],
  };

  const base = ROLE_MAP[seniority] || ROLE_MAP.Mid;

  // Refine based on domain signals
  const isProduct     = /\bproduct\s+manager\b|\bpm\b|\bproduct\s+lead\b/i.test(text);
  const isEngineering = /\bengineer\b|\bdeveloper\b|\barchitect\b|\bdevops\b/i.test(text);
  const isData        = /\bdata\s+scientist\b|\bdata\s+engineer\b|\bmachine\s+learning\b|\banalyst\b/i.test(text);
  const isDesign      = /\bdesigner\b|\bux\b|\bui\b|\bproduct\s+design\b/i.test(text);

  let candidates = [...base];
  if (isProduct && !isEngineering) {
    candidates = candidates.filter(r => /product|pm|chief|director|head|vp/i.test(r));
  } else if (isEngineering && !isProduct) {
    candidates = candidates.filter(r => /engineer|developer|tech|devops|architect/i.test(r));
  } else if (isData) {
    candidates = candidates.filter(r => /data|scientist|analyst|ml|ai/i.test(r));
  } else if (isDesign) {
    candidates = candidates.filter(r => /design|ux|ui/i.test(r));
  }

  if (candidates.length < 3) candidates = base;
  return candidates.slice(0, 5);
}

function estimateMarketValue(seniority, skills) {
  const BASE = {
    Junior:    { min: 60000,  max: 90000  },
    Mid:       { min: 90000,  max: 130000 },
    Senior:    { min: 130000, max: 180000 },
    Lead:      { min: 160000, max: 220000 },
    Executive: { min: 200000, max: 350000 },
  };

  const premium = {
    'Machine Learning': 20000, 'Deep Learning': 20000, 'LLM': 15000,
    'Kubernetes': 10000, 'AWS': 8000, 'Product Strategy': 10000,
    'P&L': 15000,
  };

  const base = BASE[seniority] || BASE.Mid;
  let bump = 0;
  for (const skill of skills) {
    bump += premium[skill] || 0;
  }
  bump = Math.min(bump, 40000); // cap the premium

  return {
    min: base.min + bump,
    max: base.max + bump,
    currency: 'USD',
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

function extractCandidateStrengths(resumeText) {
  if (resumeText === null || resumeText === undefined) {
    throw new Error('resumeText is required');
  }
  if (typeof resumeText !== 'string') {
    throw new Error('resumeText must be a string');
  }

  const text = resumeText.trim();

  if (text.length === 0) {
    return {
      headline: '',
      yearsOfExperience: 0,
      seniority: 'Junior',
      strengths: [],
      skills: [],
      gaps: [],
      suggestedRoles: [],
      marketValue: { min: 60000, max: 90000, currency: 'USD' },
    };
  }

  const yearsOfExperience = extractYearsOfExperience(text);
  const seniority         = detectSeniority(text, yearsOfExperience);
  const skills            = extractSkills(text);

  return {
    headline:          extractHeadline(text),
    yearsOfExperience,
    seniority,
    strengths:         extractStrengths(text),
    skills,
    gaps:              detectGaps(text),
    suggestedRoles:    suggestRoles(text, seniority),
    marketValue:       estimateMarketValue(seniority, skills),
  };
}

module.exports = {
  parsePDF,
  parseDOCX,
  extractCandidateStrengths,
};
