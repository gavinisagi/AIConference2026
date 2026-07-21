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

### 2. 上传关键画面

先确保本地 `public/frames/` 有产物（跑过流水线 frames 阶段）。

把桶名写进 `.env.local`（从 `.env.example` 复制；已被 gitignore 挡住）：

```
R2_BUCKET=aiconf-frames
```

然后登录并上传——**不需要装 AWS CLI，也不需要建 R2 API Token**，
wrangler 的 OAuth 登录就够（部署 Pages 本来也要做这一步）：

```bash
npx wrangler login                          # 首次，浏览器授权
node scripts/upload-frames.mjs --dry-run    # 先看会传哪些
node scripts/upload-frames.mjs              # 实际上传
```

脚本逐个 `wrangler r2 object put --remote`，并给图片打一年 immutable 缓存头。
重跑是幂等的（同名覆盖），中断后直接重跑即可。

> **可选：文件量大时改用 `aws s3 sync`**（批量更快，且会删除远端多余对象）。
> 需本机装有 aws CLI，并在 R2 → Manage R2 API Tokens 建 Token（Object Read & Write），
> 然后在 `.env.local` 里补上 `R2_ENDPOINT` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`
> ——四项配齐且 aws 可用时脚本会自动切到该后端，也可 `--backend=aws` 强制。

### 3. 前端指向 R2

在 `.env.local` 里填第 1 步拿到的公开域名（**不带尾斜杠**）：

```
NEXT_PUBLIC_FRAMES_BASE=https://img.example.com
```

`npm run build` 时 Next 会自动读取，`<img>` 与单场 OG 封面就都指向 R2。
没配这个变量时站点仍能构建，只是图片回落到 `/frames/...`——本地有文件所以正常，
但部署产物里没有这些二进制，线上会 404（页面本身不受影响）。

## 上线自检

- [ ] R2 桶已建、公开访问已开（自定义域名或 r2.dev）
- [ ] `node scripts/upload-frames.mjs` 跑通，桶内有 `frames/<videoId>/*.jpg`
- [ ] 浏览器直开 `https://<域名>/frames/<某videoId>/<某文件>.jpg` 能看到图
- [ ] 构建环境设了 `NEXT_PUBLIC_FRAMES_BASE`
- [ ] 部署后导览页 / 首页卡片图片正常显示

## 加新场次时

流水线 frames 阶段会往本地 `public/frames/` 写新图，重跑
`node scripts/upload-frames.mjs` 增量同步即可，无需改前端。
