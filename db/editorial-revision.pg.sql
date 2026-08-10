-- Additive P4.5 Self-Healing Revision Engine schema.
-- Safe to re-run: IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS editorial_revision_history (
    id BIGSERIAL PRIMARY KEY,
    article_id BIGINT NOT NULL,
    attempt INT NOT NULL DEFAULT 1,
    before_score NUMERIC(6, 2) NULL,
    after_score NUMERIC(6, 2) NULL,
    fixed_issues_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    remaining_issues_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    prompt_version VARCHAR(64) NULL,
    provider VARCHAR(64) NULL,
    model VARCHAR(128) NULL,
    tokens_in INT NULL,
    tokens_out INT NULL,
    duration_ms INT NULL,
    before_draft_json JSONB NULL,
    after_draft_json JSONB NULL,
    meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_revision_history_article
  ON editorial_revision_history (article_id, attempt ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_revision_history_created
  ON editorial_revision_history (created_at DESC);
