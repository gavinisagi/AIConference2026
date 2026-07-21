#!/usr/bin/env node
/**
 * upload-frames.mjs — 把本地关键画面同步到 Cloudflare R2。
 *
 * 关键画面是清洗产物、二进制，不入 git（见 deploy/R2-frames.md）。本地由流水线写入
 * public/frames/，本脚本把它镜像到 R2 桶的 frames/ 前缀下，保持与站点 src 一致
 * （src=/frames/<videoId>/tXXX.jpg → 桶键 frames/<videoId>/tXXX.jpg）。
 *
 * 两种后端，自动选择：
 *   wrangler（默认）—— 只需 R2_BUCKET + 一次 `npx wrangler login`（部署 Pages 本就要做）。
 *                      逐个文件上传，无需装 AWS CLI、无需建 R2 API Token。
 *   aws     —— 配齐 R2_ENDPOINT + AWS 密钥且本机有 aws CLI 时启用，走 s3 sync 批量同步，
 *              文件多时更快，并会删除远端多余对象。
 *
 * 环境变量从 .env.local / .env 自动读取（scripts/load-env.mjs）。
 *
 * 用法：node scripts/upload-frames.mjs [--dry-run] [--backend=wrangler|aws]
 */
import './load-env.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = resolve(ROOT, 'public/frames');
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

const dryRun = process.argv.includes('--dry-run');
const backendArg = process.argv.find((a) => a.startsWith('--backend='))?.split('=')[1];

function die(msg) {
  console.error(`[upload-frames] ${msg}`);
  process.exit(1);
}

// Windows 上 npx/aws 是 .cmd，spawn 必须走 shell；但走 shell 时 Node 会把 argv 直接
// 拼成命令行字符串，含空格的参数（--cache-control 的值、含空格的文件路径）会被 cmd.exe
// 二次拆分成多个参数。故在 win32 下自行加引号。
const USE_SHELL = process.platform === 'win32';

/** win32+shell 下给需要的参数加引号；其余平台原样返回（execve 不经 shell，无需转义）。 */
function shellArgs(args) {
  if (!USE_SHELL) return args;
  return args.map((a) => (/[\s,;&|<>^"]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : a));
}

/** 本机是否有某个可执行命令。 */
function hasCmd(cmd) {
  const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: USE_SHELL });
  return !probe.error;
}

/** 递归收集 public/frames 下所有文件 → [{ abs, key }]，key 形如 frames/<videoId>/tXXX.jpg。 */
function collectFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...collectFiles(abs));
    else out.push({ abs, key: `frames/${relative(SRC_DIR, abs).split(sep).join('/')}` });
  }
  return out;
}

if (!existsSync(SRC_DIR)) die('本地无 public/frames/ —— 先跑流水线 frames 阶段生成关键画面。');

const { R2_ENDPOINT, R2_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = process.env;
if (!R2_BUCKET) {
  die(
    '缺少 R2_BUCKET。把它写进 .env.local（可从 .env.example 复制）：\n' +
      '    R2_BUCKET=aiconf-frames\n' +
      '  详见 deploy/R2-frames.md',
  );
}

// 后端选择：显式指定优先；否则配齐 aws 凭证且有 aws CLI 才用 aws，其余一律 wrangler。
const awsReady = Boolean(R2_ENDPOINT && AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY) && hasCmd('aws');
const backend = backendArg || (awsReady ? 'aws' : 'wrangler');
if (backend !== 'aws' && backend !== 'wrangler') die(`未知 --backend=${backend}（可选 wrangler | aws）`);
if (backend === 'aws' && !awsReady) {
  die('--backend=aws 需要 R2_ENDPOINT + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY，且本机装有 aws CLI。');
}

const files = collectFiles(SRC_DIR);
if (files.length === 0) die('public/frames/ 下没有文件。');
console.log(`[upload-frames] 后端=${backend} 桶=${R2_BUCKET} 文件=${files.length}${dryRun ? ' (dry-run)' : ''}`);

if (backend === 'aws') {
  // s3 sync：增量上传 + 删除远端多余项。--checksum-algorithm CRC32 绕开 aws CLI 对 R2 的校验不兼容。
  const args = [
    's3', 'sync', SRC_DIR, `s3://${R2_BUCKET}/frames`,
    '--endpoint-url', R2_ENDPOINT,
    '--checksum-algorithm', 'CRC32',
    '--content-type', 'image/jpeg',
    '--cache-control', CACHE_CONTROL,
  ];
  if (dryRun) args.push('--dryrun');
  const r = spawnSync('aws', shellArgs(args), { stdio: 'inherit', shell: USE_SHELL });
  if (r.error?.code === 'ENOENT') die('未找到 aws CLI。改用默认的 wrangler 后端即可。');
  process.exit(r.status ?? 1);
}

/** 同步睡眠（spawnSync 是同步的，退避不能用 setTimeout）。 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 该错误是否值得重试。
 * 网络抖动（fetch failed / 超时 / 5xx）几十个文件的上传里几乎必然遇到，重试即可；
 * 而「桶不存在」「未授权」是配置问题，重试三次只是白等——快速失败让用户去修配置。
 */
function isTransient(stderr) {
  const s = (stderr || '').toLowerCase();
  if (/does not exist|unauthor|forbidden|invalid|not found|unknown argument/.test(s)) return false;
  return /fetch failed|connectivity|network|timeout|timed out|socket|econn|enotfound|eai_again|502|503|504|429/.test(s);
}

const MAX_ATTEMPTS = 4;

// wrangler：逐个 put。--remote 确保打到真实 R2 而非本地模拟存储。
let ok = 0;
for (const [i, f] of files.entries()) {
  const label = `[${i + 1}/${files.length}] ${f.key}`;
  if (dryRun) {
    console.log(`  ${label} (skip: dry-run)`);
    ok++;
    continue;
  }

  let lastErr = '';
  let done = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const r = spawnSync(
      'npx',
      shellArgs([
        '--yes', 'wrangler@latest', 'r2', 'object', 'put', `${R2_BUCKET}/${f.key}`,
        '--file', f.abs,
        '--content-type', 'image/jpeg',
        '--cache-control', CACHE_CONTROL,
        '--remote',
      ]),
      { stdio: ['ignore', 'ignore', 'pipe'], shell: USE_SHELL, encoding: 'utf8' },
    );
    if (r.status === 0) {
      ok++;
      console.log(`  ${label} ✓${attempt > 1 ? `（第 ${attempt} 次尝试）` : ''}`);
      done = true;
      break;
    }
    lastErr = (r.stderr || '').trim();
    if (!isTransient(lastErr) || attempt === MAX_ATTEMPTS) break;
    const backoff = 1000 * 2 ** (attempt - 1); // 1s → 2s → 4s
    console.log(`  ${label} ⟳ 网络抖动，${backoff / 1000}s 后重试（${attempt}/${MAX_ATTEMPTS - 1}）`);
    sleepSync(backoff);
  }

  if (!done) {
    console.error(`  ${label} ✗\n${lastErr}`);
    die(`上传中断。已成功 ${ok}/${files.length}。重跑即可（同名覆盖，幂等安全）。`);
  }
}
console.log(`[upload-frames] 完成：${ok}/${files.length}`);
