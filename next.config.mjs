/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  // Explicitly include pdfjs worker file in Vercel's output bundle
  // Without this, the worker .mjs is not deployed and runtime path fails
  outputFileTracingIncludes: {
    '/api/extract': [
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      './node_modules/pdfjs-dist/legacy/build/pdf.mjs',
    ],
  },
  images: {
    domains: ['cdn.myportfolio.com'],
  },
};
export default nextConfig;
