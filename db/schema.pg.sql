-- CityCost Global — PostgreSQL schema (COL core)
-- Apply: psql "$DATABASE_URL" -f db/schema.pg.sql
-- Does not include Editorial Engine tables.

CREATE TABLE IF NOT EXISTS countries (
    id SERIAL PRIMARY KEY,
    country_code CHAR(2) NOT NULL,
    country_name VARCHAR(255) NOT NULL,
    currency_code VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_country_code UNIQUE (country_code)
);

CREATE TABLE IF NOT EXISTS states (
    id SERIAL PRIMARY KEY,
    country_code CHAR(2) NOT NULL,
    state_name VARCHAR(255) NOT NULL,
    cost_factor DECIMAL(6,3) DEFAULT 1.000,
    housing_factor DECIMAL(6,3) DEFAULT 1.000,
    income_factor DECIMAL(6,3) DEFAULT 1.000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_country_state UNIQUE (country_code, state_name)
);
CREATE INDEX IF NOT EXISTS idx_states_country ON states (country_code);

CREATE TABLE IF NOT EXISTS exchange_rates (
    id SERIAL PRIMARY KEY,
    currency_code VARCHAR(10) NOT NULL,
    rate_to_usd DECIMAL(18,6) NOT NULL,
    source VARCHAR(64) DEFAULT 'static',
    as_of DATE NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_currency UNIQUE (currency_code)
);

CREATE TABLE IF NOT EXISTS cities (
    id SERIAL PRIMARY KEY,
    city_name VARCHAR(255) NOT NULL,
    country VARCHAR(255) NOT NULL,
    state VARCHAR(255) NULL,
    country_code CHAR(2) NULL,
    currency VARCHAR(10) NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    exchange_rate DECIMAL(10, 4) NOT NULL DEFAULT 1.0000,
    tier SMALLINT NULL,
    population BIGINT NULL,
    latitude DECIMAL(10,6) NULL,
    longitude DECIMAL(10,6) NULL,
    data_source VARCHAR(64) NULL,
    confidence DECIMAL(4,3) NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    is_ai_generated BOOLEAN DEFAULT FALSE,
    estimation_note TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_city_country UNIQUE (city_name, country)
);
CREATE INDEX IF NOT EXISTS idx_city_country ON cities (city_name, country);
CREATE INDEX IF NOT EXISTS idx_cities_country ON cities (country);
CREATE INDEX IF NOT EXISTS idx_cities_country_code ON cities (country_code);
CREATE INDEX IF NOT EXISTS idx_cities_verified ON cities (is_verified);

CREATE TABLE IF NOT EXISTS city_indices (
    id SERIAL PRIMARY KEY,
    city_id INT NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    cpi_index DECIMAL(6, 2) NOT NULL,
    rent_index DECIMAL(6, 2) NOT NULL,
    groceries_index DECIMAL(6, 2) NOT NULL,
    restaurant_price_index DECIMAL(6, 2) NOT NULL,
    local_purchasing_power_index DECIMAL(6, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_city_indices_city UNIQUE (city_id)
);

CREATE TABLE IF NOT EXISTS city_category_indices (
    id SERIAL PRIMARY KEY,
    city_id INT NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    housing DECIMAL(6,2) NOT NULL,
    groceries DECIMAL(6,2) NOT NULL,
    restaurants DECIMAL(6,2) NOT NULL,
    transport DECIMAL(6,2) NOT NULL,
    utilities DECIMAL(6,2) NOT NULL,
    healthcare DECIMAL(6,2) NOT NULL,
    education DECIMAL(6,2) NOT NULL,
    entertainment DECIMAL(6,2) NOT NULL,
    salary DECIMAL(6,2) NOT NULL,
    cpi DECIMAL(6,2) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_city_cat UNIQUE (city_id)
);

CREATE TABLE IF NOT EXISTS city_prices (
    id SERIAL PRIMARY KEY,
    city_id INT NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    item_id INT NOT NULL,
    item_name VARCHAR(500) NOT NULL,
    average_price DECIMAL(12, 2) NOT NULL,
    highest_price DECIMAL(12, 2) NOT NULL,
    lowest_price DECIMAL(12, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    category VARCHAR(64) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_city_item UNIQUE (city_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_city_item ON city_prices (city_id, item_id);
CREATE INDEX IF NOT EXISTS idx_item_id ON city_prices (item_id);

CREATE TABLE IF NOT EXISTS city_price_history (
    id BIGSERIAL PRIMARY KEY,
    city_id INT NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    snapshot_date DATE NOT NULL,
    cpi_index DECIMAL(6,2) NULL,
    rent_index DECIMAL(6,2) NULL,
    data_source VARCHAR(64) NULL,
    payload JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_city_date ON city_price_history (city_id, snapshot_date);

CREATE TABLE IF NOT EXISTS ai_cache (
    id SERIAL PRIMARY KEY,
    query VARCHAR(500) NOT NULL,
    city_id INT NULL,
    cache_type VARCHAR(32) NOT NULL CHECK (cache_type IN ('city_data', 'summary', 'comparison')),
    response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_cache_query_type ON ai_cache (query, cache_type);
CREATE INDEX IF NOT EXISTS idx_ai_cache_city_id ON ai_cache (city_id);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expires_at ON ai_cache (expires_at);

CREATE TABLE IF NOT EXISTS comparison_cache (
    id SERIAL PRIMARY KEY,
    city_a_id INT NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    city_b_id INT NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    summary TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_city_pair UNIQUE (city_a_id, city_b_id)
);
CREATE INDEX IF NOT EXISTS idx_comparison_city_pair ON comparison_cache (city_a_id, city_b_id);

CREATE TABLE IF NOT EXISTS summary_cache (
    id SERIAL PRIMARY KEY,
    city_a VARCHAR(255) NOT NULL,
    city_b VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_summary_city_pair ON summary_cache (city_a, city_b);

CREATE TABLE IF NOT EXISTS logs (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    request_method VARCHAR(10) NULL,
    request_path VARCHAR(500) NULL,
    city_query VARCHAR(255) NULL,
    response_time_ms INT NULL,
    groq_token_usage INT NULL DEFAULT 0,
    groq_model_used VARCHAR(100) NULL,
    error_message TEXT NULL,
    cache_hit BOOLEAN DEFAULT FALSE,
    cache_type VARCHAR(50) NULL,
    ip_address VARCHAR(45) NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs (timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_city_query ON logs (city_query);
CREATE INDEX IF NOT EXISTS idx_logs_cache_hit ON logs (cache_hit);
