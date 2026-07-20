# 关键画面走 Cloudflare R2

关键画面（`public/frames/`）是清洗产物、二进制，**不入 git**（`.gitignore` 已忽略）。
生产环境从 R2 对象存储取图，前端只存相对路径、渲染时拼上 R2 origin。

## 为什么这么设计

- 数据里 `src` 永远是站点内相对路径 `/frames/<videoId>/tXXX.jpg`，**不含 origin**。
- 渲染时 `src/lib/assets.ts` 的 `frameSrc()` 读构建期环境变量 `NEXT_PUBLIC_FRAMES_BASE`：
  - 配了 → 拼成 `https://<你的域名>/frames/<videoId>/tXXX.jpg`，从 R2/CDN 取；
  - 没配 → 原样 `/frames/...`，回落本地 `public/`（本地开发 / 预览）。
- 换桶、换自定义域名，只改这一个 env，**不动数据、不重建 dataset**。

R2 桶里的键结构与站点路径一致：`frames/<videoId>/tXXX.jpg`（即镜像本地 `public/frames/`）。

## 一次性设置

### 1. 建桶 + 开公开访问

1. Cloudflare Dashboard → R2 → Create bucket（如 `aiconf-frames`）。
2. 公开访问二选一：
   - **自定义域名（推荐）**：桶 → Settings → Custom Domains，绑一个你自己的子域
     （如 `img.example.com`）。URL 干净、可长期缓存、不暴露 R2 account id。
   - **r2.dev 域名**：桶 → Settings → 打开 “Allow Access”，拿到 `https://pub-xxx.r2.dev`。
     零配置最快，但有速率限制，仅适合验证 / 临时。

> `<img>` 直接取图不需要配 CORS（CORS 只影响 fetch/XHR）。

### 2. 建 API Token

R2 → Manage R2 API Tokens → Create，权限选 **Object Read & Write**，限定到该桶。
记下 Access Key ID / Secret Access Key，以及 S3 端点
`https://<accountid>.r2.cloudflarestorage.com`。

### 3. 上传关键画面

先确保本地 `public/frames/` 有产物（跑过流水线 frames 阶段）。然后：

```bash
export R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
export R2_BUCKET=aiconf-frames
export AWS_ACCESS_KEY_ID=<token Access Key ID>
export AWS_SECRET_ACCESS_KEY=<token Secret Access Key>

node scripts/upload-frames.mjs --dry-run   # 先看会传哪些
node scripts/upload-frames.mjs             # 实际同步
```

脚本走 `aws s3 sync`（R2 是 S3 兼容端点），只传新增/变更，并给图片打
一年 immutable 缓存头。没装 aws CLI 也可以用 rclone：

```bash
rclone sync public/frames <r2remote>:aiconf-frames/frames \
  --header-upload "Cache-Control: public, max-age=31536000, immutable"
```

### 4. 前端指向 R2

Railway（或你的构建环境）加环境变量，值用第 1 步的公开域名（**不带尾斜杠**）：

```
NEXT_PUBLIC_FRAMES_BASE=https://img.example.com
```

重新构建，`<img>` 就会指向 R2。没配这个变量时站点仍能跑，只是图片回落到
`/frames/...`（Railway 上没这些文件 → 图片 404，但页面正常）。

## 上线自检

- [ ] R2 桶已建、公开访问已开（自定义域名或 r2.dev）
- [ ] `node scripts/upload-frames.mjs` 跑通，桶内有 `frames/<videoId>/*.jpg`
- [ ] 浏览器直开 `https://<域名>/frames/<某videoId>/<某文件>.jpg` 能看到图
- [ ] 构建环境设了 `NEXT_PUBLIC_FRAMES_BASE`
- [ ] 部署后导览页 / 首页卡片图片正常显示

## 加新场次时

流水线 frames 阶段会往本地 `public/frames/` 写新图，重跑
`node scripts/upload-frames.mjs` 增量同步即可，无需改前端。
