const flaskApiOrigin = process.env.FLASK_API_ORIGIN || 'http://127.0.0.1:5000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${flaskApiOrigin}/api/:path*`,
      },
      {
        source: '/legacy-static/:path*',
        destination: `${flaskApiOrigin}/legacy-static/:path*`,
      },
    ];
  },
};

export default nextConfig;
