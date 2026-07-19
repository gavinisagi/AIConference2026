/** @type {import('next').NextConfig} */
const nextConfig = {
  // 纯静态导出：next build 直接产出 out/，无后端/服务端渲染。
  output: 'export',
  // 目录式导出：每个路由产出 <route>/index.html（如 out/styleguide/index.html），
  // 便于静态托管的干净 URL（AIO-29 验收要求；T3–T6 一致遵循）。
  trailingSlash: true,
  // 静态导出下 Next 的图片优化不可用，关闭以避免构建告警。
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
