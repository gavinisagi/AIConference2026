#!/usr/bin/env node
/**
 * upload-frames.mjs — 把本地关键画面同步到 Cloudflare R2（S3 兼容）。
 *
 * 关键画面是清洗产物、二进制，不入 git（见 deploy/R2-frames.md）。本地由流水线写入
 * public/frames/，本脚本把它镜像到 R2 桶的 frames/ 前缀下，保持路径与站点 src 一致
 * （src=/frames/<videoId>/tXXX.jpg → 桶键 frames/<videoId>/tXXX.jpg）。
 *
 * 走 aws CLI（R2 是 S3 兼容端点），凭证/端点从环境变量读，绝不写进仓库：
 *   R2_ENDPOINT   例：https://<accountid>.r2.cloudflarestorage.com
 *   R2_BUCKET     桶名
 *   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  R2 API Token 的 Access Key/Secret
 *
 * 用法：node scripts/upload-frames.mjs          # 同步
 *       node scripts/upload-frames.mjs --dry-run # 只看会传什么，不上传
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = resolve(ROOT, 'public/frames');

const { R2_ENDPOINT, R2_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = process.env;
const dryRun = process.argv.includes('--dry-run');

function die(msg) {
  console.error(`[upload-frames] ${msg}`);
  process.exit(1);
}

if (!existsSync(SRC_DIR)) die(`本地无 public/frames/ —— 先跑流水线 frames 阶段生成关键画面。`);
const missing = ['R2_ENDPOINT', 'R2_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'].filter(
  (k) => !process.env[k],
);
if (missing.length) {
  die(
    `缺少环境变量：${missing.join(', ')}\n` +
      `  在 R2 控制台建桶 + 建 API Token（Object Read & Write），然后：\n` +
      `    export R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com\n` +
      `    export R2_BUCKET=<桶名>\n` +
      `    export AWS_ACCESS_KEY_ID=<token 的 Access Key ID>\n` +
      `    export AWS_SECRET_ACCESS_KEY=<token 的 Secret Access Key>\n` +
      `  详见 deploy/R2-frames.md`,
  );
}

// aws s3 sync：只上传新增/变更，删除远端多余项，保持与本地一致。
// --checksum-algorithm CRC32：绕开 aws CLI 对 R2 默认 CRC64 校验的不兼容。
const args = [
  's3',
  'sync',
  SRC_DIR,
  `s3://${R2_BUCKET}/frames`,
  '--endpoint-url',
  R2_ENDPOINT,
  '--checksum-algorithm',
  'CRC32',
  '--content-type',
  'image/jpeg',
  '--cache-control',
  'public, max-age=31536000, immutable',
];
if (dryRun) args.push('--dryrun');

console.log(`[upload-frames] aws ${args.join(' ')}`);
const r = spawnSync('aws', args, { stdio: 'inherit', shell: process.platform === 'win32' });
if (r.error && r.error.code === 'ENOENT') {
  die(`未找到 aws CLI。装 AWS CLI v2 或改用 rclone（见 deploy/R2-frames.md）。`);
}
process.exit(r.status ?? 1);
