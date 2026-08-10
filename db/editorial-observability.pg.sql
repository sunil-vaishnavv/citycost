-- Additive observability hardening (P14).
-- Safe to re-run: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS throughout.

ALTER TABLE editorial_ai_usage_logs
  ADD COLUMN IF NOT EXISTS article_id BIGINT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_usage_article
  ON editorial_ai_usage_logs (article_id, created_at DESC);

-- Optional denormalized confidence on articles for fast admin list/header reads.
ALTER TABLE editorial_articles
  ADD COLUMN IF NOT EXISTS overall_confidence NUMERIC(6, 2) NULL;

ALTER TABLE editorial_articles
  ADD COLUMN IF NOT EXISTS confidence_level VARCHAR(32) NULL;

ALTER TABLE editorial_articles
  ADD COLUMN IF NOT EXISTS article_health VARCHAR(32) NULL;
