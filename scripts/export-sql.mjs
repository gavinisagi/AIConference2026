#!/usr/bin/env node
/**
 * export-sql.mjs — 导出 PostgreSQL 建表 DDL + 全量种子数据（一次性执行）。
 *
 *   node scripts/export-sql.mjs > deploy/seed.sql
 *
 * 表结构对齐 docs/data-contract.md 与 pipeline/contracts/enrichment-contract.md：
 *   conferences  三大会（id/名称/色标）
 *   sessions     catalog 来源事实（941 场），主键 video_id
 *   enrichments  清洗产物（每场一行；嵌套结构走 JSONB）
 *   editorial    人工覆盖（稀疏，同形）
 *   digests      会议级信号聚合（每会议一行）
 *
 * 幂等：DDL 用 CREATE TABLE IF NOT EXISTS，数据用 ON CONFLICT DO UPDATE（可重复执行）。
 * 事务包裹：任一失败整体回滚。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CATALOG = resolve(ROOT, 'data/catalog.json');
const ENRICH_DIR = resolve(ROOT, 'data/enrichments');
const EDITORIAL_DIR = resolve(ROOT, 'data/editorial');
const DIGEST_DIR = resolve(ROOT, 'data/digests');

// 与 build-data.mjs CONFERENCES 保持一致（source key → 站点 conferenceId）。
const CONFERENCES = {
  ai_engineer_channel: { id: 'ai-engineer', name: "AI Engineer World's Fair", colorHex: '#2F5D50' },
  cursor_compile_2026: { id: 'cursor-compile', name: 'Cursor Compile', colorHex: '#3A3A3A' },
  figma_config_2026: { id: 'figma-config', name: 'Figma Config', colorHex: '#6B4E9E' },
};

/**
 * SQL 字符串字面量（单引号转义）。
 * 只有 null/undefined → NULL；**空串保留为 ''**——title 等列是 NOT NULL DEFAULT ''，
 * 把空串当 NULL 会违反非空约束（真实语料里确有空标题）。
 */
function q(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}
/** 数值；非法 → NULL。 */
function n(v) {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : 'NULL';
}
/** JSONB 字面量；空/未定义 → NULL。 */
function j(v) {
  if (v === null || v === undefined) return 'NULL';
  return `${q(JSON.stringify(v))}::jsonb`;
}

function readDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ id: f.slice(0, -5), data: JSON.parse(readFileSync(resolve(dir, f), 'utf8')) }));
}

const out = [];
const p = (s = '') => out.push(s);

// ---------------------------------------------------------------------------
p('-- AI Conference Compass — 建表 + 种子数据（PostgreSQL / Railway）');
p('-- 生成：node scripts/export-sql.mjs > deploy/seed.sql');
p('-- 幂等：可重复执行（CREATE IF NOT EXISTS + ON CONFLICT DO UPDATE）。');
p('');
p('BEGIN;');
p('');

// ---- DDL ------------------------------------------------------------------
p('-- =========================== 表结构 ===========================');
p(`
CREATE TABLE IF NOT EXISTS conferences (
  id            text PRIMARY KEY,              -- 'cursor-compile'
  source_key    text UNIQUE NOT NULL,          -- catalog 的 source 字段
  name          text NOT NULL,
  color_hex     text NOT NULL,
  official_url  text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 来源事实（catalog）：每场演讲一行。不含任何 AI 产物。
CREATE TABLE IF NOT EXISTS sessions (
  video_id       text PRIMARY KEY,             -- YouTube video_id，全局主键
  conference_id  text NOT NULL REFERENCES conferences(id) ON UPDATE CASCADE,
  title          text NOT NULL DEFAULT '',
  official_url   text NOT NULL,                -- 官方观看链接
  source_url     text,                         -- 频道/播放列表
  playlist_index integer,
  duration_sec   integer,                      -- NULL = 时长未知
  upload_date    text,
  thumbnail_url  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_conference_idx ON sessions(conference_id);

-- 清洗产物（流水线 AI 输出）：每场至多一行。嵌套结构走 JSONB，便于随契约演进。
CREATE TABLE IF NOT EXISTS enrichments (
  video_id      text PRIMARY KEY REFERENCES sessions(video_id) ON DELETE CASCADE,
  schema_ver    integer NOT NULL DEFAULT 1,
  topics        jsonb,                          -- Topic[]（null=不覆盖标题近似分类）
  roles         jsonb,                          -- Role[]
  speakers      jsonb,                          -- [{name, org}]（仅高置信推断）
  why_watch     text,
  takeaways     jsonb,                          -- [{id,statement,context,timestampSeconds,roles,...}]
  tour          jsonb,                          -- {hook,whoShouldWatch,ifShortOnTime,mustWatch,stops}
  summary       text,
  language      text,
  generated_by  jsonb,                          -- 溯源：pipelineVersion/asrProvider/llmModel
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 人工覆盖（编辑决策，优先级最高）：稀疏，只写要覆盖的字段。
CREATE TABLE IF NOT EXISTS editorial (
  video_id    text PRIMARY KEY REFERENCES sessions(video_id) ON DELETE CASCADE,
  status      text,                             -- recommended|indexed|analyzing
  why_watch   text,
  topics      jsonb,
  roles       jsonb,
  speakers    jsonb,
  takeaways   jsonb,
  tour        jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 会议级信号聚合（知识层）：每会议一行。
CREATE TABLE IF NOT EXISTS digests (
  conference_id text PRIMARY KEY REFERENCES conferences(id) ON DELETE CASCADE,
  talk_count    integer NOT NULL DEFAULT 0,
  headline      text,
  narrative     text,
  signals       jsonb NOT NULL,                 -- [{title,statement,whyItMatters,sources[]}]
  generated_by  jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
`);

// ---- conferences ----------------------------------------------------------
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
const officialBySource = {};
for (const r of catalog) {
  if (r.source && !officialBySource[r.source] && r.source_url) officialBySource[r.source] = r.source_url;
}
p('-- =========================== 大会 ===========================');
for (const [sourceKey, c] of Object.entries(CONFERENCES)) {
  p(
    `INSERT INTO conferences (id, source_key, name, color_hex, official_url) VALUES ` +
      `(${q(c.id)}, ${q(sourceKey)}, ${q(c.name)}, ${q(c.colorHex)}, ${q(officialBySource[sourceKey] || null)}) ` +
      `ON CONFLICT (id) DO UPDATE SET source_key=EXCLUDED.source_key, name=EXCLUDED.name, ` +
      `color_hex=EXCLUDED.color_hex, official_url=EXCLUDED.official_url, updated_at=now();`,
  );
}
p('');

// ---- sessions -------------------------------------------------------------
p(`-- =========================== 场次（${catalog.length} 条） ===========================`);
let skipped = 0;
for (const r of catalog) {
  const conf = CONFERENCES[r.source];
  if (!conf || !r.video_id || !r.url) {
    skipped++;
    continue; // 不可降级的必填缺失 → 不入库（与 build-data 的丢弃规则一致）
  }
  p(
    `INSERT INTO sessions (video_id, conference_id, title, official_url, source_url, playlist_index, duration_sec, upload_date, thumbnail_url) VALUES ` +
      `(${q(r.video_id)}, ${q(conf.id)}, ${q(r.title || '')}, ${q(r.url)}, ${q(r.source_url)}, ` +
      `${n(r.playlist_index)}, ${n(typeof r.duration === 'number' && r.duration > 0 ? Math.round(r.duration) : null)}, ` +
      `${q(r.upload_date)}, ${q(r.thumbnail)}) ` +
      `ON CONFLICT (video_id) DO UPDATE SET conference_id=EXCLUDED.conference_id, title=EXCLUDED.title, ` +
      `official_url=EXCLUDED.official_url, source_url=EXCLUDED.source_url, playlist_index=EXCLUDED.playlist_index, ` +
      `duration_sec=EXCLUDED.duration_sec, upload_date=EXCLUDED.upload_date, thumbnail_url=EXCLUDED.thumbnail_url, updated_at=now();`,
  );
}
p('');

// ---- enrichments ----------------------------------------------------------
const enrichments = readDir(ENRICH_DIR);
p(`-- =========================== 清洗产物（${enrichments.length} 场） ===========================`);
for (const { id, data: e } of enrichments) {
  p(
    `INSERT INTO enrichments (video_id, schema_ver, topics, roles, speakers, why_watch, takeaways, tour, summary, language, generated_by) VALUES ` +
      `(${q(id)}, ${n(e.schemaVersion ?? 1)}, ${j(e.topics ?? null)}, ${j(e.roles ?? [])}, ${j(e.speakers ?? [])}, ` +
      `${q(e.whyWatch)}, ${j(e.takeaways ?? [])}, ${j(e.tour ?? null)}, ${q(e.summary)}, ${q(e.language)}, ${j(e.generatedBy ?? null)}) ` +
      `ON CONFLICT (video_id) DO UPDATE SET schema_ver=EXCLUDED.schema_ver, topics=EXCLUDED.topics, roles=EXCLUDED.roles, ` +
      `speakers=EXCLUDED.speakers, why_watch=EXCLUDED.why_watch, takeaways=EXCLUDED.takeaways, tour=EXCLUDED.tour, ` +
      `summary=EXCLUDED.summary, language=EXCLUDED.language, generated_by=EXCLUDED.generated_by, updated_at=now();`,
  );
}
p('');

// ---- editorial ------------------------------------------------------------
const editorial = readDir(EDITORIAL_DIR);
p(`-- =========================== 人工覆盖（${editorial.length} 条） ===========================`);
for (const { id, data: d } of editorial) {
  p(
    `INSERT INTO editorial (video_id, status, why_watch, topics, roles, speakers, takeaways, tour) VALUES ` +
      `(${q(id)}, ${q(d.status)}, ${q(d.whyWatch)}, ${j(d.topics ?? null)}, ${j(d.roles ?? null)}, ` +
      `${j(d.speakers ?? null)}, ${j(d.takeaways ?? null)}, ${j(d.tour ?? null)}) ` +
      `ON CONFLICT (video_id) DO UPDATE SET status=EXCLUDED.status, why_watch=EXCLUDED.why_watch, topics=EXCLUDED.topics, ` +
      `roles=EXCLUDED.roles, speakers=EXCLUDED.speakers, takeaways=EXCLUDED.takeaways, tour=EXCLUDED.tour, updated_at=now();`,
  );
}
if (editorial.length === 0) p('-- （当前无人工覆盖）');
p('');

// ---- digests --------------------------------------------------------------
const digests = readDir(DIGEST_DIR);
p(`-- =========================== 会议信号（${digests.length} 个） ===========================`);
for (const { data: d } of digests) {
  p(
    `INSERT INTO digests (conference_id, talk_count, headline, narrative, signals, generated_by) VALUES ` +
      `(${q(d.conferenceId)}, ${n(d.talkCount ?? 0)}, ${q(d.headline)}, ${q(d.narrative)}, ${j(d.signals ?? [])}, ${j(d.generatedBy ?? null)}) ` +
      `ON CONFLICT (conference_id) DO UPDATE SET talk_count=EXCLUDED.talk_count, headline=EXCLUDED.headline, ` +
      `narrative=EXCLUDED.narrative, signals=EXCLUDED.signals, generated_by=EXCLUDED.generated_by, updated_at=now();`,
  );
}
p('');
p('COMMIT;');
p('');
p(`-- 汇总：${catalog.length - skipped} 场次 · ${enrichments.length} 清洗 · ${editorial.length} 覆盖 · ${digests.length} 信号` +
  (skipped ? ` · 跳过 ${skipped} 条必填缺失` : ''));

process.stdout.write(out.join('\n') + '\n');
