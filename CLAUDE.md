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
5. Je peux télécharger le texte en PDF ou en Word (modifiable).
6. Je peux écouter ou regarder le fichier dans la page, avec un minutage cliquable toutes les 2 minutes.
   Avant la transcription : lecteur juste sous la zone de dépôt. Ensuite, sur ordinateur : texte à gauche,
   lecteur à droite (toujours visible) ; sur téléphone : lecteur au-dessus. La lecture continue au déplacement.
7. Les mots à vérifier sont en rouge : ceux dont l'IA doute pendant la transcription, et ceux repérés par
   une relecture automatique du texte (orthographe, harakat, accord), avec une correction proposée.
   Un clic ouvre une fenêtre : choisir un mot dans la liste proposée, écrire sa propre correction, ou confirmer.
   Les mots corrigés sont soulignés en vert et restent modifiables (faute de frappe, retour au mot d'origine).
   Non vérifiés, les mots restent en rouge dans le PDF et le Word.

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
- PDF déposé : découpé dans le navigateur en paquets de 3 pages (bibliothèque `pdf-lib`, `lib/pdf.ts`),
  chacun envoyé à Gemini qui renvoie le texte avec les harakat, page par page.
- Texte collé : découpé en morceaux d'environ 2 500 caractères (`splitText` dans `lib/text.ts`), envoyés
  un par un à Gemini (`vocalizeText`).
- PDF téléchargé : impression du navigateur (« Enregistrer au format PDF »), qui affiche parfaitement l'arabe.
- Word : bibliothèque `docx` (`lib/word.ts`), fichier créé dans le navigateur, arabe en droite-à-gauche.
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
- Ne jamais présenter un texte comme « vérifié » : il est toujours marqué « non relu ».
- Tester l'affichage RTL et les harakat à l'écran et dans le PDF (pas de chevauchement, ordre correct
  dans les phrases mélangées arabe/français).

## Façon de travailler
- Après chaque changement qui marche : propose un commit git avec un message clair.
- Avant de dire « c'est terminé », lance l'application et vérifie toi-même que ça fonctionne.
- Si une décision importante se présente (service payant, nouvelle bibliothèque), demande-moi d'abord.
- Code simple et lisible plutôt que malin.
