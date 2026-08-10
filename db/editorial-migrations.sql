-- Additive column migrations for Editorial Engine (safe to re-run via bootstrap).

-- P0b/P1
-- editorial_prompt_templates.category
-- editorial_content_types.prompt_key / schema_type
-- editorial_generation_logs writer/reviewer prompt versions
-- editorial_clusters.kind

-- P1b/P2
-- editorial_strategy_settings (new table)
-- editorial_content_gaps (new table)
-- editorial_topic_scores.breakdown_json
-- editorial_topics.locked / locked_at / locked_reason
-- editorial_clusters.level_kind / depth / path
-- editorial_calendar.schedule_source / locked / locked_at / locked_by / skip_reason
