'use client';

/**
 * useSeen — 客户端已读追踪（localStorage）。
 *
 * 站点是纯静态导出、无后端无账号，「已读」只能落在本机。故：
 *  - 首屏 SSR/静态 HTML 一律按「全部未读」渲染，挂载后才读 localStorage 并更新，
 *    避免 hydration 前后 DOM 不一致（React 会报 hydration mismatch）。
 *  - 读写都包 try/catch：隐私模式 / 禁用存储时静默降级为「不记录」，不要报错。
 */
import { useCallback, useEffect, useState } from 'react';

const KEY = 'compass.seen.v1';

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function save(ids: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    /* 存储不可用 → 本次会话内仍生效，只是不持久化 */
  }
}

export function useSeen() {
  // 初始恒为空集：与服务端渲染结果一致，挂载后再补真实值。
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSeen(load());
    setReady(true);
  }, []);

  const markSeen = useCallback((id: string) => {
    setSeen((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      save(next);
      return next;
    });
  }, []);

  const toggleSeen = useCallback((id: string) => {
    setSeen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      save(next);
      return next;
    });
  }, []);

  return { seen, ready, markSeen, toggleSeen };
}
