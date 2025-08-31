import express from 'express';
import cors from 'cors';
import { CONFIG } from './config.js';
import { db } from './db.js';
import { requireToken, rateLimit, issueToken } from './auth.js';

const app = express();

// Middleware
app.use(express.json());
app.use(cors({
    origin: CONFIG.CORS_ORIGINS,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'X-Client-Token']
}));

// Public routes
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

// Protected routes
app.post('/api/claims', requireToken, async (req, res) => {
    try {
        const { text, tags, sensitivity } = req.body;
        const id = await db.insertClaim(req.user.id, { text, tags, sensitivity });
        res.json({ id });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Health check
app.get('/health', (_, res) => {
    res.json({ status: 'healthy', version: '1.0.0' });
});

const port = CONFIG.PORT;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});