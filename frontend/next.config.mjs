/** @type {import('next').NextConfig} */
const backendUrl = process.env.NEXT_PUBLIC_API_URL || process.env.BACKEND_URL || "https://backend-production-2c101.up.railway.app";

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
