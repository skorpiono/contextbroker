// server/index.js
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { CONFIG } from './config.js';
import { db } from './db.js';
import { requireToken, rateLimit, issueToken } from './auth.js';

const app = express();

// ---------- Middleware ----------
app.use(express.json());

// CORS. Allow ChatGPT and local dev by default if CONFIG.CORS_ORIGINS is empty.
const corsOrigins =
  (Array.isArray(CONFIG.CORS_ORIGINS) && CONFIG.CORS_ORIGINS.length > 0)
    ? CONFIG.CORS_ORIGINS
    : ['*'];

app.use(cors({
  origin: corsOrigins,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-Client-Token'],
  credentials: false
}));

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || CONFIG.OPENAI_API_KEY
});

// ---------- Helpers ----------

// crude token estimator and packer
function estimateTokens(str) {
  return Math.ceil((str || '').length / 4);
}
function packContext(rows, maxTokens = 1200, maxItems = 8) {
  const picked = [];
  let used = 0;
  for (const r of rows) {
    const t = estimateTokens(r.content);
    if (/(password|api_key|iban|ssn)/i.test(r.content)) continue;
    if (used + t > maxTokens) break;
    picked.push(`• ${r.content}`);
    used += t;
    if (picked.length >= maxItems) break;
  }
  return picked.join('\n');
}

// vector retrieval using the SQL cosine_distance helper in your DB
async function retrieveCandidates(queryVec, limit = 30) {
  const sql = `
    SELECT id, content, cosine_distance(embedding, $1) AS dist
    FROM chunks
    WHERE array_length(embedding, 1) = 1536
    ORDER BY dist
    LIMIT $2
  `;
  const { rows } = await db.query(sql, [queryVec, limit]);
  return rows;
}

async function embed(text) {
  const r = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });
  return r.data[0].embedding;
}

// ---------- Public routes ----------

app.get('/', (_req, res) => res.type('text/plain').send('OK'));

// Browser friendly GET so you can test from the address bar:
//   /ask?q=your+question
app.get('/ask', /* rateLimit optional */ async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(400).type('text/plain').send('missing q');
    const qVec = await embed(q);
    const candidates = await retrieveCandidates(qVec, 30);
    const context = packContext(candidates, 1200, 8);

    const system = 'Use ONLY facts from CONTEXT. If info is missing, say it plainly.';
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: `CONTEXT:\n${context}\n\nQUESTION:\n${q}` }
    ];

    const chat = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages,
      temperature: 0.2
    });

    const answer = chat.choices[0]?.message?.content || '';
    // Plain text response for easy browser testing
    res
      .type('text/plain')
      .send(`${answer}\n\n---\nCONTEXT USED:\n${context}`);
  } catch (err) {
    console.error(err);
    res.status(500).type('text/plain').send('server error');
  }
});

// JSON POST for your extension or app:
//   body: { "prompt": "..." }
app.post('/ask', /* rateLimit optional */ async (req, res) => {
  try {
    const prompt = (req.body?.prompt || '').toString().trim();
    if (!prompt) return res.status(400).json({ error: 'prompt required' });

    const qVec = await embed(prompt);
    const candidates = await retrieveCandidates(qVec, 30);
    const context = packContext(candidates, 1200, 8);

    const system = 'Use ONLY facts from CONTEXT. If info is missing, say it plainly.';
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: `CONTEXT:\n${context}\n\nQUESTION:\n${prompt}` }
    ];

    const chat = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages,
      temperature: 0.2
    });

    res.json({
      context,
      answer: chat.choices[0]?.message?.content || ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// Keep your existing public signup
app.post('/public/signup', async (req, res) => {
  try {
    const { email } = req.body;
    const userId = await db.createUser(email);
    const token = issueToken(email);
    res.json({ user_id: userId, token });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ---------- Protected routes ----------
app.post('/api/claims', requireToken, async (req, res) => {
  try {
    const { text, tags, sensitivity } = req.body;
    const id = await db.insertClaim(req.user.id, { text, tags, sensitivity });
    res.json({ id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ---------- Health ----------
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', version: '1.0.0' });
});

// ---------- Start ----------
const port = CONFIG.PORT || process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
