import type { RichPart } from '../rich';

/**
 * 中文词典——唯一权威结构（en.ts 必须满足同一 Dictionary 类型，
 * 少翻一个 key 会在 tsc 阶段直接报错，不会静默漏译）。
 *
 * 只覆盖站点 UI 框架文案（按钮/标签/导航/空态提示）。演讲的钩子、观点、
 * 会议信号等由流水线 LLM 生成的中文正文不在此列——按范围约定不翻译，
 * 中英文界面下都展示同一份中文正文。
 *
 * 句中带 <b> 加粗强调的文案用 RichPart[] 而非模板字符串——见 rich.tsx。
 */
export const zh = {
  site: {
    name: 'AI Conference Compass',
    tagline: 'AI 大会观看导览',
    description:
      '把 AI 大会演讲扒成可读的观看导览：跨场信号、每场的钩子与必看片段、逐段告诉你该看画面还是听就够，全部配官方原片时间戳深链。',
    footerDisclaimer: (): readonly RichPart[] => [
      '本站是',
      { b: '第三方观看导览' },
      '，与 Cursor、Figma、AI Engineer 及各主办方',
      { b: '无隶属关系' },
      '。所有演讲版权归原作者与主办方所有；本站不托管、不播放视频，仅提供指向官方原片的时间戳链接。',
    ],
    footerMethod: (): readonly RichPart[] => [
      '导览由自动流水线生成（语音转写 → 结构化提炼 → 人工抽检），每条观点均可回指原片具体时刻。可能存在转写或归纳误差，',
      { b: '请以官方原片为准' },
      '。',
    ],
  },
  home: {
    eyebrow: 'AI 大会导览',
    lead: (): readonly RichPart[] => [
      '把 AI 大会演讲扒成可读的观看导览——一句话钩子、谁该看、时间不够看哪段、逐段告诉你该 ',
      { b: '看画面' },
      ' 还是 ',
      { b: '略读' },
      ' 或 ',
      { b: '听就够' },
      '，配官方原片时间戳深链。',
    ],
    sessionCount: (n: number) => `${n} 场演讲`,
    viewTour: '查看导览 →',
    archiveLine: (month: string) => `档案 · 更新至 ${month}`,
    headline: (n: number) => `${n} 场演讲，逐段标出值得看的那几分钟。`,
    subLead: '每场附逐段导览与必看片段，可直接跳到原片对应时间。',
    /** 引导页：不直接铺列表，先按「你是谁」或「哪场大会」分流。 */
    indexHeadline: '同一场大会，工程师、创始人、设计师该看的不是同几场。',
    indexLead: (confs: number, talks: number) =>
      `${confs} 场大会 ${talks} 场演讲，逐段读过一遍，按角色标好了谁该看哪几场、其中哪几分钟必须盯屏。`,
    howToHeading: '怎么用',
    howTo: [
      '选一场大会，或直接从下方角色入口进入',
      '列表按角色、主题、可用时间收窄到几条',
      '打开单场：读结论、读导览，或只跳看必看片段',
    ],
    enter: '进入 →',
    personaRelated: (n: number) => `${n} 场相关`,
    personaMins: (m: number) => `· 共 ${m} min 必看`,
  },
  /** 角色入口卡 / 角色页的文案（身份与 Role 枚举的映射见 src/lib/personas.ts）。 */
  personas: {
    engineer: {
      who: '应用层工程师',
      care: '别人在生产环境里踩过的坑，和能直接抄的做法',
    },
    founder: {
      who: '创始人 / 负责人',
      care: '技术拐点如何改变团队结构与产品判断',
    },
    designer: {
      who: '设计师',
      care: '生成能力变强之后，设计交付物和工作方式的变化',
    },
    trend: {
      who: '只想跟进趋势',
      care: '方向性的判断与争论，而不是逐行的实现细节',
    },
  },
  /** 角色浏览页（/for/{persona}）。 */
  personaPage: {
    eyebrow: (kicker: string) => `谁该看 · ${kicker}`,
    lead: (care: string) => `${care}，以下是三场大会里与你直接相关的部分。`,
    statTalks: '场相关',
    statMins: '分钟必看',
    statConfs: '场大会覆盖',
  },
  /** 会议页（/c/{id}）头部。 */
  confPage: {
    statTalks: '场演讲',
    statMustWatch: '场推荐必看',
    statHours: '小时总时长',
    themesHeading: '这场大会讲了什么',
  },
  /**
   * 首页选片器（facet 筛选 + 排序 + 结果行）。
   *
   * 这一组**全部是纯字符串**——SessionPicker 是客户端组件，函数不能跨
   * 服务端→客户端边界（React 会直接报错）。故需要插值的文案改用 {placeholder}
   * 占位符，由客户端做字符串替换；其余按行文案在服务端预先算好后传入。
   */
  picker: {
    facetConference: '会议',
    facetScene: '场景',
    facetRole: '谁该看',
    facetTopic: '主题',
    all: '全部',
    scenes: {
      commute: '通勤路上听',
      quick: '20 分钟内看完',
      deep: '值得认真看',
    },
    sorts: {
      shortestWatch: '必看最短',
      shortestTotal: '全片最短',
      conferenceOrder: '会议顺序',
    },
    resultLine: '当前 {shown} 场 / 共 {total} 场 · 橙点为未读',
    emptyState: '没有符合这些条件的场次。放宽任一条件试试。',
    whoLabel: '谁该看 · ',
    mustWatchMin: 'min 必看',
    fullLength: '全片 {m} min',
    modeCommute: '可当播客听',
    modeMixed: '半听半看',
    modeScreen: '需要盯屏',
  },
  breadcrumb: {
    home: '导览',
    ariaLabel: '面包屑',
  },
  hub: {
    eyebrow: '会议导览',
    lead: (n: number): readonly RichPart[] => [
      `${n} 场演讲。我们把每一场扒成观看导览——一句话钩子、谁该看、时间不够看哪段、逐段告诉你该 `,
      { b: '看画面' },
      ' 还是 ',
      { b: '略读' },
      ' 或 ',
      { b: '听就够' },
      '，配官方原片时间戳深链。',
    ],
    digestIntroHeading: '这届大会发生了什么',
    expandSignals: (n: number) => `展开 ${n} 个信号 ↓`,
    featuredHeading: (n: number) => `逐场导览 · ${n} 场`,
    allSessionsHeading: '全部场次',
    allSessionsHeadingWithProgress: '全部场次 · 导览整理中',
    digestSignalsHeading: (n: number) => `这届大会发生了什么 · ${n} 个信号`,
    whyItMatters: '为何重要',
    sources: '出处',
    tourBadge: '观看导览',
    proportion: (watch: number, skim: number, listen: number, mustWatch: number) =>
      `看 ${watch}% · 略 ${skim}% · 听 ${listen}%` + (mustWatch > 0 ? ` · ${mustWatch} 个必看点` : ''),
  },
  video: {
    notFoundTitle: '视频详情 · AI Conference 2026 Compass',
    defaultDescription: '在官方来源观看这场 AI 大会 session。本站不播放，仅跳转官方。',
    whyWatchAnalyzing: '深度解读整理中——本场正在解读，先看官方原片。',
    whyWatchPending: '编辑深度解读整理中，可先看官方原片。',
    durationUnknown: '时长未知',
    watchButton: '在官方来源观看 ↗',
    watchNote: '本站不播放，跳转官方来源观看。',
    whyWatchHeading: '为什么值得看',
    takeawaysHeading: '关键观点',
    relatedHeading: '相关推荐',
    officialVideo: '官方视频 ↗',
    officialChannel: '官方频道 ↗',
    watchSectionAriaLabel: '观看',
    metaAsideAriaLabel: '元信息',
    metaLabels: {
      conference: '大会',
      topic: '主题',
      duration: '时长',
      published: '发布日期',
      role: '角色适配',
      deepRead: '深度解读',
      source: '来源',
    },
    roleFallback: '整理中',
    nav: {
      mustWatch: '必看片段',
      frames: '关键画面',
      time: '时间分配',
      stops: '逐段导览',
      takeaways: '关键观点',
      ariaLabel: '导览分区',
    },
  },
  tour: {
    modeLabel: { watch: '看', skim: '略', listen: '听' },
    modeHint: {
      watch: '现场演示 / 值得盯屏',
      skim: '幻灯片图表 / 扫读即可',
      listen: '口头论述 / 听就够',
    },
    /** 三档阅读深度（详情页顶部 tab）。 */
    depth: {
      tldrLabel: '30 秒结论',
      tldrHint: (n: number) => `${n} 条关键观点`,
      readLabel: '3 分钟读完',
      readHint: '逐段导览 + 关键画面',
      watchLabel: '跳看原片',
      watchHint: (m: number) => `必看播放列表 ${m} min`,
      ariaLabel: '阅读深度',
    },
    legendMustWatch: (m: number) => `橙色 = 推荐必看的 ${m} 分钟`,
    legendRest: '其余读导览就够',
    segmentBarAria: '分段时间轴，点击跳到该段',
    playlistHeading: (n: number, m: number) => `必看播放列表 · ${n} 段 · 共 ${m} min`,
    playlistNote: '按顺序跳看，每段都给了为何必看',
    restHeading: '其余段落 · 可跳过',
    jump: '跳到',
    play: '▶ 播放',
    officialSourceHeading: '官方原片',
    ourAdvice: '我们的建议',
    adviceLine: (total: number, watch: number) =>
      `${total} 分钟里约 ${watch} 分钟需要盯屏，其余部分读导览即可。`,
    adviceCommute: '本片无明显视觉依赖，适合通勤时当播客听完。',
    notRecommended: '不适合',
    relatedHeading: '同主题的其他演讲',
    relatedWatchMin: (m: number) => `盯屏 ${m} min`,
    readerCount: (stops: number) => `逐段导览 · ${stops} 段`,
    mustWatchHeading: '必看片段 · 直接跳看',
    liveBadge: 'Live 实操',
    framesHeading: '关键画面 · 点击跳到该处',
    whoShouldWatch: '谁该看',
    timeAllocation: '全片时间怎么分',
    timeAllocationAria: '看/略/听时间占比',
    legendWatch: (t: string) => `看 ${t}`,
    legendSkim: (t: string) => `略读 ${t}`,
    legendListen: (t: string) => `听 ${t}`,
    shortOnTime: '时间不够？',
    stopsHeading: '逐段导览',
    keyPointLabel: '要点',
    jumpTo: (t: string) => `▶ 跳到 ${t}`,
    frameAlt: (t: string) => `原片 ${t} 处画面`,
    speaker: (name: string) => `讲者 · ${name}`,
    statFullLength: (m: number): readonly RichPart[] => ['全片 ', { b: `${m} 分钟` }],
    statWatchLength: (m: number): readonly RichPart[] => ['真正值得盯屏约 ', { b: `${m} 分钟` }],
    statMustWatch: (n: number): readonly RichPart[] => [{ b: String(n) }, ' 个必看点'],
  },
  videoCard: {
    durationUnknown: '时长未知',
    whyWatchPending: '编辑深度解读整理中 · 官方原片可直接观看',
    officialSource: '官方来源 ↗',
  },
  takeawayCard: {
    watchOfficialClip: '看官方片段 ↗',
    expandDetail: '展开视频详情',
  },
  status: {
    recommended: '推荐先看',
    indexed: '已收录',
    analyzing: '解读中',
  },
  topics: {
    agent: 'Agent',
    'ai-coding': 'AI 编程',
    evals: 'Evals',
    context: 'Context',
    'design-to-code': 'Design-to-Code',
    'ai-product': 'AI 产品',
  },
  roles: {
    developer: '开发者',
    'product-design': '产品 / 设计',
    'founder-lead': '创始人 / 负责人',
    trend: '只想跟进趋势',
  },
  loader: {
    untitledSession: '（未命名 session）',
    deepReadInProgress: '进行中',
  },
  languageSwitcher: {
    label: 'EN',
  },
};
// 注意：顶层不用 as const——那会把每个字符串窄化成字面量类型，导致 Dictionary
// 要求 en.ts 的每个值都和 zh.ts 逐字相等（"satisfies Dictionary" 直接报错）。
// 不加 as const，纯字符串属性正常推断为 string；对象结构（含 topics/roles/status
// 这类需要按枚举精确取键的 Record）与函数签名不受影响，键集合仍然精确。

export type Dictionary = typeof zh;
