/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  images: {
    domains: ['cdn.myportfolio.com'],
  },
};
export default nextConfig;
