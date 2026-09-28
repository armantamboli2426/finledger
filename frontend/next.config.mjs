/** @type {import('next').NextConfig} */
const backendUrl = process.env.NEXT_PUBLIC_API_URL || process.env.BACKEND_URL || "https://police-instruction-relationships-ordered.trycloudflare.com";

const nextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: process.cwd()
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl.replace(/\/$/, "")}/api/:path*`
      },
      {
        source: "/statements/:id/export",
        destination: `${backendUrl.replace(/\/$/, "")}/statements/:id/export`
      }
    ];
  }
};

export default nextConfig;
