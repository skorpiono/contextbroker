import pkg from 'pg';
const { Pool } = pkg;
import { Redis } from 'ioredis';
import { CONFIG } from './config.js';

export const pool = new Pool({
    connectionString: CONFIG.DATABASE_URL,
    ssl: CONFIG.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export const redis = new Redis(CONFIG.REDIS_URL);

export async function query(text, params) {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: res.rowCount });
    return res;
}

export const db = {
    async createUser(email) {
        const result = await query(
            'INSERT INTO users (email) VALUES ($1) RETURNING id',
            [email]
        );
        return result.rows[0].id;
    },

    async insertClaim(userId, { text, tags = [], sensitivity = 'public', embedding = null }) {
        const result = await query(
            `INSERT INTO claims (user_id, text, tags, sensitivity, embedding) 
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [userId, text, tags, sensitivity, embedding]
        );
        return result.rows[0].id;
    }
};