/**
 * load-env.mjs — 零依赖 .env 加载器（import 即生效）。
 *
 * 让 `node scripts/xxx.mjs` 直接读到本地环境变量，不必每次 export、也不必记
 * --env-file 参数。加载顺序：.env.local → .env（前者优先，与 Next 的约定一致）。
 *
 * 已存在的 process.env 永远不被覆盖 —— 真实导出的环境变量 / CI secrets 优先级最高，
 * .env 只作为本地缺省填补。两个文件都被 .gitignore 挡住，密钥不入库。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 解析一行 KEY=VALUE；跳过空行与注释，剥掉包裹引号。非法行静默忽略。 */
function parseLine(line) {
  const s = line.trim();
  if (!s || s.startsWith('#')) return null;
  const eq = s.indexOf('=');
  if (eq <= 0) return null;
  const key = s.slice(0, eq).trim();
  let val = s.slice(eq + 1).trim();
  if (
    (val.startsWith('"') && val.endsWith('"') && val.length > 1) ||
    (val.startsWith("'") && val.endsWith("'") && val.length > 1)
  ) {
    val = val.slice(1, -1);
  }
  return [key, val];
}

for (const name of ['.env.local', '.env']) {
  const file = resolve(ROOT, name);
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const kv = parseLine(line);
    if (!kv) continue;
    const [key, val] = kv;
    if (process.env[key] === undefined) process.env[key] = val; // 不覆盖已有
  }
}
