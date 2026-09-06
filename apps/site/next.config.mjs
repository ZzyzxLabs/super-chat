/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: process.env.PAGES_BASE_PATH ?? "",
  reactStrictMode: true,
  images: { unoptimized: true },
  transpilePackages: ["@zzyzxlabs/super-chat-core", "@zzyzxlabs/super-chat-react", "@zzyzxlabs/super-chat-ui"],
  experimental: { externalDir: true },
};

export default nextConfig;
