import type { ResultSetHeader, RowDataPacket } from '../../db.js';
import { pool } from '../../db.js';
import {
  CATEGORY_PROMPT_SEEDS,
  CONTENT_TYPE_SEEDS,
  MASTER_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
} from '../constants.js';
import type { PromptCategory, PromptTemplate } from '../types.js';

function mapRow(row: RowDataPacket): PromptTemplate {
  return {
    id: Number(row.id),
    prompt_key: String(row.prompt_key),
    category: (String(row.category || 'Writer') as PromptCategory),
    version: Number(row.version),
    title: String(row.title),
    body: String(row.body),
    is_active: Boolean(row.is_active),
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

export async function ensureDefaultPrompts(): Promise<void> {
  if (!pool) return;
  for (const seed of CATEGORY_PROMPT_SEEDS) {
    let body = seed.body;
    if (seed.prompt_key === 'master_system') body = MASTER_SYSTEM_PROMPT;
    if (seed.prompt_key === 'reviewer_system') body = REVIEWER_SYSTEM_PROMPT;
    await ensurePrompt(seed.prompt_key, seed.category, seed.title, body);
  }
  for (const ct of CONTENT_TYPE_SEEDS) {
    await ensurePrompt(
      ct.prompt_key,
      'Writer',
      `${ct.display_name} Type Prompt`,
      `You are writing a CityCost ${ct.display_name} (${ct.type_key}). Follow the master system prompt, content-type structure, SEO rules, and quality rules. Schema type: ${ct.schema_type}. Use only supplied structured data. Produce original, practical, evergreen guidance with clear information gain over existing tool pages.`
    );
  }

  const master = await getActivePrompt('master_system');
  if (
    master &&
    !master.body.includes('You are the Senior Editorial Team for CityCost.online')
  ) {
    await updatePromptBody('master_system', MASTER_SYSTEM_PROMPT, 'Master Prompt');
  }

  const reviewer = await getActivePrompt('reviewer_system');
  if (reviewer && !reviewer.body.includes('NEVER rewrite, revise, expand, or regenerate')) {
    await updatePromptBody('reviewer_system', REVIEWER_SYSTEM_PROMPT, 'Reviewer System Prompt', 'Reviewer');
  }
}

async function ensurePrompt(
  key: string,
  category: PromptCategory,
  title: string,
  body: string
): Promise<void> {
  if (!pool) return;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, category FROM editorial_prompt_templates WHERE prompt_key = $1 LIMIT 1`,
    [key]
  );
  if (rows[0]) {
    if (!rows[0].category) {
      await pool.execute(
        `UPDATE editorial_prompt_templates SET category = $1 WHERE prompt_key = $2`,
        [category, key]
      );
    }
    return;
  }
  await pool.execute<ResultSetHeader>(
    `INSERT INTO editorial_prompt_templates (prompt_key, category, version, title, body, is_active)
     VALUES ($1, $2, 1, $3, $4, TRUE)`,
    [key, category, title, body]
  );
}

export async function getActivePrompt(promptKey: string): Promise<PromptTemplate | null> {
  if (!pool) return null;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, prompt_key, category, version, title, body, is_active, created_at, updated_at
     FROM editorial_prompt_templates
     WHERE prompt_key = $1 AND is_active = TRUE
     ORDER BY version DESC
     LIMIT 1`,
    [promptKey]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listPromptsByCategory(category?: PromptCategory): Promise<PromptTemplate[]> {
  if (!pool) return [];
  if (category) {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, prompt_key, category, version, title, body, is_active, created_at, updated_at
       FROM editorial_prompt_templates
       WHERE is_active = TRUE AND category = $1
       ORDER BY prompt_key ASC`,
      [category]
    );
    return rows.map(mapRow);
  }
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, prompt_key, category, version, title, body, is_active, created_at, updated_at
     FROM editorial_prompt_templates
     WHERE is_active = TRUE
     ORDER BY category ASC, prompt_key ASC`
  );
  return rows.map(mapRow);
}

export async function updatePromptBody(
  promptKey: string,
  body: string,
  title?: string,
  category?: PromptCategory
): Promise<PromptTemplate> {
  if (!pool) throw new Error('Database unavailable');
  if (!body || body.trim().length < 40) {
    throw new Error('Prompt body is too short');
  }
  const current = await getActivePrompt(promptKey);
  const nextVersion = (current?.version || 0) + 1;
  const nextTitle = title?.trim() || current?.title || promptKey;
  const nextCategory = category || current?.category || 'Writer';

  await pool.execute(
    `UPDATE editorial_prompt_templates SET is_active = FALSE WHERE prompt_key = $1`,
    [promptKey]
  );
  await pool.execute<ResultSetHeader>(
    `INSERT INTO editorial_prompt_templates (prompt_key, category, version, title, body, is_active)
     VALUES ($1, $2, $3, $4, $5, TRUE)`,
    [promptKey, nextCategory, nextVersion, nextTitle, body.trim()]
  );

  const created = await getActivePrompt(promptKey);
  if (!created) throw new Error('Failed to load updated prompt');
  return created;
}
