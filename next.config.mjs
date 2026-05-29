/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pdf-parse'],
  images: {
    domains: ['cdn.myportfolio.com'],
  },
};
export default nextConfig;
