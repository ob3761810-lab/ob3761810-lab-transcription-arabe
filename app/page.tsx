import Transcriber from "@/app/components/Transcriber";

// L'application ne fonctionne que si la clé Google Gemini est réglée sur Vercel.
const ready = Boolean(process.env.GEMINI_API_KEY);

export default function Home() {
  return (
    <main className="flex flex-1 flex-col bg-background">
      {/* En-tête : motif géométrique, titre en calligraphie arabe et nom du site. */}
      <header className="no-print islamic-pattern relative overflow-hidden border-b-4 border-gold-400 px-4 pb-14 pt-12 text-center sm:pt-16">
        <div className="mx-auto max-w-3xl">
          <p
            dir="rtl"
            lang="ar"
            className="font-arabic text-5xl leading-[1.6] text-gold-400 sm:text-6xl"
          >
            حَرَكَاتُ النَّصِّ
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-wide text-white sm:text-3xl">
            Harakat Nass
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-brand-100 sm:text-lg">
            Transcrivez un audio ou une vidéo avec les harakat, ou vocalisez un PDF ou un texte
            arabe. Corrigez, traduisez, puis téléchargez en PDF ou en Word.
          </p>
        </div>
      </header>

      <div className="flex flex-1 justify-center px-4 pb-12">
        <div className="page relative z-10 -mt-8 w-full max-w-6xl rounded-3xl border border-gold-200 bg-white p-6 shadow-xl shadow-brand-900/5 sm:p-10">
          <Transcriber ready={ready} />
        </div>
      </div>

      <footer className="no-print border-t border-gold-200 px-4 py-6 text-center text-sm text-stone-500">
        <span dir="rtl" lang="ar" className="font-arabic text-lg text-gold-500">
          حَرَكَاتُ النَّصِّ
        </span>{" "}
        · Harakat Nass — Les textes produits par l&apos;intelligence artificielle doivent être
        relus.
        <br />
        Texte coranique : Tanzil Quran Text (Simple), ©{" "}
        <a href="https://tanzil.net" className="underline hover:text-brand-700">
          Tanzil Project
        </a>
        , licence{" "}
        <a
          href="https://creativecommons.org/licenses/by/3.0/"
          className="underline hover:text-brand-700"
        >
          CC BY 3.0
        </a>
        .
      </footer>
    </main>
  );
}
