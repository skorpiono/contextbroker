import jwt from 'jsonwebtoken';
import { CONFIG } from './config.js';
import { redis } from './db.js';

export async function rateLimit({ windowMs, max }) {
    return async (req, res, next) => {
        const key = `ratelimit:${req.ip}:${req.path}`;
        const count = await redis.incr(key);
        
        if (count === 1) {
            await redis.expire(key, windowMs / 1000);
        }
        
        if (count > max) {
            return res.status(429).json({ error: 'Too many requests' });
        }
        
        next();
    };
}

export function requireToken(req, res, next) {
    const token = req.headers['x-client-token'];
    if (!token) {
        return res.status(401).json({ error: 'Token required' });
    }

    try {
        const decoded = jwt.verify(token, CONFIG.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

export function issueToken(email) {
    return jwt.sign({ email }, CONFIG.JWT_SECRET, { expiresIn: '30d' });
}