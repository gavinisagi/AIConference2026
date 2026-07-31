/**
 * buildPickerProps — 服务端把 Session[] + 词典压成 SessionPicker 的可序列化 props。
 *
 * 存在的理由：SessionPicker 是客户端组件，而词典里大量文案是插值函数，函数不能跨
 * 服务端→客户端边界。故所有「取哪个文案、算哪个派生值」都收在这里做完，
 * 客户端只收到纯字符串与数字。中英文两个首页共用本函数，口径不会分叉。
 */
import type { Session } from '@/lib/schema';
import { conferenceMeta } from '@/design/tokens';
import type { Dictionary } from '@/i18n/getDictionary';
import type { Locale } from '@/i18n/locale';
import { displayTitle } from '@/lib/loader';
import { matchesScene, watchShape, watchSplit, type Scene } from '@/lib/watchStats';
import type { FacetOption, PickerLabels, PickerRow } from './SessionPicker';

const SCENES: readonly Scene[] = ['commute', 'quick', 'deep'];

export interface PickerProps {
  rows: PickerRow[];
  totalCount: number;
  conferences: FacetOption[];
  scenes: FacetOption[];
  roles: FacetOption[];
  topics: FacetOption[];
  labels: PickerLabels;
}

export function buildPickerProps(
  sessions: readonly Session[],
  dict: Dictionary,
  locale: Locale,
): PickerProps {
  const rows: PickerRow[] = sessions.map((s) => {
    const split = watchSplit(s.tour);
    const shape = watchShape(split);

    // 「谁该看」优先用 audience 的结构化角色（更具体），无则回落契约 roles 枚举。
    const recommended = (s.tour?.audience ?? []).filter((a) => a.fit === 'recommended');
    const whoParts =
      recommended.length > 0
        ? recommended.slice(0, 2).map((a) => a.who)
        : s.roles.map((r) => dict.roles[r]);

    return {
      id: s.id,
      href: locale === 'en' ? `/en/video/${s.id}/` : `/video/${s.id}/`,
      hook: s.tour?.hook || displayTitle(s, dict),
      who: [s.speakers[0]?.name, conferenceMeta[s.conferenceId].label].filter(Boolean).join(' · '),
      roleText: whoParts.length > 0 ? dict.picker.whoLabel + whoParts.join(' / ') : '',
      topicLabels: s.topics.map((t) => dict.topics[t]),
      watchMinutes: split.watchMinutes,
      fullLengthText:
        s.durationMinutes !== null
          ? dict.picker.fullLength.replace('{m}', String(s.durationMinutes))
          : '',
      shapeLabel:
        shape === 'commute'
          ? dict.picker.modeCommute
          : shape === 'screen'
            ? dict.picker.modeScreen
            : dict.picker.modeMixed,
      conferenceId: s.conferenceId,
      roleKeys: s.roles,
      topicKeys: s.topics,
      sceneKeys: SCENES.filter((sc) => matchesScene(split, sc)),
      durationSeconds: s.durationSeconds ?? Number.MAX_SAFE_INTEGER,
      playlistIndex: s.playlistIndex ?? 9999,
    };
  });

  // facet 只列出这批数据里真实存在的取值，避免点了必然空结果的项。
  const presentConfs = [...new Set(sessions.map((s) => s.conferenceId))];
  const presentRoles = [...new Set(sessions.flatMap((s) => s.roles))];
  const presentTopics = [...new Set(sessions.flatMap((s) => s.topics))];

  return {
    rows,
    totalCount: sessions.length,
    conferences: presentConfs.map((c) => ({ value: c, label: conferenceMeta[c].label })),
    scenes: SCENES.map((s) => ({ value: s, label: dict.picker.scenes[s] })),
    roles: presentRoles.map((r) => ({ value: r, label: dict.roles[r] })),
    topics: presentTopics.map((t) => ({ value: t, label: dict.topics[t] })),
    labels: {
      facetConference: dict.picker.facetConference,
      facetScene: dict.picker.facetScene,
      facetRole: dict.picker.facetRole,
      facetTopic: dict.picker.facetTopic,
      all: dict.picker.all,
      resultLine: dict.picker.resultLine,
      emptyState: dict.picker.emptyState,
      mustWatchMin: dict.picker.mustWatchMin,
      sortShortestWatch: dict.picker.sorts.shortestWatch,
      sortShortestTotal: dict.picker.sorts.shortestTotal,
      sortConferenceOrder: dict.picker.sorts.conferenceOrder,
    },
  };
}
