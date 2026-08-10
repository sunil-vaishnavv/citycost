-- Additive AI Provider Management schema (P8+).
-- Safe to re-run: IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS editorial_ai_settings (
    id BIGSERIAL PRIMARY KEY,
    provider_name VARCHAR(64) NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    priority INT NOT NULL DEFAULT 100,
    api_key_encrypted TEXT NULL,
    api_key_masked VARCHAR(64) NULL,
    default_model VARCHAR(128) NULL,
    temperature NUMERIC(4, 2) NOT NULL DEFAULT 0.45,
    top_p NUMERIC(4, 2) NOT NULL DEFAULT 0.9,
    max_output_tokens INT NOT NULL DEFAULT 8192,
    max_input_tokens INT NOT NULL DEFAULT 32000,
    context_window INT NOT NULL DEFAULT 128000,
    rpm_limit INT NULL,
    tpm_limit INT NULL,
    daily_limit INT NULL,
    monthly_limit INT NULL,
    fallback_provider VARCHAR(64) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'unknown',
    last_tested_at TIMESTAMPTZ NULL,
    last_used_at TIMESTAMPTZ NULL,
    last_error TEXT NULL,
    avg_latency_ms NUMERIC(12, 2) NULL,
    avg_cost_usd NUMERIC(12, 6) NULL,
    meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_ai_settings_enabled_priority
  ON editorial_ai_settings (enabled, priority ASC);

CREATE TABLE IF NOT EXISTS editorial_ai_usage_logs (
    id BIGSERIAL PRIMARY KEY,
    provider_name VARCHAR(64) NOT NULL,
    model VARCHAR(128) NULL,
    stage VARCHAR(64) NULL,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    latency_ms INT NULL,
    tokens_in INT NULL,
    tokens_out INT NULL,
    estimated_cost_usd NUMERIC(12, 6) NULL,
    error_message TEXT NULL,
    retry_count INT NOT NULL DEFAULT 0,
    meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON editorial_ai_usage_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON editorial_ai_usage_logs (provider_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_stage ON editorial_ai_usage_logs (stage, created_at DESC);
