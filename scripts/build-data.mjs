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
import './load-env.mjs'; // 读 .env.local / .env（DATA_SOURCE / DATA_API_URL 等）
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SOURCE_PATH = resolve(ROOT, 'data/catalog.json');
// 三层数据（data-contract.md §4「回填层」的落地实现）：
//   catalog(来源事实/派生缺省) < enrichments(可发布 AI 产物) < editorial(人工覆盖)。
// 两个覆盖目录不存在或为空时，合并是空操作，输出与纯 catalog 派生字节一致。
const ENRICH_DIR = resolve(ROOT, 'data/enrichments');
const EDITORIAL_DIR = resolve(ROOT, 'data/editorial');
// 会议级信号聚合（知识层）：data/digests/<conferenceId>.json，缺省则站点不渲染该区。
const DIGEST_DIR = resolve(ROOT, 'data/digests');
const OUTPUT_PATH = resolve(ROOT, 'src/data/dataset.json');
// 英文数据集：与中文同构，散文字段替换为 data/i18n/en/ 里的英文渲染结果。
// 站点按 locale 取用（见 src/lib/loader.ts）；缺失字段逐条回落中文。
const I18N_EN_DIR = resolve(ROOT, 'data/i18n/en');
const OUTPUT_EN_PATH = resolve(ROOT, 'src/data/dataset.en.json');
const DATASET_VERSION = 1;

// ---------------------------------------------------------------------------
// 可插拔数据源（方案 A：构建期读取，站点保持纯静态导出）
// ---------------------------------------------------------------------------
//   DATA_SOURCE=file （默认）本地 JSON —— 开发 / CI / 离线可复现构建。
//   DATA_SOURCE=api  构建期从 DATA_API_URL 拉取 —— 生产：数据在 DB，CRUD 改动后
//                    触发重建即可，站点仍是静态资源（无服务器、可 CDN）。
// api 端点须返回 { catalog: [...], enrichments: {id:{...}}, editorial: {id:{...}} }，
// 与 file 源同形；因此 DB 选型对本脚本透明（Postgres/SQLite/Supabase 皆可，
// 由你的 CRUD 服务负责查询与序列化）。
const DATA_SOURCE = process.env.DATA_SOURCE || 'file';
const DATA_API_URL = process.env.DATA_API_URL || '';
const DATA_API_TOKEN = process.env.DATA_API_TOKEN || '';

// 发布开关：数据库/本地配置控制「站点实际渲染哪些内容」，与清洗进度解耦。
//   publish.conferences[id] === true   → 该会议已发布（缺省/false = 整会议隐藏）
//   publish.sessions[videoId] === true → 该场已发布
// 规则：publish 整体缺省 → 全部发布（开发默认）；
//       给了 conferences 但没给 sessions → 已发布会议下的场次全发布；
//       给了 sessions → 只发布显式为 true 的场次。
const PUBLISH_PATH = resolve(ROOT, 'data/publish.json');

/** 读取数据源 → { catalog: [], enrichments: Map, editorial: Map, publish }。 */
async function readSource(warnings) {
  if (DATA_SOURCE === 'api') return readFromApi(warnings);
  if (DATA_SOURCE !== 'file') {
    throw new Error(`未知 DATA_SOURCE="${DATA_SOURCE}"（可选 file | api）`);
  }
  let publish = null;
  if (existsSync(PUBLISH_PATH)) {
    try {
      publish = JSON.parse(readFileSync(PUBLISH_PATH, 'utf8'));
    } catch (e) {
      warnings.push(`data/publish.json 无法解析，按「全部发布」处理（${e.message}）`);
    }
  }
  return {
    catalog: JSON.parse(readFileSync(SOURCE_PATH, 'utf8')),
    enrichments: loadOverrides(ENRICH_DIR, warnings),
    editorial: loadOverrides(EDITORIAL_DIR, warnings),
    publish,
  };
}

/** 依据 publish 配置判断某场是否应出现在站点。publish 为空 → 全部发布。 */
function makePublishFilter(publish) {
  if (!publish || typeof publish !== 'object') return () => true;
  const confs = publish.conferences && typeof publish.conferences === 'object' ? publish.conferences : null;
  const sess = publish.sessions && typeof publish.sessions === 'object' ? publish.sessions : null;
  return (session) => {
    if (confs && confs[session.conferenceId] !== true) return false;
    if (sess) return sess[session.id] === true;
    return true;
  };
}

/** 构建期从 CRUD API 拉取（Node 内置 fetch，无第三方依赖）。 */
async function readFromApi(warnings) {
  if (!DATA_API_URL) throw new Error('DATA_SOURCE=api 需同时设置 DATA_API_URL');
  const headers = { accept: 'application/json' };
  if (DATA_API_TOKEN) headers.authorization = `Bearer ${DATA_API_TOKEN}`;

  const res = await fetch(DATA_API_URL, { headers });
  if (!res.ok) throw new Error(`数据 API ${res.status} ${res.statusText}: ${DATA_API_URL}`);
  const payload = await res.json();

  if (!Array.isArray(payload.catalog)) {
    throw new Error('数据 API 响应缺少 catalog 数组');
  }
  const toMap = (obj, label) => {
    const m = new Map();
    if (!obj) return m;
    if (typeof obj !== 'object') {
      warnings.push(`数据 API 的 ${label} 非对象，已忽略`);
      return m;
    }
    for (const [id, v] of Object.entries(obj)) m.set(id, v);
    return m;
  };
  console.log(
    `[build-data] 数据源 api: ${payload.catalog.length} 条 catalog，` +
      `${Object.keys(payload.enrichments || {}).length} 条 enrichment`,
  );
  return {
    catalog: payload.catalog,
    enrichments: toMap(payload.enrichments, 'enrichments'),
    editorial: toMap(payload.editorial, 'editorial'),
    // 发布开关由 DB 的 is_published 列派生（CRUD 服务负责序列化成此形状）。
    publish: payload.publish || null,
  };
}

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
    // 观看导览：清洗流水线产出，缺省 null（页面走详情降级）。
    tour: null,
    // 留存的关键画面：缺省空数组（页面不渲染画面区）。
    frames: [],
  };

  return { session, errors };
}

// ---------------------------------------------------------------------------
// 回填层：enrichments（AI 产物）/ editorial（人工覆盖）合并
// ---------------------------------------------------------------------------

/**
 * 读取覆盖目录 data/{enrichments|editorial}/*.json → Map(videoId → 覆盖对象)。
 * 目录不存在返回空 Map。文件名须为 <videoId>.json；坏 JSON 记 warning 并跳过，
 * 不阻塞构建（单个坏文件不该拖垮整站）。
 */
function loadOverrides(dir, warnings) {
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const videoId = name.slice(0, -'.json'.length);
    try {
      const obj = JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
      map.set(videoId, obj);
    } catch (e) {
      warnings.push(`${dir}/${name}: 无法解析 JSON，已跳过（${e.message}）`);
    }
  }
  return map;
}

/** 仅保留契约合法值的数组过滤器；非数组或含非法值 → 返回 null（视为不覆盖）。 */
function sanitizeEnumArray(v, allowed) {
  if (!Array.isArray(v)) return null;
  if (v.some((x) => !allowed.includes(x))) return null;
  return v;
}

/** 规范化 speakers 覆盖 → Speaker[]（{name, org}）。非法 → null。 */
function sanitizeSpeakers(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const s of v) {
    if (!s || typeof s.name !== 'string' || s.name.trim() === '') return null;
    out.push({ name: s.name.trim(), org: typeof s.org === 'string' && s.org.trim() ? s.org.trim() : null });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 中文正文引号规范化
//
// LLM 产出的中文正文一律用 ASCII 直引号（" 与 '），中文排版里应为全角引号。
// 按 GB/T 15834，中文以双引号「“”」为主，单引号「‘’」只用于引号内嵌套；实测数据中
// 不存在嵌套（无一条同时含两种引用型引号），故两种直引号统一转成 “”。
//
// 只作用于 enrichment / editorial / digest 这些「我们生成的正文」；catalog 是
// YouTube 源事实，一律不碰（会议名 "AI Engineer World's Fair" 就在其中）。
// ---------------------------------------------------------------------------

/** 英文撇号：字母'字母（World's / don't）—— 不是引号，不得转换。 */
const APOSTROPHE_RE = /(?<=[A-Za-z])'(?=[A-Za-z])/g;
/** 撇号占位符：JSON 文本不会出现 NUL，借它把撇号临时摘出配对计算。 */
const APOS_MARK = '\u0000';

/** 引号不闭合而跳过规范化的条数——宁可保留原样，也不靠猜配对改坏文本。 */
let unbalancedQuoteCount = 0;

/** 直引号 → 中文双引号，按出现顺序交替开合。撇号保留；数量为奇数则整串不动。 */
function normalizeQuotes(s) {
  if (typeof s !== 'string' || (!s.includes('"') && !s.includes("'"))) return s;
  const guarded = s.replace(APOSTROPHE_RE, APOS_MARK);
  const quotes = guarded.match(/["']/g);
  if (!quotes) return s;
  if (quotes.length % 2 !== 0) {
    unbalancedQuoteCount++;
    return s;
  }
  let open = true;
  const converted = guarded.replace(/["']/g, () => {
    const ch = open ? '“' : '”';
    open = !open;
    return ch;
  });
  return converted.replaceAll(APOS_MARK, "'");
}

/** 正文字段清洗：去空白 + 引号规范化。非字符串/空串 → null。 */
function prose(x) {
  if (typeof x !== 'string') return null;
  const t = x.trim();
  return t ? normalizeQuotes(t) : null;
}

/** 规范化 takeaways 覆盖 → Takeaway[]（投影到契约字段，丢弃 evidence/confidence 等站点不消费字段）。非法 → null。 */
function sanitizeTakeaways(v, sessionId) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const [i, tk] of v.entries()) {
    if (!tk || typeof tk.statement !== 'string' || tk.statement.trim() === '') return null;
    const id = typeof tk.id === 'string' && tk.id.trim() ? tk.id.trim() : `${sessionId}-tk${i + 1}`;
    const roles = sanitizeEnumArray(tk.roles, ROLES) || [];
    const ts =
      typeof tk.timestampSeconds === 'number' && tk.timestampSeconds >= 0 ? tk.timestampSeconds : null;
    out.push({
      id,
      sessionId,
      statement: prose(tk.statement),
      context: prose(tk.context),
      timestampSeconds: ts,
      roles,
    });
  }
  return out;
}

/**
 * 读取并规范化会议信号聚合。只接受 conferenceId 在契约内、signals 非空的 digest；
 * sources 仅保留真实存在的 session id（不让站点渲染死链）。
 */
function loadDigests(validSessionIds, warnings) {
  const out = [];
  if (!existsSync(DIGEST_DIR)) return out;
  for (const name of readdirSync(DIGEST_DIR).sort()) {
    if (!name.endsWith('.json')) continue;
    let d;
    try {
      d = JSON.parse(readFileSync(resolve(DIGEST_DIR, name), 'utf8'));
    } catch (e) {
      warnings.push(`digests/${name}: 无法解析 JSON，已跳过（${e.message}）`);
      continue;
    }
    const cid = d && d.conferenceId;
    if (!CONFERENCES_BY_ID.has(cid)) {
      warnings.push(`digests/${name}: conferenceId "${cid}" 不在契约内，忽略`);
      continue;
    }
    const signals = [];
    for (const s of Array.isArray(d.signals) ? d.signals : []) {
      if (!s || !isNonEmptyString(s.title) || !isNonEmptyString(s.statement)) continue;
      const sources = (Array.isArray(s.sources) ? s.sources : [])
        .filter((x) => x && validSessionIds.has(x.videoId))
        .map((x) => ({
          videoId: x.videoId,
          timestampSeconds:
            typeof x.timestampSeconds === 'number' && x.timestampSeconds >= 0 ? x.timestampSeconds : null,
        }));
      signals.push({
        title: prose(s.title) ?? '',
        statement: prose(s.statement) ?? '',
        whyItMatters: prose(s.whyItMatters) ?? '',
        sources,
      });
    }
    if (signals.length === 0) {
      warnings.push(`digests/${name}: 无有效 signal，忽略`);
      continue;
    }
    out.push({
      conferenceId: cid,
      talkCount: typeof d.talkCount === 'number' ? d.talkCount : 0,
      headline: prose(d.headline) ?? '',
      narrative: prose(d.narrative) ?? '',
      signals,
    });
  }
  return out;
}

const TOUR_MODES = ['watch', 'skim', 'listen'];
const FRAME_KINDS = ['slide', 'chart', 'code', 'demo_ui', 'mixed'];

/**
 * 规范化 frames 覆盖 → SessionFrame[]。
 * src 必须是站点内 /frames/ 下的相对路径（不接受外链，避免热链与混合内容）；
 * 逐条校验，非法条目跳过而非整组丢弃——少一张图不该让整场没有画面。
 */
function sanitizeFrames(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const f of v) {
    if (!f || typeof f.src !== 'string' || !f.src.startsWith('/frames/')) continue;
    if (typeof f.timestampSeconds !== 'number' || f.timestampSeconds < 0) continue;
    out.push({
      timestampSeconds: f.timestampSeconds,
      src: f.src,
      kind: FRAME_KINDS.includes(f.kind) ? f.kind : 'slide',
      caption: prose(f.caption) ?? '',
    });
  }
  return out;
}

/** 规范化 tour 覆盖 → Tour（严格投影；任一必填缺失/非法 → 返回 null 视为不覆盖）。 */
function sanitizeTour(v) {
  if (!v || typeof v !== 'object') return null;
  const str = prose; // 导览各字段均为正文（含 speaker 人名，撇号受保护）
  const num = (x) => (typeof x === 'number' && x >= 0 ? x : null);
  const hook = str(v.hook);
  if (!hook) return null; // 无钩子不成导览
  const mustWatch = [];
  for (const m of Array.isArray(v.mustWatch) ? v.mustWatch : []) {
    if (!m || num(m.startSeconds) === null || !str(m.label)) continue;
    mustWatch.push({
      startSeconds: m.startSeconds,
      endSeconds: num(m.endSeconds) ?? m.startSeconds,
      label: str(m.label),
      live: m.live === true,
      why: str(m.why) ?? '',
    });
  }
  const stops = [];
  for (const s of Array.isArray(v.stops) ? v.stops : []) {
    if (!s || num(s.startSeconds) === null || !str(s.title)) continue;
    stops.push({
      startSeconds: s.startSeconds,
      endSeconds: num(s.endSeconds) ?? s.startSeconds,
      title: str(s.title),
      what: str(s.what) ?? '',
      keyPoint: str(s.keyPoint) ?? '',
      howTo: TOUR_MODES.includes(s.howTo) ? s.howTo : 'watch',
      howToReason: str(s.howToReason) ?? '',
      speaker: str(s.speaker) ?? '',
    });
  }
  if (stops.length === 0) return null; // 无站点不成导览
  return {
    hook,
    whoShouldWatch: str(v.whoShouldWatch) ?? '',
    ifShortOnTime: str(v.ifShortOnTime) ?? '',
    mustWatch,
    stops,
  };
}

/**
 * 将一个覆盖对象（enrichment 或 editorial）应用到 session（就地字段级覆盖）。
 * 只认契约字段，逐字段校验；非法值忽略并记 warning，绝不让坏覆盖破坏 schema。
 * 优先级由调用顺序保证：先 enrichment 再 editorial（后者胜出）。
 */
function applyOverride(session, ov, source, warnings) {
  if (!ov || typeof ov !== 'object') return;
  const at = `${source}/${session.id}.json`;

  if ('topics' in ov) {
    const t = sanitizeEnumArray(ov.topics, TOPICS);
    if (t) session.topics = t;
    else warnings.push(`${at}: topics 非法（须为契约主题数组），忽略`);
  }
  if ('status' in ov) {
    if (STATUSES.includes(ov.status)) session.status = ov.status;
    else warnings.push(`${at}: status "${ov.status}" 非法，忽略`);
  }
  if ('roles' in ov) {
    const r = sanitizeEnumArray(ov.roles, ROLES);
    if (r) session.roles = r;
    else warnings.push(`${at}: roles 非法，忽略`);
  }
  if ('speakers' in ov) {
    const s = sanitizeSpeakers(ov.speakers);
    if (s) session.speakers = s;
    else warnings.push(`${at}: speakers 非法，忽略`);
  }
  if ('whyWatch' in ov) {
    if (ov.whyWatch === null || (typeof ov.whyWatch === 'string' && ov.whyWatch.trim())) {
      session.whyWatch = ov.whyWatch === null ? null : prose(ov.whyWatch);
    } else warnings.push(`${at}: whyWatch 须为非空字符串或 null，忽略`);
  }
  if ('takeaways' in ov) {
    const tks = sanitizeTakeaways(ov.takeaways, session.id);
    if (tks) session.takeaways = tks;
    else warnings.push(`${at}: takeaways 非法，忽略`);
  }
  if ('frames' in ov) {
    const fr = sanitizeFrames(ov.frames);
    if (fr) session.frames = fr;
    else warnings.push(`${at}: frames 非法，忽略`);
  }
  if ('tour' in ov) {
    const tour = sanitizeTour(ov.tour);
    if (tour) session.tour = tour;
    else warnings.push(`${at}: tour 非法或不完整，忽略`);
  }
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
  if (!Array.isArray(s.frames)) errors.push(`${at}: frames must be array`);
  if (s.tour !== null) {
    if (typeof s.tour !== 'object') errors.push(`${at}: tour must be object or null`);
    else if (!isNonEmptyString(s.tour.hook)) errors.push(`${at}: tour.hook required`);
    else if (!Array.isArray(s.tour.stops) || s.tour.stops.length === 0)
      errors.push(`${at}: tour.stops must be non-empty array`);
  }
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
/** 由数据源产出 dataset（source 形状见 readSource：catalog / enrichments / editorial）。 */
function build(source, overrideWarnings) {
  const raw = source.catalog;
  if (!Array.isArray(raw)) throw new Error('catalog 必须是数组');

  // 回填层：enrichments / editorial 覆盖（为空 → 纯 catalog 派生）。
  const enrichments = source.enrichments;
  const editorial = source.editorial;

  const sessions = [];
  const dropped = [];
  for (const [i, rec] of raw.entries()) {
    const { session, errors } = normalizeRecord(rec, i);
    if (!session) {
      dropped.push({ index: i, errors });
      continue;
    }
    // 合并优先级：catalog 派生（session 现值） < enrichment < editorial。
    applyOverride(session, enrichments.get(session.id), 'enrichments', overrideWarnings);
    applyOverride(session, editorial.get(session.id), 'editorial', overrideWarnings);
    sessions.push(session);
  }

  // 发布过滤：站点只渲染已发布内容（发布范围由 DB/publish.json 控制，与清洗进度解耦）。
  const isPublished = makePublishFilter(source.publish);
  const beforeCount = sessions.length;
  const published = sessions.filter(isPublished);
  if (published.length !== beforeCount) {
    console.log(`[build-data] 发布过滤: ${published.length}/${beforeCount} 场进入站点`);
  }
  if (unbalancedQuoteCount > 0) {
    overrideWarnings.push(
      `引号不闭合 ${unbalancedQuoteCount} 条，已保留原样未规范化（需人工检查原文）`,
    );
  }
  sessions.length = 0;
  sessions.push(...published);

  // 会议信号聚合（知识层）：sources 只保留真实 session，避免死链。
  // 已发布场次为空的会议，其 digest 一并隐藏。
  const digests = loadDigests(new Set(sessions.map((s) => s.id)), overrideWarnings).filter((d) =>
    sessions.some((s) => s.conferenceId === d.conferenceId),
  );

  // 覆盖告警走 stderr（不进 dataset.json，避免污染漂移比对）。
  for (const w of overrideWarnings) console.error(`[build-data] 覆盖告警: ${w}`);

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
    generatedFrom: DATA_SOURCE === 'api' ? `api:${DATA_API_URL}` : 'data/catalog.json',
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
    digests,
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
// 英文数据集（locale=en）
// ---------------------------------------------------------------------------

/** 读 data/i18n/en/<videoId>.json → Map(videoId → { path串: 英文 })。 */
function loadEnFields(warnings) {
  const m = new Map();
  if (!existsSync(I18N_EN_DIR)) return m;
  for (const name of readdirSync(I18N_EN_DIR)) {
    if (!name.endsWith('.json')) continue;
    try {
      const payload = JSON.parse(readFileSync(resolve(I18N_EN_DIR, name), 'utf8'));
      const fields = payload && typeof payload.fields === 'object' ? payload.fields : null;
      if (fields) m.set(name.slice(0, -5), fields);
    } catch (e) {
      warnings.push(`i18n/en/${name}: 无法解析，忽略（${e.message}）`);
    }
  }
  return m;
}

/**
 * 由中文数据集派生英文数据集。
 *
 * 逐字段替换：英文缺失（渲染失败/模型留空）时**保留中文原文**——页面上出现中文
 * 比出现空白或编造内容诚实。结构（时间戳、条目数、模式、关键帧）完全不变，
 * 故中英两版严格对齐，切换语言落在同一段、同一时刻。
 */
function buildEnDataset(ds, enByVideo) {
  const pick = (fields, path, zh) => {
    const v = fields ? fields[path] : undefined;
    return typeof v === 'string' && v.trim() ? v : zh;
  };
  const sessions = ds.sessions.map((s) => {
    const f = enByVideo.get(s.id);
    if (!f) return s;
    const tour = s.tour
      ? {
          ...s.tour,
          hook: pick(f, 'tour/hook', s.tour.hook),
          whoShouldWatch: pick(f, 'tour/whoShouldWatch', s.tour.whoShouldWatch),
          ifShortOnTime: pick(f, 'tour/ifShortOnTime', s.tour.ifShortOnTime),
          mustWatch: s.tour.mustWatch.map((m, i) => ({
            ...m,
            label: pick(f, `tour/mustWatch/${i}/label`, m.label),
            why: pick(f, `tour/mustWatch/${i}/why`, m.why),
          })),
          stops: s.tour.stops.map((st, i) => ({
            ...st,
            title: pick(f, `tour/stops/${i}/title`, st.title),
            what: pick(f, `tour/stops/${i}/what`, st.what),
            keyPoint: pick(f, `tour/stops/${i}/keyPoint`, st.keyPoint),
            howToReason: pick(f, `tour/stops/${i}/howToReason`, st.howToReason),
          })),
        }
      : s.tour;
    return {
      ...s,
      whyWatch: s.whyWatch === null ? null : pick(f, 'whyWatch', s.whyWatch),
      takeaways: s.takeaways.map((tk, i) => ({
        ...tk,
        statement: pick(f, `takeaways/${i}/statement`, tk.statement),
        context: tk.context === null ? null : pick(f, `takeaways/${i}/context`, tk.context),
      })),
      frames: s.frames.map((fr, i) => ({
        ...fr,
        caption: pick(f, `frames/${i}/caption`, fr.caption),
      })),
      tour,
    };
  });
  // digest 是会议级（非按视频），英文版存 _digest-<conferenceId>.json。
  const digests = ds.digests.map((d) => {
    const f = enByVideo.get(`_digest-${d.conferenceId}`);
    if (!f) return d;
    return {
      ...d,
      headline: pick(f, 'headline', d.headline),
      narrative: pick(f, 'narrative', d.narrative),
      signals: d.signals.map((sig, i) => ({
        ...sig,
        title: pick(f, `signals/${i}/title`, sig.title),
        statement: pick(f, `signals/${i}/statement`, sig.statement),
        whyItMatters: pick(f, `signals/${i}/whyItMatters`, sig.whyItMatters),
      })),
    };
  });
  return { ...ds, sessions, digests };
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
async function main() {
  // --verify：只生成 + 全量 schema 校验，不写盘（供 CI 校验数据源是否健康）。
  // dataset.json 是构建产物、不入库，故不再做「与已提交文件的漂移比对」。
  const verify = process.argv.includes('--verify');

  const overrideWarnings = [];
  const source = await readSource(overrideWarnings);
  const ds = build(source, overrideWarnings);

  const validationErrors = validateDataset(ds);
  if (validationErrors.length > 0) {
    console.error(`[build-data] schema validation FAILED (${validationErrors.length} error(s)):`);
    for (const e of validationErrors.slice(0, 25)) console.error('  - ' + e);
    process.exit(1);
  }

  if (verify) {
    console.log(
      `[build-data] --verify OK (源=${DATA_SOURCE}): ${ds.stats.totalSessions} sessions, ` +
        `${ds.stats.totalHours}h, schema valid.`,
    );
    return;
  }

  // dataset.json 不入库，全新 checkout 里 src/data/ 目录可能不存在 → 先建目录。
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(ds, null, 2) + '\n');
  console.log(
    `[build-data] wrote src/data/dataset.json (源=${DATA_SOURCE}): ${ds.stats.totalSessions} sessions, ` +
      `${ds.stats.totalHours}h, deepRead=${ds.stats.deepReadCount}.`,
  );

  // 英文数据集：i18n/en 尚未产出时也要写，内容等同中文（站点 /en 不至于 404）。
  const enByVideo = loadEnFields(overrideWarnings);
  const dsEn = buildEnDataset(ds, enByVideo);
  writeFileSync(OUTPUT_EN_PATH, JSON.stringify(dsEn, null, 2) + '\n');
  const covered = ds.sessions.filter((s) => enByVideo.has(s.id)).length;
  console.log(
    `[build-data] wrote src/data/dataset.en.json: ${covered}/${ds.sessions.length} 场有英文渲染` +
      `${covered < ds.sessions.length ? '（其余逐字段回落中文）' : ''}`,
  );
  console.log(
    '[build-data] topic approx counts: ' +
      ds.stats.topicCounts.map((t) => `${t.topic}=${t.approxCount}`).join(' · '),
  );
}

main().catch((err) => {
  console.error(`[build-data] 失败: ${err.message}`);
  process.exit(1);
});
