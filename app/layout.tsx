import type { Metadata } from "next";
import { Amiri, Geist, Noto_Naskh_Arabic } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Police arabe principale : Amiri, calligraphie naskh classique, harakat bien placées.
const amiri = Amiri({
  variable: "--font-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "700"],
});

// Police arabe de secours, si un caractère manque dans Amiri.
const notoNaskhArabic = Noto_Naskh_Arabic({
  variable: "--font-arabic-fallback",
  subsets: ["arabic"],
});

export const metadata: Metadata = {
  title: "Harakat Nass — transcription arabe vocalisée",
  description:
    "Transcrivez un audio ou une vidéo, ou ajoutez les harakat à un PDF ou à un texte arabe. Correction, traduction, export PDF et Word.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${amiri.variable} ${notoNaskhArabic.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
