-- CityCost Global - Database Schema
-- Version 2.0 — COL engine (verified cache, metadata, FX)

CREATE DATABASE IF NOT EXISTS citycost_global CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE citycost_global;

-- Countries (future-ready reference)
CREATE TABLE IF NOT EXISTS countries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    country_code CHAR(2) NOT NULL,
    country_name VARCHAR(255) NOT NULL,
    currency_code VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_country_code (country_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- States / regions
CREATE TABLE IF NOT EXISTS states (
    id INT AUTO_INCREMENT PRIMARY KEY,
    country_code CHAR(2) NOT NULL,
    state_name VARCHAR(255) NOT NULL,
    cost_factor DECIMAL(6,3) DEFAULT 1.000,
    housing_factor DECIMAL(6,3) DEFAULT 1.000,
    income_factor DECIMAL(6,3) DEFAULT 1.000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_country_state (country_code, state_name),
    INDEX idx_country (country_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Exchange rates (local units per 1 USD)
CREATE TABLE IF NOT EXISTS exchange_rates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    currency_code VARCHAR(10) NOT NULL,
    rate_to_usd DECIMAL(18,6) NOT NULL,
    source VARCHAR(64) DEFAULT 'static',
    as_of DATE NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_currency (currency_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cities (main metadata + COL provenance)
CREATE TABLE IF NOT EXISTS cities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    city_name VARCHAR(255) NOT NULL,
    country VARCHAR(255) NOT NULL,
    state VARCHAR(255) NULL,
    country_code CHAR(2) NULL,
    currency VARCHAR(10) NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    exchange_rate DECIMAL(10, 4) NOT NULL DEFAULT 1.0000,
    tier TINYINT NULL,
    population BIGINT NULL,
    latitude DECIMAL(10,6) NULL,
    longitude DECIMAL(10,6) NULL,
    data_source VARCHAR(64) NULL,
    confidence DECIMAL(4,3) NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    is_ai_generated BOOLEAN DEFAULT FALSE,
    estimation_note TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_city_country (city_name, country),
    INDEX idx_country (country),
    INDEX idx_country_code (country_code),
    INDEX idx_verified (is_verified),
    UNIQUE KEY uk_city_country (city_name, country)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Indices (legacy frontend shape)
CREATE TABLE IF NOT EXISTS city_indices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    city_id INT NOT NULL,
    cpi_index DECIMAL(6, 2) NOT NULL,
    rent_index DECIMAL(6, 2) NOT NULL,
    groceries_index DECIMAL(6, 2) NOT NULL,
    restaurant_price_index DECIMAL(6, 2) NOT NULL,
    local_purchasing_power_index DECIMAL(6, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE CASCADE,
    UNIQUE KEY uk_city (city_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Category indices (Layer 7)
CREATE TABLE IF NOT EXISTS city_category_indices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    city_id INT NOT NULL,
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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE CASCADE,
    UNIQUE KEY uk_city_cat (city_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Price items
CREATE TABLE IF NOT EXISTS city_prices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    city_id INT NOT NULL,
    item_id INT NOT NULL,
    item_name VARCHAR(500) NOT NULL,
    average_price DECIMAL(12, 2) NOT NULL,
    highest_price DECIMAL(12, 2) NOT NULL,
    lowest_price DECIMAL(12, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    category VARCHAR(64) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE CASCADE,
    INDEX idx_city_item (city_id, item_id),
    INDEX idx_item_id (item_id),
    UNIQUE KEY uk_city_item (city_id, item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historical snapshots
CREATE TABLE IF NOT EXISTS city_price_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    city_id INT NOT NULL,
    snapshot_date DATE NOT NULL,
    cpi_index DECIMAL(6,2) NULL,
    rent_index DECIMAL(6,2) NULL,
    data_source VARCHAR(64) NULL,
    payload JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE CASCADE,
    INDEX idx_city_date (city_id, snapshot_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ai_cache (
    id INT AUTO_INCREMENT PRIMARY KEY,
    query VARCHAR(500) NOT NULL,
    city_id INT NULL,
    cache_type ENUM('city_data', 'summary', 'comparison') NOT NULL,
    response JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL,
    INDEX idx_query_type (query, cache_type),
    INDEX idx_city_id (city_id),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comparison_cache (
    id INT AUTO_INCREMENT PRIMARY KEY,
    city_a_id INT NOT NULL,
    city_b_id INT NOT NULL,
    summary TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (city_a_id) REFERENCES cities(id) ON DELETE CASCADE,
    FOREIGN KEY (city_b_id) REFERENCES cities(id) ON DELETE CASCADE,
    INDEX idx_city_pair (city_a_id, city_b_id),
    UNIQUE KEY uk_city_pair (city_a_id, city_b_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS summary_cache (
    id INT AUTO_INCREMENT PRIMARY KEY,
    city_a VARCHAR(255) NOT NULL,
    city_b VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_city_pair (city_a, city_b)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    request_method VARCHAR(10) NULL,
    request_path VARCHAR(500) NULL,
    city_query VARCHAR(255) NULL,
    response_time_ms INT NULL,
    groq_token_usage INT NULL DEFAULT 0,
    groq_model_used VARCHAR(100) NULL,
    error_message TEXT NULL,
    cache_hit BOOLEAN DEFAULT FALSE,
    cache_type VARCHAR(50) NULL,
    ip_address VARCHAR(45) NULL,
    INDEX idx_timestamp (timestamp),
    INDEX idx_city_query (city_query),
    INDEX idx_cache_hit (cache_hit)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration helpers for existing v1 installs (safe to re-run where supported)
-- ALTER TABLE cities ADD COLUMN IF NOT EXISTS state VARCHAR(255) NULL;
-- ALTER TABLE cities ADD COLUMN IF NOT EXISTS country_code CHAR(2) NULL;
-- ALTER TABLE cities ADD COLUMN IF NOT EXISTS data_source VARCHAR(64) NULL;
-- ALTER TABLE cities ADD COLUMN IF NOT EXISTS confidence DECIMAL(4,3) NULL;
-- ALTER TABLE cities ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
-- ALTER TABLE cities ADD COLUMN IF NOT EXISTS tier TINYINT NULL;
-- ALTER TABLE cities ADD COLUMN IF NOT EXISTS population BIGINT NULL;
-- ALTER TABLE cities ADD COLUMN IF NOT EXISTS estimation_note TEXT NULL;
