-- CityCost Editorial Engine — Foundation tables (PostgreSQL)
-- Phase 3A: settings, prompts, content types, clusters, topics, scores,
-- strategy, gaps, calendar, admin, sessions.
-- Does NOT create articles / SEO / jobs / quality / publish / refresh tables.
-- Apply: psql "$DATABASE_URL" -f db/editorial-foundation.pg.sql

CREATE TABLE IF NOT EXISTS editorial_settings (
    id SMALLINT NOT NULL PRIMARY KEY DEFAULT 1,
    settings_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS editorial_prompt_templates (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    prompt_key VARCHAR(64) NOT NULL,
    category VARCHAR(32) NOT NULL DEFAULT 'Writer',
    version INT NOT NULL DEFAULT 1,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_prompt_key_version UNIQUE (prompt_key, version)
);
CREATE INDEX IF NOT EXISTS idx_prompt_active ON editorial_prompt_templates (prompt_key, is_active);
CREATE INDEX IF NOT EXISTS idx_prompt_category ON editorial_prompt_templates (category);

CREATE TABLE IF NOT EXISTS editorial_content_types (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type_key VARCHAR(64) NOT NULL,
    display_name VARCHAR(128) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    prompt_key VARCHAR(64) NULL,
    schema_type VARCHAR(64) NOT NULL DEFAULT 'Article',
    structure_json JSONB NOT NULL,
    seo_rules_json JSONB NOT NULL,
    quality_rules_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_type_key UNIQUE (type_key)
);
CREATE INDEX IF NOT EXISTS idx_content_type_prompt ON editorial_content_types (prompt_key);

CREATE TABLE IF NOT EXISTS editorial_clusters (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    parent_id BIGINT NULL REFERENCES editorial_clusters(id) ON DELETE SET NULL,
    slug VARCHAR(128) NOT NULL,
    title VARCHAR(255) NOT NULL,
    country_slug VARCHAR(128) NULL,
    kind VARCHAR(32) NOT NULL DEFAULT 'pillar',
    level_kind VARCHAR(32) NOT NULL DEFAULT 'pillar',
    depth INT NOT NULL DEFAULT 0,
    path VARCHAR(512) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_cluster_slug UNIQUE (slug)
);
CREATE INDEX IF NOT EXISTS idx_cluster_parent ON editorial_clusters (parent_id);
CREATE INDEX IF NOT EXISTS idx_cluster_country ON editorial_clusters (country_slug);
CREATE INDEX IF NOT EXISTS idx_cluster_path ON editorial_clusters (path);

CREATE TABLE IF NOT EXISTS editorial_topics (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title VARCHAR(512) NOT NULL,
    cluster_id BIGINT NULL REFERENCES editorial_clusters(id) ON DELETE SET NULL,
    content_type VARCHAR(64) NOT NULL,
    source_refs_json JSONB NULL,
    priority_score DECIMAL(10, 3) NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'candidate',
    topic_hash CHAR(64) NOT NULL,
    rationale_json JSONB NULL,
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    locked_at TIMESTAMPTZ NULL,
    locked_reason VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_topic_hash UNIQUE (topic_hash)
);
CREATE INDEX IF NOT EXISTS idx_topic_status_score ON editorial_topics (status, priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_topic_cluster ON editorial_topics (cluster_id);
CREATE INDEX IF NOT EXISTS idx_topic_locked ON editorial_topics (locked);

CREATE TABLE IF NOT EXISTS editorial_topic_scores (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    topic_id BIGINT NOT NULL REFERENCES editorial_topics(id) ON DELETE CASCADE,
    factors_json JSONB NOT NULL,
    breakdown_json JSONB NULL,
    priority_score DECIMAL(10, 3) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_topic_scores_topic ON editorial_topic_scores (topic_id);

CREATE TABLE IF NOT EXISTS editorial_strategy_settings (
    id SMALLINT NOT NULL PRIMARY KEY DEFAULT 1,
    weights_json JSONB NOT NULL,
    options_json JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS editorial_content_gaps (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    gap_type VARCHAR(64) NOT NULL,
    cluster_id BIGINT NULL,
    topic_hash CHAR(64) NULL,
    title VARCHAR(512) NOT NULL,
    severity DECIMAL(6, 2) NOT NULL DEFAULT 1.00,
    detail_json JSONB NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_gap_hash_type UNIQUE (gap_type, topic_hash)
);
CREATE INDEX IF NOT EXISTS idx_gap_status_type ON editorial_content_gaps (status, gap_type);
CREATE INDEX IF NOT EXISTS idx_gap_cluster ON editorial_content_gaps (cluster_id);

CREATE TABLE IF NOT EXISTS editorial_calendar (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    publish_date DATE NOT NULL,
    topic_id BIGINT NULL REFERENCES editorial_topics(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
    notes VARCHAR(512) NULL,
    schedule_source VARCHAR(32) NOT NULL DEFAULT 'manual',
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    locked_at TIMESTAMPTZ NULL,
    locked_by VARCHAR(64) NULL,
    skip_reason VARCHAR(512) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_calendar_date UNIQUE (publish_date)
);
CREATE INDEX IF NOT EXISTS idx_calendar_status ON editorial_calendar (status);
CREATE INDEX IF NOT EXISTS idx_calendar_topic ON editorial_calendar (topic_id);
CREATE INDEX IF NOT EXISTS idx_calendar_locked ON editorial_calendar (locked);

CREATE TABLE IF NOT EXISTS editorial_admin (
    id SMALLINT NOT NULL PRIMARY KEY DEFAULT 1,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS editorial_sessions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token_hash CHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NULL,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(512) NULL,
    CONSTRAINT uk_session_token UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS idx_session_expires ON editorial_sessions (expires_at);
