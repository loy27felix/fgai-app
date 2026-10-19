/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: { cpus: 2, serverActions: { bodySizeLimit: "2mb" } },
};
export default nextConfig;
