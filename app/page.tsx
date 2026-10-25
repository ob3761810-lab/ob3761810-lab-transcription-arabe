import UploadForm from "@/app/components/UploadForm";

const etapes = [
  "Déposez un fichier audio ou vidéo depuis votre ordinateur.",
  "Le texte est transcrit (arabe, français, anglais).",
  "Les harakat sont ajoutées sur l'arabe, les mots incertains sont signalés.",
  "Le texte est découpé en chapitres avec horodatage.",
  "Vous relisez et corrigez, puis exportez en Word ou PDF.",
];

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-10 shadow-sm">
        <h1 className="text-3xl font-semibold text-zinc-900">
          Transcription arabe vocalisée
        </h1>
        <p className="mt-3 text-lg text-zinc-600">
          Transformez un cours, une conférence ou une khoutba en document propre
          et vocalisé.
        </p>

        <p
          dir="rtl"
          lang="ar"
          className="mt-8 rounded-xl bg-emerald-50 px-6 py-5 text-right text-3xl leading-loose text-emerald-900"
          style={{ fontFamily: "var(--font-arabic)" }}
        >
          بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
        </p>

        <UploadForm />

        <h2 className="mt-12 text-xl font-semibold text-zinc-900">
          Comment ça marche
        </h2>
        <ol className="mt-4 list-decimal space-y-2 pl-6 text-zinc-700">
          {etapes.map((etape) => (
            <li key={etape}>{etape}</li>
          ))}
        </ol>
      </div>
    </main>
  );
}
