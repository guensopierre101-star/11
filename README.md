# THE10th🎤 - English Speaking Coach

Application d'entraînement à l'expression orale en anglais pour apprenants francophones (préparation TCF/TEF, conversation, aisance).

## Fonctionnalités

1. **Topic Speaking (Pratique par sujet)** :
   - Génération de 5 sujets ouverts à partir d'un mot-clé et d'un niveau CECR (A1, A2, B1, B2, C1).
   - Historique des sujets par mot pour éviter les répétitions.
   - Enregistrement audio jusqu'à 3 minutes avec minuteur et barre de progression.
   - Analyse pédagogique détaillée en français : récapitulatif des idées, transcription intégrale, audit rigoureux des erreurs grammaticales avec corrections et explications, points forts, conseils de prononciation, nouveau vocabulaire et axes de progression.

2. **Speed Speaking (Défi 30 secondes)** :
   - Défi de prise de parole spontanée de 30 secondes sur un sujet ouvert.
   - Détection en temps réel de la voix via l'API Web Audio (RMS et seuil de silence) : le compte à rebours se déclenche uniquement lorsque l'utilisateur commence à parler.
   - Comptage des pauses (> 1s) et calcul de la vitesse de parole en Mots Par Minute (WPM).
   - Calcul d'un score de fluidité sur 100 et évaluation de la vitesse (Trop lent, Un peu lent, Bonne vitesse, Un peu rapide, Trop rapide).
   - Analyse complète avec transcription, erreurs/corrections, points forts, prononciation et vocabulaire.

3. **Tap-to-Translate (Traduction au toucher)** :
   - Chaque mot anglais dans les titres et questions de sujet peut être cliqué pour afficher sa traduction française en contexte.
   - Synthèse vocale intégrée (Web Speech API) avec prononciation audio du mot en anglais américain (`en-US`).
   - Mise en cache intelligente des traductions.

4. **Paramètres et IA** :
   - Prise en charge directe de Gemini avec le SDK officiel `@google/genai` (modèle par défaut `gemini-2.5-flash`).
   - Secours Groq avec transcription Whisper (`whisper-large-v3-turbo`) et LLM (`openai/gpt-oss-120b`).
   - Prise en charge automatique de la clé d'environnement serveur (`GEMINI_API_KEY`) ainsi que des clés personnalisées configurables dans l'interface.

## Technologies

- **React 19** avec **TypeScript**
- **Vite 6**
- **Express** (Node.js 22) pour les routes d'API proxy et l'intégration de Gemini
- **Web Audio API** & **MediaRecorder** pour la capture et le traitement audio 16kHz WAV
