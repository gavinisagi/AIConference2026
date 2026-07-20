/**
 * assets.ts — 静态资源 URL 解析。
 *
 * 关键画面（frames）是清洗产物、二进制，不入 git；生产走对象存储（Cloudflare R2）。
 * 数据里 src 永远存站点内相对路径 `/frames/<videoId>/tXXX.jpg`（不含 origin），
 * 渲染时按环境拼上 R2 origin —— 换桶 / 换自定义域名只改一个 env，不动数据。
 *
 * NEXT_PUBLIC_FRAMES_BASE 是构建期内联的公开变量：
 *   - 已配（如 https://img.example.com）→ 拼成绝对 URL，从 R2/CDN 取图；
 *   - 未配 → 原样返回 `/frames/...`，回落到本地 public/（本地开发 / 预览）。
 */
const FRAMES_BASE = (process.env.NEXT_PUBLIC_FRAMES_BASE ?? '').replace(/\/+$/, '');

/** 解析关键画面 src：有 R2 base 拼绝对 URL，否则回落本地相对路径。 */
export function frameSrc(src: string): string {
  if (!FRAMES_BASE) return src;
  if (/^https?:\/\//i.test(src)) return src; // 已是绝对 URL（防御）：不重复拼接
  return `${FRAMES_BASE}${src.startsWith('/') ? '' : '/'}${src}`;
}
