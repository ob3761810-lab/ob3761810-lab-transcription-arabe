# Projet : application de transcription arabe vocalisée (version simple)

## Contexte
Je ne suis pas développeur. Explique simplement ce que tu fais, en français, avant chaque changement important.
Je veux une application simple, clé en main et gratuite. Pas de réglages compliqués.

## Ce que fait l'application (rien d'autre sans me demander)
1. Je dépose un fichier audio ou vidéo depuis mon ordinateur ou mon téléphone, ou un PDF (texte ou scan)
   pour y ajouter les harakat, ou je colle un texte arabe (onglet « Coller un texte »). Pour un texte collé,
   les harakat déjà écrites sont gardées : seules les manquantes sont ajoutées.
2. L'application le transcrit (arabe, français, anglais, y compris mélangés).
3. Les harakat sont ajoutées sur l'arabe, avec un interrupteur « Avec harakat / Sans harakat ».
4. Je peux traduire le texte (français, anglais, arabe).
5. Je peux télécharger le texte en PDF (vrai PDF fabriqué par le serveur : titre, pagination, aucun
   élément d'interface) ou en Word (modifiable).
6. Je peux écouter ou regarder le fichier dans la page, avec un minutage cliquable toutes les 2 minutes.
   Avant la transcription : lecteur juste sous la zone de dépôt. Ensuite, sur ordinateur : texte à gauche,
   lecteur à droite (toujours visible) ; sur téléphone : lecteur au-dessus. La lecture continue au déplacement.
7. Les mots à vérifier sont en rouge : ceux dont l'IA doute pendant la transcription, et ceux repérés par
   une relecture automatique du texte (orthographe, harakat, accord), avec une correction proposée.
   Un clic ouvre une fenêtre : choisir un mot dans la liste proposée, écrire sa propre correction, ou confirmer.
   Les mots corrigés sont soulignés en vert et restent modifiables (faute de frappe, retour au mot d'origine).
   Non vérifiés, les mots restent en rouge dans le PDF et le Word.
   Tous les autres mots sont aussi cliquables, pour corriger une erreur que l'IA n'a pas signalée.
   Dans la fenêtre, un bouton « Proposer des corrections » demande à l'IA quelques mots possibles
   (seulement sur clic, pour économiser la limite gratuite).
8. Les versets du Coran reconnus dans le texte de l'IA sont remplacés par le texte officiel (Tanzil),
   entre ﴿ ﴾, sur fond doré, avec leur référence (sourate et verset). Un clic permet d'annuler le
   remplacement (fausse détection) ou de le rétablir. Le PDF et le Word contiennent le texte officiel
   et la référence. Les versets officiels ne sont jamais relus ni marqués en rouge par l'IA.
   Hadiths : pas de remplacement pour l'instant.
9. Onglet « Sous-titres » : j'importe des sous-titres (.srt, .vtt, .txt, transcription YouTube copiée
   avec horaires) ou je les colle, et j'obtiens un texte propre (arabe, français ou mélangé) :
   - sans IA : horaires, numéros, balises, en-têtes et doublons supprimés, lignes recollées ;
   - option « Mise en forme par l'IA » : hésitations retirées, ponctuation, paragraphes, intertitres rares.
     RÈGLE ABSOLUE : l'IA ne reformule, ne résume, ne traduit, ne complète et ne corrige jamais.
     Le code vérifie chaque morceau mot par mot ; s'il a été modifié, il est gardé sans mise en forme,
     avec un avertissement. Un contrôle du nombre de mots avant/après est affiché.
   - options : ajouter les harakat ; repères de temps (aucun, un par paragraphe, toutes les 5 minutes) ;
   - versets du Coran détectés ; titre modifiable ; bouton « Modifier le texte » (modification libre) ;
     export Word et PDF.

10. PDF de livre (texte ou scan) : la mise en page d'origine est gardée. Titres, paragraphes (un
    paragraphe reste un seul bloc), vers en deux hémistiches côte à côte (sadr à droite, ʿajuz à gauche,
    en gras), notes de bas de page. Numéros de page et traits décoratifs ignorés. Même mise en page à
    l'écran, dans le Word (tableau sans bordure pour les vers) et dans le PDF.

Interdit : télécharger la vidéo ou l'audio d'une plateforme (YouTube, Facebook, TikTok) pour le redonner à l'utilisateur.

## Choix techniques
- Next.js (TypeScript) + Tailwind, hébergé sur Vercel (offre gratuite), code sur GitHub.
- Intelligence artificielle : Google Gemini, offre gratuite (transcription, harakat, traduction).
  Tout passe par un seul fichier `lib/gemini.ts`. Seul réglage : la clé `GEMINI_API_KEY` sur Vercel.
- Deux versions au choix de l'utilisateur : « Normale » (gemini-flash-latest, par défaut) et « Légère »
  (gemini-flash-lite-latest). Jamais de bascule automatique : si la normale est saturée, la page attend
  et propose à l'utilisateur de passer en version légère.
- Le fichier est préparé dans le navigateur (`lib/audio.ts`) : son extrait, mono 16 kHz, découpé en
  extraits de 2 minutes (limite de 4,5 Mo par envoi sur Vercel). Aucun fichier n'est stocké.
- PDF déposé : découpé dans le navigateur en paquets de 3 pages (bibliothèque `pdf-lib`, `lib/pdf.ts`).
  Pour chaque paquet, deux demandes à Gemini : 1. structure des pages en JSON imposé (`readPdfStructure` :
  titre, paragraphe, vers sadr/ʿajuz, note), texte recopié sans harakat ajoutées ; 2. harakat bloc par
  bloc (`vocalizeList`). Vérification dans `lib/document.ts` : même nombre de blocs, même ordre, mêmes
  mots. Un mot légèrement changé par l'IA garde les lettres de l'auteur, en rouge (harakat gardées sur le
  reste du bloc) ; un bloc réécrit reste sans harakat (avertissement). Aucun texte n'est jamais jeté :
  bloc mal rempli → paragraphe, moitiés de vers réunies, tatweel retiré. Vers rendu en double par l'IA
  (une moitié + le vers entier) ou d'un seul tenant : reconstruit sans doublon (`rebuildVerse`).
  Vers qui se suivent = un poème : encadré doré, hémistiches centrés dans leur colonne (écran, PDF, Word).
  Texte écrit une ligne par bloc :
  « ## titre », « @@ sadr ‖ ʿajuz », « ^^ note », « — Page N — ».
- Texte collé : découpé en morceaux d'environ 2 500 caractères (`splitText` dans `lib/text.ts`), envoyés
  un par un à Gemini (`vocalizeText`).
- PDF téléchargé : fabriqué par le serveur (`app/api/pdf`, page `lib/pdfHtml.ts`) avec Chrome pour serveur
  (`puppeteer-core` 25.11 + `@sparticuz/chromium` 153, mêmes versions de Chrome), police Amiri intégrée
  (`data/fonts`, licence OFL). Secours : impression du navigateur. En local : `CHROMIUM_PATH`.
- Word : bibliothèque `docx` (`lib/word.ts`), fichier créé dans le navigateur, arabe en droite-à-gauche.
- Versets : fichier officiel Tanzil « Simple » (`data/quran-simple.txt`, CC BY 3.0) gardé tel quel,
  avec son bloc de licence ; source citée dans le pied de page avec un lien vers tanzil.net.
  Détection sans IA dans `lib/quran.ts` (normalisation, index de suites de 3 mots, tolérance réglable
  dans `SETTINGS`), appliquée côté serveur dans `app/api/transcribe/route.ts`. Tests : `npm test`.
  Basmala et isti'adha remplacées seulement seules sur leur ligne ou en tête de ligne ; passage de moins
  de 8 mots : correspondance exacte obligatoire (aucune lettre de l'auteur changée) ; détection bloc
  par bloc (`replaceQuranInBlocks`), jamais dans les vers.
- Sous-titres : nettoyage sans IA dans `lib/subtitles.ts` (lecture, doublons, paragraphes, morceaux
  d'environ 1 500 mots coupés à une fin de phrase ou au plus long silence, contrôle des mots) ;
  mise en forme par l'IA dans `formatSubtitles` (`lib/gemini.ts`, prompt système strict), via `/api/format` ;
  versets via `/api/quran`. Tests : `tests/subtitles.test.mjs`.
- Nom du site : « Harakat Nass » (حَرَكَاتُ النَّصِّ). Style classique islamique : vert profond, doré,
  fond crème, motif géométrique dans l'en-tête, police arabe Amiri. Couleurs dans `app/globals.css`.
- Pas de service payant sans mon accord.

## Règles de sécurité (obligatoires)
- Aucune clé d'API dans le code ni dans git : uniquement dans `.env.local` (ignoré par git) et sur Vercel.
- Les appels à l'intelligence artificielle se font côté serveur, jamais depuis le navigateur.
- Aucun fichier utilisateur conservé.
- Ne jamais afficher d'erreur technique brute à l'utilisateur.

## Règles de qualité sur l'arabe
- L'IA ne génère JAMAIS de numéro de verset, de source de hadith ni de nom de savant.
  Les références de versets viennent uniquement du fichier Tanzil, jamais de l'IA.
- Ne jamais présenter un texte comme « vérifié » : il est toujours marqué « non relu ».
- Tester l'affichage RTL et les harakat à l'écran et dans le PDF (pas de chevauchement, ordre correct
  dans les phrases mélangées arabe/français).

## Façon de travailler
- Après chaque changement qui marche : propose un commit git avec un message clair.
- Avant de dire « c'est terminé », lance l'application et vérifie toi-même que ça fonctionne.
- Si une décision importante se présente (service payant, nouvelle bibliothèque), demande-moi d'abord.
- Code simple et lisible plutôt que malin.
