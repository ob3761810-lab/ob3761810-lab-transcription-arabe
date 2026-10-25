# Projet : application de transcription arabe vocalisé (V1)

## Contexte
Je ne suis pas développeur. Explique simplement ce que tu fais, en français, avant chaque changement important.
L'application transforme un fichier audio ou vidéo en document propre : transcription, harakat sur l'arabe,
chapitres automatiques, correction, puis export Word ou PDF.
Langues : arabe (prioritaire), français, anglais, y compris les fichiers qui mélangent arabe et français/anglais.

## Périmètre V1 (ne rien ajouter d'autre sans me demander)
1. Dépôt d'un fichier audio ou vidéo depuis l'ordinateur (pas de liens en V1).
2. Transcription avec détection automatique de la langue.
3. Harakat sur l'arabe, 3 niveaux : aucune / partielles / complètes. Mots incertains marqués.
4. Chapitres automatiques avec titre et horodatage.
5. Éditeur : modifier le texte, choisir une vocalisation par mot, clic sur une phrase = l'audio s'y place.
6. Export Word (.docx) et PDF, 2 ou 3 modèles (Cours, Conférence, Khoutba), harakat en couleur en option.
7. Plus tard seulement : comptes (Supabase) et paiement (Stripe).

Interdit : télécharger la vidéo ou l'audio d'une plateforme (YouTube, Facebook, TikTok) pour le redonner à l'utilisateur.

## Choix techniques
- Next.js (TypeScript), hébergement prévu sur Vercel.
- Transcription : service externe par API (service exact choisi à l'étape 2, garder le code facile à changer :
  un seul fichier `lib/transcription.ts` qui cache le fournisseur).
- Harakat et chapitres : API Claude sur le texte transcrit.
- Vidéo vers audio : ffmpeg.
- Export Word : bibliothèque `docx`, texte arabe en droite-à-gauche (RTL).
- Export PDF : rendu HTML vers PDF (Playwright), police Amiri ou Noto Naskh Arabic intégrée.
- Comptes et base de données : Supabase. Paiements : Stripe. Ne jamais coder soi-même authentification ou paiement.

## Règles de sécurité (obligatoires)
- Aucune clé d'API dans le code ni dans git : uniquement dans `.env.local`, et `.env.local` est dans `.gitignore`.
- Les appels aux API (transcription, Claude) se font côté serveur, jamais depuis le navigateur.
- Fichiers des utilisateurs supprimés automatiquement après traitement (délai configurable).
- Chaque utilisateur ne peut voir que ses propres fichiers.
- Ne jamais afficher d'erreur technique brute à l'utilisateur.

## Règles de qualité sur l'arabe
- L'IA ne génère JAMAIS de numéro de verset, de source de hadith ni de nom de savant.
- Ne jamais présenter un texte comme « vérifié » s'il n'a pas été relu par l'utilisateur.
- Les mots où la vocalisation est incertaine doivent être signalés, pas cachés.
- Tester l'affichage RTL et les harakat dans l'éditeur, le Word et le PDF (pas de chevauchement, ordre correct
  dans les phrases mélangées arabe/français).

## Façon de travailler
- Une seule étape à la fois (voir plan ci-dessous). Ne passe pas à la suivante sans mon accord.
- Après chaque étape qui marche : propose un commit git avec un message clair.
- Avant de dire « c'est terminé », lance l'application et vérifie toi-même que ça fonctionne.
- Si une décision importante se présente (nouveau service payant, nouvelle bibliothèque, changement d'architecture),
  demande-moi d'abord en expliquant les options simplement.
- Code simple et lisible plutôt que malin.

## Plan des étapes
0. Préparation : projet Next.js, git, `.env.local`, page d'accueil.
1. Dépôt d'un fichier + transcription brute affichée.
2. Comparaison de 2 ou 3 services de transcription sur 5 vrais fichiers.
3. Harakat (3 niveaux, mots incertains marqués).
4. Chapitres automatiques.
5. Éditeur de correction avec audio synchronisé.
6. Export Word et PDF.
7. Test avec 10 vrais utilisateurs.
8. Comptes, quotas en minutes, paiement (relecture du code par un développeur avant ouverture).
9. Mise en ligne.

## Étape en cours
Étape 0.
