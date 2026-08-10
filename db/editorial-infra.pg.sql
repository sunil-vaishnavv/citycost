-- CityCost Editorial Engine — Infrastructure tables (PostgreSQL / Neon)
-- Final phase: jobs queue, refresh logs.
-- Scheduler / automation / retry use editorial_jobs + editorial_settings (already migrated).
-- Does NOT alter foundation/content tables.
-- Apply: psql "$DATABASE_URL" -f db/editorial-infra.pg.sql

CREATE TABLE IF NOT EXISTS editorial_jobs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    payload_json JSONB NULL,
    result_json JSONB NULL,
    error_message TEXT NULL,
    attempts INT NOT NULL DEFAULT 0,
    locked_at TIMESTAMPTZ NULL,
    locked_by VARCHAR(64) NULL,
    run_after TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_run ON editorial_jobs (status, run_after);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON editorial_jobs (job_type);
CREATE INDEX IF NOT EXISTS idx_jobs_payload_publish_date
  ON editorial_jobs ((payload_json->>'publish_date'));
CREATE INDEX IF NOT EXISTS idx_jobs_type_status
  ON editorial_jobs (job_type, status);
CREATE INDEX IF NOT EXISTS idx_jobs_payload_topic_id
  ON editorial_jobs ((payload_json->>'topic_id'));

CREATE TABLE IF NOT EXISTS editorial_refresh_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    article_id BIGINT NULL,
    freshness_score DECIMAL(6, 2) NULL,
    strategy VARCHAR(32) NOT NULL,
    blocks_patched INT NOT NULL DEFAULT 0,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    detail_json JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_created ON editorial_refresh_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_refresh_article ON editorial_refresh_logs (article_id);
