-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Claims table
CREATE TABLE IF NOT EXISTS claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    tags TEXT[] DEFAULT '{}',
    sensitivity TEXT DEFAULT 'public',
    embedding double precision[] NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CHECK (array_length(embedding, 1) = 1536)
);

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source TEXT,
    content TEXT NOT NULL,
    embedding double precision[] NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CHECK (array_length(embedding, 1) = 1536)
);

-- Chunks table
CREATE TABLE IF NOT EXISTS chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding double precision[] NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CHECK (array_length(embedding, 1) = 1536)
);

-- Cosine similarity function
CREATE OR REPLACE FUNCTION cosine_distance(a double precision[], b double precision[])
RETURNS double precision
LANGUAGE sql IMMUTABLE AS $$
  WITH idx AS (SELECT generate_subscripts(a, 1) AS i)
  SELECT 1 - (
    SUM(a[i] * b[i]) /
    (SQRT(SUM(a[i]*a[i])) * SQRT(SUM(b[i]*b[i])))
  )
  FROM idx;
$$;
