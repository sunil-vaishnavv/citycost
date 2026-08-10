-- CityCost Editorial Engine — additive schema (P0+)
-- Does NOT modify COL / existing tables. Safe to re-run (IF NOT EXISTS).
-- Apply: mysql … < db/editorial-schema.sql
-- Or: automatic ensure on server boot when MySQL is available.

USE citycost_global;

-- Singleton runtime settings (AI, publish policy, refresh bands, etc.)
CREATE TABLE IF NOT EXISTS editorial_settings (
    id TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
    settings_json JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Versioned prompt templates (master + reviewer + per content-type)
-- category: Writer | Reviewer | Refresh | Patch | SEO | Outline | Summary
CREATE TABLE IF NOT EXISTS editorial_prompt_templates (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    prompt_key VARCHAR(64) NOT NULL,
    category VARCHAR(32) NOT NULL DEFAULT 'Writer',
    version INT NOT NULL DEFAULT 1,
    title VARCHAR(255) NOT NULL,
    body MEDIUMTEXT NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_prompt_key_version (prompt_key, version),
    INDEX idx_prompt_active (prompt_key, is_active),
    INDEX idx_prompt_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Extensible content types (blog, guide, checklist, …) — fully data-driven
CREATE TABLE IF NOT EXISTS editorial_content_types (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    type_key VARCHAR(64) NOT NULL,
    display_name VARCHAR(128) NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    prompt_key VARCHAR(64) NULL,
    schema_type VARCHAR(64) NOT NULL DEFAULT 'Article',
    structure_json JSON NOT NULL,
    seo_rules_json JSON NOT NULL,
    quality_rules_json JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_type_key (type_key),
    INDEX idx_content_type_prompt (prompt_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Topic cluster tree (Strategy / P1+)
-- Hierarchy: Country → Pillar → Sub-Pillar → Persona → Article
CREATE TABLE IF NOT EXISTS editorial_clusters (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    parent_id BIGINT NULL,
    slug VARCHAR(128) NOT NULL,
    title VARCHAR(255) NOT NULL,
    country_slug VARCHAR(128) NULL,
    kind VARCHAR(32) NOT NULL DEFAULT 'pillar',
    level_kind VARCHAR(32) NOT NULL DEFAULT 'pillar',
    depth INT NOT NULL DEFAULT 0,
    path VARCHAR(512) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_cluster_slug (slug),
    INDEX idx_cluster_parent (parent_id),
    INDEX idx_cluster_country (country_slug),
    INDEX idx_cluster_path (path(191)),
    CONSTRAINT fk_cluster_parent FOREIGN KEY (parent_id) REFERENCES editorial_clusters(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Scored topic candidates (Strategy Engine — later phases)
-- Status lifecycle: candidate|approved|scheduled|generating|draft|review|published|archived|rejected
CREATE TABLE IF NOT EXISTS editorial_topics (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(512) NOT NULL,
    cluster_id BIGINT NULL,
    content_type VARCHAR(64) NOT NULL,
    source_refs_json JSON NULL,
    priority_score DECIMAL(10, 3) NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'candidate',
    topic_hash CHAR(64) NOT NULL,
    rationale_json JSON NULL,
    locked TINYINT(1) NOT NULL DEFAULT 0,
    locked_at DATETIME NULL,
    locked_reason VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_topic_hash (topic_hash),
    INDEX idx_topic_status_score (status, priority_score DESC),
    INDEX idx_topic_cluster (cluster_id),
    INDEX idx_topic_locked (locked),
    CONSTRAINT fk_topic_cluster FOREIGN KEY (cluster_id) REFERENCES editorial_clusters(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS editorial_topic_scores (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    topic_id BIGINT NOT NULL,
    factors_json JSON NOT NULL,
    breakdown_json JSON NULL,
    priority_score DECIMAL(10, 3) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_topic_scores_topic (topic_id),
    CONSTRAINT fk_topic_scores_topic FOREIGN KEY (topic_id) REFERENCES editorial_topics(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Configurable strategy scoring weights (no hardcoded runtime weights)
CREATE TABLE IF NOT EXISTS editorial_strategy_settings (
    id TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
    weights_json JSON NOT NULL,
    options_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Content-gap detection framework (identify only — no generation)
CREATE TABLE IF NOT EXISTS editorial_content_gaps (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    gap_type VARCHAR(64) NOT NULL,
    cluster_id BIGINT NULL,
    topic_hash CHAR(64) NULL,
    title VARCHAR(512) NOT NULL,
    severity DECIMAL(6, 2) NOT NULL DEFAULT 1.00,
    detail_json JSON NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'open',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_gap_status_type (status, gap_type),
    INDEX idx_gap_cluster (cluster_id),
    UNIQUE KEY uk_gap_hash_type (gap_type, topic_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS editorial_calendar (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    publish_date DATE NOT NULL,
    topic_id BIGINT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
    notes VARCHAR(512) NULL,
    schedule_source VARCHAR(32) NOT NULL DEFAULT 'manual',
    locked TINYINT(1) NOT NULL DEFAULT 0,
    locked_at DATETIME NULL,
    locked_by VARCHAR(64) NULL,
    skip_reason VARCHAR(512) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_calendar_date (publish_date),
    INDEX idx_calendar_status (status),
    INDEX idx_calendar_topic (topic_id),
    INDEX idx_calendar_locked (locked),
    CONSTRAINT fk_calendar_topic FOREIGN KEY (topic_id) REFERENCES editorial_topics(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS editorial_articles (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(255) NOT NULL,
    content_type VARCHAR(64) NOT NULL,
    cluster_id BIGINT NULL,
    topic_id BIGINT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'draft',
    seo_title VARCHAR(512) NULL,
    meta_title VARCHAR(512) NULL,
    meta_description VARCHAR(512) NULL,
    excerpt TEXT NULL,
    blocks_json JSON NULL,
    research_pack_json JSON NULL,
    draft_json JSON NULL,
    raw_ai_response LONGTEXT NULL,
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
    seo_package_json JSON NULL,
    entity_map_json JSON NULL,
    json_ld_json JSON NULL,
    internal_links_json JSON NULL,
    seo_validation_json JSON NULL,
    preview_version INT NULL,
    canonical_url VARCHAR(512) NULL,
    published_at DATETIME NULL,
    last_public_update_at DATETIME NULL,
    last_updated_at DATETIME NULL,
    supersedes_article_id BIGINT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_article_slug (slug),
    INDEX idx_article_status (status),
    INDEX idx_article_type (content_type),
    INDEX idx_article_cluster (cluster_id),
    INDEX idx_article_topic (topic_id),
    CONSTRAINT fk_article_cluster FOREIGN KEY (cluster_id) REFERENCES editorial_clusters(id) ON DELETE SET NULL,
    CONSTRAINT fk_article_topic FOREIGN KEY (topic_id) REFERENCES editorial_topics(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS editorial_data_snapshots (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NOT NULL,
    block_id VARCHAR(128) NULL,
    snapshot_json JSON NOT NULL,
    snapshot_hash CHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_snapshot_article (article_id),
    CONSTRAINT fk_snapshot_article FOREIGN KEY (article_id) REFERENCES editorial_articles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS editorial_quality_reports (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NOT NULL,
    attempt INT NOT NULL DEFAULT 1,
    passed TINYINT(1) NOT NULL DEFAULT 0,
    score DECIMAL(6, 2) NULL,
    findings_json JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_quality_article (article_id),
    CONSTRAINT fk_quality_article FOREIGN KEY (article_id) REFERENCES editorial_articles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS editorial_generation_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NULL,
    topic_id BIGINT NULL,
    stage VARCHAR(32) NOT NULL,
    model_used VARCHAR(128) NULL,
    writer_prompt_version INT NULL,
    reviewer_prompt_version INT NULL,
    tokens_in INT NULL,
    tokens_out INT NULL,
    latency_ms INT NULL,
    success TINYINT(1) NOT NULL DEFAULT 0,
    error_message TEXT NULL,
    meta_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_gen_created (created_at),
    INDEX idx_gen_article (article_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS editorial_publishing_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NULL,
    action VARCHAR(64) NOT NULL,
    actor VARCHAR(64) NOT NULL DEFAULT 'system',
    success TINYINT(1) NOT NULL DEFAULT 1,
    detail_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pub_created (created_at),
    INDEX idx_pub_article (article_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS editorial_refresh_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NULL,
    freshness_score DECIMAL(6, 2) NULL,
    strategy VARCHAR(32) NOT NULL,
    blocks_patched INT NOT NULL DEFAULT 0,
    success TINYINT(1) NOT NULL DEFAULT 0,
    detail_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_refresh_created (created_at),
    INDEX idx_refresh_article (article_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS editorial_jobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    job_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    payload_json JSON NULL,
    result_json JSON NULL,
    error_message TEXT NULL,
    attempts INT NOT NULL DEFAULT 0,
    locked_at DATETIME NULL,
    locked_by VARCHAR(64) NULL,
    run_after DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_jobs_status_run (status, run_after),
    INDEX idx_jobs_type (job_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS editorial_internal_links (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    article_id BIGINT NOT NULL,
    href VARCHAR(512) NOT NULL,
    label VARCHAR(255) NULL,
    link_kind VARCHAR(64) NULL,
    reason VARCHAR(512) NULL,
    confidence DECIMAL(5, 4) NULL,
    location VARCHAR(128) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_links_article (article_id),
    CONSTRAINT fk_links_article FOREIGN KEY (article_id) REFERENCES editorial_articles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Single admin credential (password hash only — never store plaintext)
CREATE TABLE IF NOT EXISTS editorial_admin (
    id TINYINT NOT NULL PRIMARY KEY DEFAULT 1,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Session tokens stored as SHA-256 hashes
CREATE TABLE IF NOT EXISTS editorial_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NULL,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(512) NULL,
    UNIQUE KEY uk_session_token (token_hash),
    INDEX idx_session_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
