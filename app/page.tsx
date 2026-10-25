import Transcriber from "@/app/components/Transcriber";

// L'application ne fonctionne que si la clé Google Gemini est réglée sur Vercel.
const ready = Boolean(process.env.GEMINI_API_KEY);

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-10 sm:py-16">
      <div className="page w-full max-w-2xl rounded-2xl bg-white p-6 shadow-sm sm:p-10">
        <div className="no-print">
          <h1 className="text-3xl font-semibold text-zinc-900">Transcription arabe vocalisée</h1>
          <p className="mt-3 text-lg text-zinc-600">
            Déposez un audio ou une vidéo : vous obtenez le texte avec les harakat, que vous pouvez
            traduire et télécharger en PDF.
          </p>
        </div>

        <Transcriber ready={ready} />
      </div>
    </main>
  );
}
