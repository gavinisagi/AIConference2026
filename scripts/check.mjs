#!/usr/bin/env node
/**
 * check.mjs — 项目唯一校验入口（跨平台，替代旧的 POSIX `scripts/check`）。
 *
 * 单命令跑通全部校验：
 *   0) data      node scripts/build-data.mjs --verify  （数据契约 schema 校验 + 漂移比对）
 *   1) lint      next lint
 *   2) typecheck tsc --noEmit
 *   3) build     next build（静态导出 out/）——先清 .next/out 保证幂等
 *
 * 任一步失败即以非零码退出，后续所有任务的验收都通过本脚本。
 *
 * 为什么从 sh 换成 Node：本机 bash 会落到不可用的 WSL，旧 `scripts/check` 因此在
 * Windows 上跑不通。Node 各平台一致，且 build 前的 `rm -rf .next out` 用 fs.rmSync
 * 实现，不再依赖 POSIX 工具。WSL 只服务于 mossASR，不应再是前端校验的依赖。
 */
import { spawnSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** 在 ROOT 下跑一条命令，失败即退出。shell:true 以兼容 Windows 的 npm.cmd/next.cmd。 */
function run(label, cmd) {
  console.log(`[check] ${label}`);
  const r = spawnSync(cmd, { cwd: ROOT, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`[check] FAILED at: ${label} (exit ${r.status ?? 'signal ' + r.signal})`);
    process.exit(r.status || 1);
  }
}

if (!existsSync(resolve(ROOT, 'node_modules'))) {
  console.error('[check] ERROR: node_modules missing. Run `npm install` (or scripts/bootstrap) first.');
  process.exit(1);
}

// 0) 生成 src/data/dataset.json（含全量 schema 校验）。
//    dataset.json 是构建产物、不入库：数据源为本地 JSON（DATA_SOURCE=file，默认）
//    或构建期从 DB/CRUD API 拉取（DATA_SOURCE=api）。loader 静态 import 它，
//    因此必须先于 typecheck / build 生成。
run('0/3 data (generate + schema)', 'node scripts/build-data.mjs');

// 清理上一轮构建产物。必须在 typecheck 之前：.next/types/validator.ts 会引用上一次
// 构建时存在的路由文件，路由增删/改名后这些陈旧类型会让 typecheck 假失败。
// （同时也保证 build 从干净态开始，避免复用 .next 时 build-traces 偶发 ENOENT。）
console.log('[check] 清理 .next / out');
for (const dir of ['.next', 'out']) {
  rmSync(resolve(ROOT, dir), { recursive: true, force: true });
}

// 1) lint
run('1/3 lint', 'npm run lint');

// 2) typecheck
run('2/3 typecheck', 'npm run typecheck');

// 3) build（静态导出）。.next/out 已在 typecheck 前清理，此处直接从干净态构建。
run('3/3 build (static export)', 'npm run build');

console.log('[check] all checks passed.');
