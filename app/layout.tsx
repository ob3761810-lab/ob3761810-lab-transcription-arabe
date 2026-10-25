import type { Metadata } from "next";
import { Geist, Noto_Naskh_Arabic } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Police arabe utilisée pour tout texte arabe (harakat bien lisibles).
const notoNaskhArabic = Noto_Naskh_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
});

export const metadata: Metadata = {
  title: "Transcription arabe vocalisée",
  description:
    "Transformez un fichier audio ou vidéo en document propre : transcription, harakat, chapitres, export Word et PDF.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${notoNaskhArabic.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
