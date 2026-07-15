#!/usr/bin/env node
/**
 * build-data.mjs — 构建期数据规范化 + schema 校验（T1 数据契约 · AIO-28）。
 *
 * 职责：读取上游真实语料 data/catalog.json（941 场），规范化为站点消费的
 * 数据模型（见 docs/data-contract.md），派生统计口径与主题近似计数，写出
 * src/data/dataset.json。同时对每条记录做 schema 校验，字段缺失走降级而非报错。
 *
 * 两种模式（供 scripts/check 使用，纯构建期、无后端/无运行时抓取）：
 *   node scripts/build-data.mjs           # 生成并写出 src/data/dataset.json
 *   node scripts/build-data.mjs --verify  # 不写盘：重新生成 + 全量 schema 校验 +
 *                                         #   与已提交 dataset.json 做漂移比对，
 *                                         #   任一不通过即非零退出。
 *
 * 本模块是规范化与枚举取值的“单一事实来源”；docs/data-contract.md 是人读契约，
 * src/lib/schema.ts 是站点侧的 TS 类型镜像。三者须保持一致。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE_PATH = resolve(ROOT, 'data/catalog.json');
const OUTPUT_PATH = resolve(ROOT, 'src/data/dataset.json');
const DATASET_VERSION = 1;

// ---------------------------------------------------------------------------
// 契约枚举（对齐 design-spec §2.3）。此处是生成侧的权威取值集合。
// ---------------------------------------------------------------------------
const STATUSES = ['recommended', 'indexed', 'analyzing'];
const ROLES = ['developer', 'product-design', 'founder-lead', 'trend'];
const TOPICS = ['agent', 'ai-coding', 'evals', 'context', 'design-to-code', 'ai-product'];

// 三大会（design-spec §2.3 名称 + §3.2 色标）。officialUrl 取自语料 source_url。
const CONFERENCES = {
  ai_engineer_channel: {
    id: 'ai-engineer',
    name: "AI Engineer World's Fair",
    colorHex: '#2F5D50',
  },
  cursor_compile_2026: {
    id: 'cursor-compile',
    name: 'Cursor Compile',
    colorHex: '#3A3A3A',
  },
  figma_config_2026: {
    id: 'figma-config',
    name: 'Figma Config',
    colorHex: '#6B4E9E',
  },
};

// 主题近似分类关键词（标题子串命中，大小写不敏感；一场可命中多主题）。
// 这是“近似归类”，非精确编目——docs/data-contract.md 与 UI 均须以「约」标注。
// 正式主题标签由后续编辑流程回填，届时可覆盖此派生结果。
const TOPIC_KEYWORDS = {
  agent: ['agent', 'agentic', 'autonomous', 'multi-agent', 'swarm'],
  'ai-coding': [
    'coding', 'codegen', 'code', 'programming', 'copilot', 'cursor',
    'vibe cod', 'software eng', 'developer tool', ' ide ', 'pull request',
    'refactor', 'compiler',
  ],
  evals: ['eval', 'benchmark', 'evaluat', 'reliab', 'observab', 'tracing', 'regression test'],
  context: [
    'context', 'rag', 'retrieval', 'memory', 'embedding', 'vector',
    'knowledge base', 'long-context',
  ],
  'design-to-code': [
    'design', 'figma', 'frontend', 'ui/ux', 'prototyp', 'motion',
    'shader', 'creative', 'css', 'react',
  ],
  'ai-product': [
    'product', 'startup', 'founder', 'go-to-market', 'gtm', 'monetiz',
    'roadmap', 'enterprise', ' pm ', 'the new pm',
  ],
};

// ---------------------------------------------------------------------------
// 规范化
// ---------------------------------------------------------------------------

/** 标题关键词近似分类，返回命中的主题数组（可能为空）。 */
function classifyTopics(title) {
  const t = ` ${String(title || '').toLowerCase()} `;
  const hits = [];
  for (const topic of TOPICS) {
    if (TOPIC_KEYWORDS[topic].some((kw) => t.includes(kw))) hits.push(topic);
  }
  return hits;
}

/**
 * 将一条上游记录规范化为 Session。
 * 返回 { session, errors }。errors 非空表示该记录缺少不可降级的必填字段
 * （id / conference / officialUrl），此时 session 为 null——绝不编造。
 */
function normalizeRecord(raw, index) {
  const errors = [];
  const at = `record[${index}] (video_id=${raw && raw.video_id})`;

  const conference = CONFERENCES[raw && raw.source];
  if (!conference) errors.push(`${at}: unknown source "${raw && raw.source}", cannot map conference`);

  const id = raw && typeof raw.video_id === 'string' ? raw.video_id.trim() : '';
  if (!id) errors.push(`${at}: missing video_id`);

  const officialUrl = raw && typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!officialUrl) errors.push(`${at}: missing official url`);

  if (errors.length > 0) return { session: null, errors };

  // 可降级字段：缺失走 null / [] / 默认，不报错、不编造。
  const durationSeconds =
    typeof raw.duration === 'number' && raw.duration > 0 ? raw.duration : null;
  const durationMinutes = durationSeconds === null ? null : Math.round(durationSeconds / 60);
  const publishedDate =
    typeof raw.upload_date === 'string' && raw.upload_date.trim() !== ''
      ? raw.upload_date.trim()
      : null;
  const thumbnailUrl =
    typeof raw.thumbnail === 'string' && raw.thumbnail.trim() !== '' ? raw.thumbnail.trim() : null;

  const session = {
    id,
    title: typeof raw.title === 'string' ? raw.title.trim() : '',
    conferenceId: conference.id,
    officialUrl,
    sourceUrl: typeof raw.source_url === 'string' ? raw.source_url.trim() : '',
    playlistIndex: typeof raw.playlist_index === 'number' ? raw.playlist_index : null,
    durationSeconds,
    durationMinutes,
    publishedDate,
    thumbnailUrl,
    // 近似派生（标题关键词）。
    topics: classifyTopics(raw.title),
    // 默认状态：全部 indexed。recommended / analyzing 由后续编辑流程回填。
    status: 'indexed',
    // 编辑增值内容：当前为 0，模型允许缺省并优雅降级，不得编造。
    speakers: [], // 语料无可靠讲者字段（uploader 多为空/频道名），留空待真实标注。
    whyWatch: null,
    takeaways: [],
    roles: [],
  };

  return { session, errors };
}

// ---------------------------------------------------------------------------
// 校验（构建期 schema 校验；供 --verify 全量运行）
// ---------------------------------------------------------------------------
function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

/** 校验一条已规范化的 Session；返回错误信息数组（空数组即通过）。 */
function validateSession(s, index) {
  const errors = [];
  const at = `session[${index}] (id=${s && s.id})`;
  if (!isNonEmptyString(s.id)) errors.push(`${at}: id must be non-empty string`);
  if (typeof s.title !== 'string') errors.push(`${at}: title must be string (empty allowed)`);
  if (!CONFERENCES_BY_ID.has(s.conferenceId))
    errors.push(`${at}: conferenceId "${s.conferenceId}" not in contract`);
  if (!isNonEmptyString(s.officialUrl)) errors.push(`${at}: officialUrl required`);
  if (!STATUSES.includes(s.status)) errors.push(`${at}: invalid status "${s.status}"`);
  if (s.durationSeconds !== null && !(typeof s.durationSeconds === 'number' && s.durationSeconds > 0))
    errors.push(`${at}: durationSeconds must be positive number or null`);
  if (s.durationMinutes !== null && typeof s.durationMinutes !== 'number')
    errors.push(`${at}: durationMinutes must be number or null`);
  if (s.publishedDate !== null && !isNonEmptyString(s.publishedDate))
    errors.push(`${at}: publishedDate must be non-empty string or null`);
  if (s.whyWatch !== null && !isNonEmptyString(s.whyWatch))
    errors.push(`${at}: whyWatch must be non-empty string or null`);
  if (!Array.isArray(s.topics) || s.topics.some((t) => !TOPICS.includes(t)))
    errors.push(`${at}: topics must be array of contract topics`);
  if (!Array.isArray(s.roles) || s.roles.some((r) => !ROLES.includes(r)))
    errors.push(`${at}: roles must be array of contract roles`);
  if (!Array.isArray(s.speakers)) errors.push(`${at}: speakers must be array`);
  if (!Array.isArray(s.takeaways)) errors.push(`${at}: takeaways must be array`);
  for (const [ti, tk] of (s.takeaways || []).entries()) {
    if (!isNonEmptyString(tk.id)) errors.push(`${at}.takeaway[${ti}]: id required`);
    if (tk.sessionId !== s.id) errors.push(`${at}.takeaway[${ti}]: sessionId must match session id`);
    if (!isNonEmptyString(tk.statement)) errors.push(`${at}.takeaway[${ti}]: statement required`);
    if (tk.timestampSeconds !== null && typeof tk.timestampSeconds !== 'number')
      errors.push(`${at}.takeaway[${ti}]: timestampSeconds must be number or null`);
    if (!Array.isArray(tk.roles) || tk.roles.some((r) => !ROLES.includes(r)))
      errors.push(`${at}.takeaway[${ti}]: roles must be array of contract roles`);
  }
  return errors;
}

const CONFERENCES_BY_ID = new Set(Object.values(CONFERENCES).map((c) => c.id));

// ---------------------------------------------------------------------------
// 组装 dataset
// ---------------------------------------------------------------------------
function build() {
  const rawText = readFileSync(SOURCE_PATH, 'utf8');
  const raw = JSON.parse(rawText);
  if (!Array.isArray(raw)) throw new Error('catalog.json must be a JSON array');

  const sessions = [];
  const dropped = [];
  for (const [i, rec] of raw.entries()) {
    const { session, errors } = normalizeRecord(rec, i);
    if (session) sessions.push(session);
    else dropped.push({ index: i, errors });
  }

  // 统计口径（全部派生自真实语料，不写死占位数）。
  const totalDurationSeconds = sessions.reduce((sum, s) => sum + (s.durationSeconds || 0), 0);
  const totalHours = Math.round(totalDurationSeconds / 3600);
  const withDuration = sessions.filter((s) => s.durationSeconds !== null).length;
  const deepReadCount = sessions.filter((s) => s.whyWatch !== null).length;

  const byConferenceId = {};
  for (const s of sessions) byConferenceId[s.conferenceId] = (byConferenceId[s.conferenceId] || 0) + 1;

  const conferences = Object.values(CONFERENCES).map((c) => ({
    ...c,
    officialUrl:
      (raw.find((r) => CONFERENCES[r.source] && CONFERENCES[r.source].id === c.id) || {}).source_url || '',
    sessionCount: byConferenceId[c.id] || 0,
  }));

  const topicCounts = TOPICS.map((topic) => ({
    topic,
    approxCount: sessions.filter((s) => s.topics.includes(topic)).length,
    method: 'title-keyword',
  }));

  return {
    datasetVersion: DATASET_VERSION,
    generatedFrom: 'data/catalog.json',
    sourceRecordCount: raw.length,
    // 契约枚举镜像（供消费方/文档核对）。
    contract: { statuses: STATUSES, roles: ROLES, topics: TOPICS },
    stats: {
      totalSessions: sessions.length,
      totalDurationSeconds,
      totalHours,
      withDuration,
      // whyWatch 深度解读现为 0；UI 在此为 0 时显示「进行中」而非编造条数。
      deepReadCount,
      byConference: byConferenceId,
      topicCounts,
    },
    conferences,
    sessions,
    _droppedRecords: dropped, // 不可降级的坏记录（正常应为空）。
  };
}

// ---------------------------------------------------------------------------
// 校验整个 dataset（结构 + 逐条 schema + 已知不变量）
// ---------------------------------------------------------------------------
function validateDataset(ds) {
  const errors = [];
  if (ds.datasetVersion !== DATASET_VERSION)
    errors.push(`datasetVersion mismatch: ${ds.datasetVersion} != ${DATASET_VERSION}`);
  if (!Array.isArray(ds.sessions)) {
    errors.push('sessions must be an array');
    return errors;
  }
  const ids = new Set();
  ds.sessions.forEach((s, i) => {
    for (const e of validateSession(s, i)) errors.push(e);
    if (ids.has(s.id)) errors.push(`duplicate session id: ${s.id}`);
    ids.add(s.id);
  });
  if (Array.isArray(ds._droppedRecords) && ds._droppedRecords.length > 0)
    errors.push(`${ds._droppedRecords.length} record(s) dropped (missing required fields)`);
  // 不变量：总时长按小时四舍五入应与 stats.totalHours 一致。
  const recomputedHours = Math.round(ds.stats.totalDurationSeconds / 3600);
  if (recomputedHours !== ds.stats.totalHours)
    errors.push(`totalHours drift: stored ${ds.stats.totalHours} != recomputed ${recomputedHours}`);
  return errors;
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
function main() {
  const verify = process.argv.includes('--verify');
  const ds = build();

  const validationErrors = validateDataset(ds);
  if (validationErrors.length > 0) {
    console.error(`[build-data] schema validation FAILED (${validationErrors.length} error(s)):`);
    for (const e of validationErrors.slice(0, 25)) console.error('  - ' + e);
    process.exit(1);
  }

  const serialized = JSON.stringify(ds, null, 2) + '\n';

  if (verify) {
    let onDisk;
    try {
      onDisk = readFileSync(OUTPUT_PATH, 'utf8');
    } catch {
      console.error(
        '[build-data] --verify: src/data/dataset.json missing. Run `node scripts/build-data.mjs` and commit it.',
      );
      process.exit(1);
    }
    if (onDisk !== serialized) {
      console.error(
        '[build-data] --verify: src/data/dataset.json is stale (drift from data/catalog.json).\n' +
          '  Regenerate with `node scripts/build-data.mjs` and commit the result.',
      );
      process.exit(1);
    }
    console.log(
      `[build-data] --verify OK: ${ds.stats.totalSessions} sessions, ${ds.stats.totalHours}h, schema valid, no drift.`,
    );
    return;
  }

  writeFileSync(OUTPUT_PATH, serialized);
  console.log(
    `[build-data] wrote src/data/dataset.json: ${ds.stats.totalSessions} sessions, ` +
      `${ds.stats.totalHours}h, deepRead=${ds.stats.deepReadCount}.`,
  );
  console.log(
    '[build-data] topic approx counts: ' +
      ds.stats.topicCounts.map((t) => `${t.topic}=${t.approxCount}`).join(' · '),
  );
}

main();
