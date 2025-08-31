// server/index.js
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { CONFIG } from "./config.js";
import { db } from "./db.js";
import { requireToken, rateLimit, issueToken } from "./auth.js";

const app = express();

/* --------------------------- Core middleware --------------------------- */

app.use(express.json());

// Allow ChatGPT origins (and anything else while you're debugging).
// Tighten this later by replacing app.use(cors()) with the allowlist version.
const ALLOW_ALL_CORS = true;

if (ALLOW_ALL_CORS) {
  app.use(cors());
} else {
  const allowlist = [
    "https://chatgpt.com",
    "https://chat.openai.com",
  ];
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (
          allowlist.some((o) => origin.startsWith(o)) ||
          origin.startsWith("chrome-extension://")
        )
          return cb(null, true);
        cb(new Error("CORS blocked"));
      },
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Client-Token"],
      credentials: false,
    })
  );
}

/* --------------------------- External clients -------------------------- */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || CONFIG.OPENAI_API_KEY || "";
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

/* ------------------------------ Utilities ------------------------------ */

const MODEL_EMBED = "text-embedding-3-small";
const MODEL_CHAT = "gpt-4.1-mini";

function estimateTokens(str) {
  return Math.ceil((str || "").length / 4);
}

function packContext(rows, maxTokens = 1200, maxItems = 8) {
  const picked = [];
  let used = 0;
  for (const r of rows || []) {
    const text = r.content || r.text || "";
    if (!text) continue;
    if (/(password|api_key|iban|ssn|secret)/i.test(text)) continue;
    const t = estimateTokens(text);
    if (used + t > maxTokens) break;
    picked.push(`• ${text}`); // bullet format the extension expects
    used += t;
    if (picked.length >= maxItems) break;
  }
  return picked.join("\n");
}

// Safe DB retrieval. If DB errors, return [] instead of crashing.
async function retrieveCandidatesSafe(queryVec, limit = 30) {
  try {
    const sql = `
      SELECT id, content
      FROM chunks
      WHERE array_length(embedding, 1) = 1536
      ORDER BY (embedding <=> $1) ASC
      LIMIT $2
    `;
    // If your DB uses cosine_distance helper, swap ORDER BY accordingly.
    const { rows } = await db.query(sql, [queryVec, limit]);
    return rows || [];
  } catch (err) {
    console.error("DB retrieval failed:", err.message);
    return [];
  }
}

// Safe embedding. If no OpenAI key, return null so we can fall back.
async function embedSafe(text) {
  if (!openai) return null;
  const r = await openai.embeddings.create({ model: MODEL_EMBED, input: text });
  return r.data[0].embedding;
}

// Call OpenAI chat safely. If it fails, return a helpful fallback.
async function chatSafe(messages) {
  if (!openai) return null;
  try {
    const r = await openai.chat.completions.create({
      model: MODEL_CHAT,
      messages,
      temperature: 0.2,
    });
    return r.choices?.[0]?.message?.content || "";
  } catch (err) {
    console.error("OpenAI chat failed:", err.message);
    return null;
  }
}

// A tiny canned context so the endpoint works even with no DB/LLM.
function demoContext() {
  return [
    "Grandfather: Stephan, 60, ex-CTO Deutsche Bahn; likes math, beer, football.",
    "Shared memory: you played football together; you respect his problem solving.",
    "Location: Dresden/Heidenau; travels often.",
    "Goal: gift with high emotional value and a technical angle.",
  ].join("\n");
}

/* -------------------------------- Routes -------------------------------- */

app.get("/", (_req, res) => res.type("text/plain").send("OK"));

app.get("/healthz", (_req, res) => {
  const status = {
    ok: true,
    hasOpenAI: Boolean(openai),
    time: new Date().toISOString(),
  };
  res.json(status);
});

/**
 * Browser-friendly GET so you can hit it from the address bar:
 *   /ask?q=your+question
 * Returns plain text with a '---\nCONTEXT USED:\n' block the extension expects.
 */
app.get("/ask", /* rateLimit, */ async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).type("text/plain").send("missing q");

    // Best-effort pipeline: embed → retrieve → pack → chat.
    let contextText = "";
    let answerText = "";

    const qVec = await embedSafe(q);
    if (qVec) {
      const candidates = await retrieveCandidatesSafe(qVec, 30);
      contextText = packContext(candidates, 1200, 8);
    }

    // If we didn't get context from DB, use a safe demo context.
    if (!contextText) contextText = demoContext();

    const system = "Use ONLY facts from CONTEXT. If info is missing, say it plainly.";
    const messages = [
      { role: "system", content: system },
      { role: "user", content: `CONTEXT:\n${contextText}\n\nQUESTION:\n${q}` },
    ];

    const ai = await chatSafe(messages);
    if (ai) {
      answerText = ai;
    } else {
      // Fallback answer if OpenAI is not configured or failed.
      answerText = `You asked: ${q}\nHere are gift directions that match the context…\n1) Custom engraved slide rule\n2) Beer tasting kit with logic puzzles\n3) Tickets to a match + framed tactics poster`;
    }

    const body = `${answerText}\n\n---\nCONTEXT USED:\n${contextText}\n`;
    res.type("text/plain").send(body);
  } catch (err) {
    next(err);
  }
});

/**
 * JSON POST version:
 *   body: { "prompt": "..." }
 * Returns { answer, context }.
 */
app.post("/ask", /* rateLimit, */ async (req, res, next) => {
  try {
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "prompt required" });

    let contextText = "";
    let answerText = "";

    const qVec = await embedSafe(prompt);
    if (qVec) {
      const candidates = await retrieveCandidatesSafe(qVec, 30);
      contextText = packContext(candidates, 1200, 8);
    }
    if (!contextText) contextText = demoContext();

    const system = "Use ONLY facts from CONTEXT. If info is missing, say it plainly.";
    const messages = [
      { role: "system", content: system },
      { role: "user", content: `CONTEXT:\n${contextText}\n\nQUESTION:\n${prompt}` },
    ];

    const ai = await chatSafe(messages);
    if (ai) {
      answerText = ai;
    } else {
      answerText = `You asked: ${prompt}\nShort answer based on context (fallback mode).`;
    }

    res.json({ context: contextText, answer: answerText });
  } catch (err) {
    next(err);
  }
});

/* --------------------------- Your existing stuff ------------------------ */

app.post("/public/signup", async (req, res) => {
  try {
    const { email } = req.body;
    const userId = await db.createUser(email);
    const token = issueToken(email);
    res.json({ user_id: userId, token });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/claims", requireToken, async (req, res) => {
  try {
    const { text, tags, sensitivity } = req.body;
    const id = await db.insertClaim(req.user.id, { text, tags, sensitivity });
    res.json({ id });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/* --------------------------- Global error handler ----------------------- */

app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  const wantsJson = (req.headers.accept || "").includes("application/json");
  if (wantsJson || req.path.startsWith("/api") || req.path === "/ask" && req.method === "POST") {
    res.status(500).json({ error: "internal_error" });
  } else {
    res.status(500).type("text/plain").send("server error");
  }
});

/* --------------------------------- Start -------------------------------- */

const port = CONFIG.PORT || process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
