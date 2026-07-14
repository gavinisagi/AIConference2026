/** @type {import('next').NextConfig} */
const nextConfig = {
  // 纯静态导出：next build 直接产出 out/，无后端/服务端渲染。
  output: 'export',
  // 静态导出下 Next 的图片优化不可用，关闭以避免构建告警。
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
