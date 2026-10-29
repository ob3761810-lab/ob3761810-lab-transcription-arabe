import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Le texte du Coran (Tanzil) est lu par le serveur : il doit être inclus dans le déploiement.
  outputFileTracingIncludes: {
    "/api/transcribe": ["./data/quran-simple.txt"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
