import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Chrome pour serveur (PDF) : chargé tel quel, sans passer par l'assemblage de Next.js.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // Fichiers lus par le serveur, à inclure dans le déploiement : texte du Coran (Tanzil),
  // police Amiri et Chrome pour le PDF.
  outputFileTracingIncludes: {
    "/api/pdf": ["./data/fonts/**", "./node_modules/@sparticuz/chromium/bin/**"],
    "/api/transcribe": ["./data/quran-simple.txt"],
    "/api/quran": ["./data/quran-simple.txt"],
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
