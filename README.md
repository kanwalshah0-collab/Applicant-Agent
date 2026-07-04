# Applicant Agent

An AI-powered job applicant agent. Candidates upload their resume once, get a shareable link, and recruiters can chat with an AI that answers questions about the candidate — 24/7, in their voice.

## How it works

1. **Candidate** visits `/create-profile`, uploads their resume (PDF or DOCX)
2. The server parses the resume and stores a structured profile
3. The candidate gets a unique public link (e.g. `https://yoursite.com/p/abc123`)
4. **Recruiter** opens the link and chats with the AI agent, which answers as the candidate
5. The candidate can review all conversations from their private **Dashboard**

## Project structure

```
src/
  api/applicant-agent.js   — Claude API integration and system prompt logic
  routes/
    profile.js             — Resume upload and profile CRUD
    chat.js                — AI chat session management
    public.js              — Public applicant page serving
    dashboard.js           — Candidate dashboard API
  utils/
    candidate-storage.js   — File-system read/write for profiles and conversations
    resume-parser.js       — PDF and DOCX text extraction
  server.js                — Express app entry point

public/
  create-profile.html      — Candidate onboarding UI
  applicant.html           — Recruiter chat UI (public)
  dashboard.html           — Candidate dashboard UI (private)
  profile.js               — Frontend logic for profile creation
  applicant-chat.js        — Frontend logic for recruiter chat
  dashboard.js             — Frontend logic for dashboard
  styles.css               — Global styles

data/
  profiles/                — Candidate profile JSON files (gitignored)
  conversations/           — Conversation history JSON files (gitignored)
```

## Getting started

```bash
# Install dependencies
npm install

# Configure environment
cp .env .env.local
# Edit .env.local and add your ANTHROPIC_API_KEY

# Start the server
npm run dev
```

Server runs at `http://localhost:3000` by default.

## Dependencies

- **Express** — HTTP server and routing
- **@anthropic-ai/sdk** — Claude API client
- **pdf-parse** — PDF text extraction
- **mammoth** — DOCX text extraction
- **multer** — File upload handling
- **dotenv** — Environment variable loading
- **cors** — Cross-origin request support
