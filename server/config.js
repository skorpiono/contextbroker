export const CONFIG = {
    PORT: process.env.PORT || 8787,
    NODE_ENV: process.env.NODE_ENV || 'production',
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    CORS_ORIGINS: (process.env.ORIGIN_ALLOWLIST || 'https://chat.openai.com').split(',').filter(Boolean)
};