-- CityCost Editorial Engine — Content Domain tables (PostgreSQL)
-- Phase 3B: articles, drafts, quality reports, SEO JSON columns, internal links,
-- generation logs, publishing logs, data snapshots.
-- Requires foundation tables (clusters, topics) from editorial-foundation.pg.sql.
-- Does NOT create jobs / refresh / scheduler tables.
-- Apply: psql "$DATABASE_URL" -f db/editorial-content.pg.sql

CREATE TABLE IF NOT EXISTS editorial_articles (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    slug VARCHAR(255) NOT NULL,
    content_type VARCHAR(64) NOT NULL,
    cluster_id BIGINT NULL REFERENCES editorial_clusters(id) ON DELETE SET NULL,
    topic_id BIGINT NULL REFERENCES editorial_topics(id) ON DELETE SET NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    seo_title VARCHAR(512) NULL,
    meta_title VARCHAR(512) NULL,
    meta_description VARCHAR(512) NULL,
    excerpt TEXT NULL,
    blocks_json JSONB NULL,
    research_pack_json JSONB NULL,
    draft_json JSONB NULL,
    raw_ai_response TEXT NULL,
    prompt_version INT NULL,
    prompt_hash CHAR(64) NULL,
    ai_model VARCHAR(128) NULL,
    temperature DECIMAL(4, 3) NULL,
    top_p DECIMAL(4, 3) NULL,
    generation_time_ms INT NULL,
    tokens_in INT NULL,
    tokens_out INT NULL,
    reading_time_minutes INT NULL,
    word_count INT NOT NULL DEFAULT 0,
    quality_score DECIMAL(6, 2) NULL,
    review_score DECIMAL(6, 2) NULL,
    seo_package_json JSONB NULL,
    entity_map_json JSONB NULL,
    json_ld_json JSONB NULL,
    internal_links_json JSONB NULL,
    seo_validation_json JSONB NULL,
    preview_version INT NULL,
    canonical_url VARCHAR(512) NULL,
    published_at TIMESTAMPTZ NULL,
    last_public_update_at TIMESTAMPTZ NULL,
    last_updated_at TIMESTAMPTZ NULL,
    supersedes_article_id BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_article_slug UNIQUE (slug)
);
CREATE INDEX IF NOT EXISTS idx_article_status ON editorial_articles (status);
CREATE INDEX IF NOT EXISTS idx_article_type ON editorial_articles (content_type);
CREATE INDEX IF NOT EXISTS idx_article_cluster ON editorial_articles (cluster_id);
CREATE INDEX IF NOT EXISTS idx_article_topic ON editorial_articles (topic_id);
CREATE INDEX IF NOT EXISTS idx_article_published_at ON editorial_articles (published_at DESC);

CREATE TABLE IF NOT EXISTS editorial_data_snapshots (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    article_id BIGINT NOT NULL REFERENCES editorial_articles(id) ON DELETE CASCADE,
    block_id VARCHAR(128) NULL,
    snapshot_json JSONB NOT NULL,
    snapshot_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_snapshot_article ON editorial_data_snapshots (article_id);

CREATE TABLE IF NOT EXISTS editorial_quality_reports (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    article_id BIGINT NOT NULL REFERENCES editorial_articles(id) ON DELETE CASCADE,
    attempt INT NOT NULL DEFAULT 1,
    passed BOOLEAN NOT NULL DEFAULT FALSE,
    score DECIMAL(6, 2) NULL,
    findings_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quality_article ON editorial_quality_reports (article_id);

CREATE TABLE IF NOT EXISTS editorial_generation_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    article_id BIGINT NULL,
    topic_id BIGINT NULL,
    stage VARCHAR(32) NOT NULL,
    model_used VARCHAR(128) NULL,
    writer_prompt_version INT NULL,
    reviewer_prompt_version INT NULL,
    tokens_in INT NULL,
    tokens_out INT NULL,
    latency_ms INT NULL,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    error_message TEXT NULL,
    meta_json JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gen_created ON editorial_generation_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_gen_article ON editorial_generation_logs (article_id);

CREATE TABLE IF NOT EXISTS editorial_publishing_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    article_id BIGINT NULL,
    action VARCHAR(64) NOT NULL,
    actor VARCHAR(64) NOT NULL DEFAULT 'system',
    success BOOLEAN NOT NULL DEFAULT TRUE,
    detail_json JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pub_created ON editorial_publishing_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_pub_article ON editorial_publishing_logs (article_id);

CREATE TABLE IF NOT EXISTS editorial_internal_links (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    article_id BIGINT NOT NULL REFERENCES editorial_articles(id) ON DELETE CASCADE,
    href VARCHAR(512) NOT NULL,
    label VARCHAR(255) NULL,
    link_kind VARCHAR(64) NULL,
    reason VARCHAR(512) NULL,
    confidence DECIMAL(5, 4) NULL,
    location VARCHAR(128) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_links_article ON editorial_internal_links (article_id);
