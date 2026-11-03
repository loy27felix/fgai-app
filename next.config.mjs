const localWorkbench = process.env.NODE_ENV === "development" && process.env.FG_LOCAL_WORKBENCH === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: { cpus: 1, serverActions: { bodySizeLimit: "2mb" } },
  async redirects() {
    return localWorkbench ? [{ source: "/production-lab/:path*", destination: "/fg-six", permanent: false }] : [];
  },
  async rewrites() {
    // Local-only routing keeps FG login and the new workbench on one browser origin.
    // 仅本地开发启用，让 FG 登录和新版工作台共用同一个浏览器入口。
    return { beforeFiles: localWorkbench ? [
      { source: "/fg-six/api/:path*", destination: "http://127.0.0.1:3010/fg-six/api/:path*" },
      { source: "/fg-six", destination: "http://127.0.0.1:3021/fg-six/index.html" },
      { source: "/fg-six/:path*", destination: "http://127.0.0.1:3021/fg-six/:path*" },
      ...["doll", "live2d", "short-drama-styles"].map(directory => ({
        source: `/${directory}/:path*`, destination: `http://127.0.0.1:3021/fg-six/${directory}/:path*`,
      })),
    ] : [], afterFiles: [], fallback: [] };
  },
};
export default nextConfig;
