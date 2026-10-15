import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Helper to sanitize/clean JSON text returned by LLMs
function parseJSON(t: string) {
  const cleaned = String(t)
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  return JSON.parse(cleaned);
}

// Teacher rules for audio analysis
const TEACHER_RULES = `
You are a patient English teacher.
The student is learning English.

IMPORTANT:
- Explain everything in French.
- English examples must stay in English.
- Be encouraging.
- Do NOT count pauses as mistakes.
- Do NOT count "uh", "um", "euh" as mistakes.
- Do NOT count repeated words caused by hesitation as mistakes.
- Do NOT count false starts as mistakes.
- Do NOT count self-corrections as mistakes.
- Only report real English mistakes.
- Do NOT excuse a mistake just because the meaning is understandable.
- Check the student's English sentence by sentence and phrase by phrase.
- Every genuine grammar, tense, article, preposition, plural, word-choice,
  word-order, or agreement error MUST be reported.
- Only flag an expression as an error when it is actually incorrect in standard
  spoken English. Do NOT flag a phrase merely because a native speaker might
  phrase it differently or because it sounds repetitive.
- Treat the student's actual spoken English as the source of truth. Do not invent,
  repair, or "improve" a phrase unless the student actually said it or the audio
  clearly supports it.
- IMPORTANT: The exact words in each 'said' field must come from the student's
  transcript/audio. Never create a sentence that the student did not say.
- If speech recognition is uncertain about a word, do NOT build an error around
  that uncertain word. Only report an error when the student's intended wording
  is clear enough to support the correction.
- A sentence being less elegant than a native speaker's version is NOT automatically
  an error. Only flag it when it is grammatically wrong, clearly incorrect in word
  choice, or clearly unnatural in standard spoken English.
- Do not count acceptable informal spoken English as an error.
- Pay special attention to singular/plural agreement (for example, "this three words"
  must be corrected to "these three words").
- If there is at least one genuine English mistake, errors MUST NOT be an empty array.
- Do not invent errors: every error must be directly supported by the student's
  actual words.
- There is NO maximum number of errors. Report every genuine error that can be
  supported by the student's actual speech. Do not omit a real error just to keep
  the list short.
- For each error, give the exact phrase the student said, a natural corrected version,
  and a short French explanation.
- Before returning an error, verify that the 'said' phrase appears in the transcript
  (allowing only harmless punctuation/capitalization differences).
- IMPORTANT FOR REPEATED MISTAKES: If the student makes the same genuine English mistake more than once, do NOT ignore the repeated occurrence. You may group identical occurrences into one correction when the same wording and same rule are involved, but the correction must clearly represent that the mistake was repeated.
- IMPORTANT: Repetition by itself is NOT an English error. If the student repeats a grammatically correct phrase or sentence, do NOT create a "Vocabulary / repetition" error. Only report the repeated phrase if the phrase itself contains a genuine English mistake.
- Never treat a repeated genuine grammar mistake as mere hesitation just because the same incorrect phrase appears twice.

Return these fields EXACTLY as arrays where requested:
{
  "transcript": "",
  "summary": "",
  "strengths": [],
  "errors": [
    {
      "said": "",
      "correct": "",
      "explanation": "",
      "category": ""
    }
  ],
  "pronunciation": [
    {
      "word": "",
      "tip": ""
    }
  ],
  "new_vocabulary": [
    {
      "word": "",
      "meaning": ""
    }
  ],
  "focus": []
}
`;

// Direct Groq JSON request fallback
async function callGroq(apiKey: string, model: string, system: string, user: string) {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'openai/gpt-oss-120b',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Erreur Groq ${resp.status}`);
  }

  const json = await resp.json();
  return parseJSON(json.choices[0].message.content);
}

// Groq Whisper audio transcription
async function groqTranscribe(apiKey: string, model: string, wavBuffer: Buffer): Promise<string> {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const parts: Buffer[] = [];

  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model || 'whisper-large-v3-turbo'}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="speech.wav"\r\nContent-Type: audio/wav\r\n\r\n`
  ));
  parts.push(wavBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Erreur transcription Groq: ${resp.status}`);
  }

  const j = await resp.json();
  return j.text || '';
}

// Unified AI generator supporting Gemini SDK and Groq fallback
async function executeAIText(options: {
  system: string;
  user: string;
  customGeminiKey?: string;
  customGroqKey?: string;
  geminiModel?: string;
  groqModel?: string;
}) {
  const geminiKey = options.customGeminiKey?.trim() || process.env.GEMINI_API_KEY?.trim() || '';
  const groqKey = options.customGroqKey?.trim() || '';
  const geminiModel = options.geminiModel || 'gemini-2.5-flash';

  if (geminiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const resp = await ai.models.generateContent({
        model: geminiModel,
        contents: [
          {
            role: 'user',
            parts: [{ text: options.user }],
          },
        ],
        config: {
          systemInstruction: options.system,
          responseMimeType: 'application/json',
          temperature: 0.4,
        },
      });

      const text = resp.text || '';
      return { data: parseJSON(text), by: 'Gemini' };
    } catch (err: any) {
      if (!groqKey) {
        throw new Error(err?.message || 'Erreur Gemini');
      }
    }
  }

  if (groqKey) {
    const data = await callGroq(groqKey, options.groqModel || 'openai/gpt-oss-120b', options.system, options.user);
    return { data, by: 'Groq' };
  }

  throw new Error('Aucune clé API configurée. Veuillez ajouter une clé Gemini ou Groq dans les Paramètres.');
}

// Config endpoint to tell client if server has a preconfigured Gemini key
app.get('/api/config', (_req: Request, res: Response) => {
  res.json({
    hasServerGeminiKey: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),
  });
});

// 1. Topic Speaking Topics Generation
app.post('/api/generate-topics', async (req: Request, res: Response) => {
  try {
    const { word, level = 'B1', usedTopics = [], customGeminiKey, customGroqKey, customGeminiModel, customGroqModel } = req.body;

    if (!word || typeof word !== 'string' || !word.trim()) {
      return res.status(400).json({ error: 'Écris un mot d’abord.' });
    }

    const system = `
You are an English speaking practice teacher.
Create exactly 5 genuinely different English speaking topics.
The student gives ONE English word.
The required difficulty level is ${level}.

IMPORTANT:
- Match the requested CEFR level exactly.
- A1: very simple vocabulary, short direct questions, familiar everyday situations.
- A2: simple but slightly richer vocabulary and familiar personal/social situations.
- B1: intermediate vocabulary, reasons, opinions, examples, and comparisons.
- B2: more nuanced ideas, arguments, consequences, comparisons, and moderately advanced vocabulary.
- C1: sophisticated ideas, nuanced arguments, abstract concepts, precise vocabulary, and deeper critical thinking.
- Do not make the topics harder than the selected level.
- Do not repeat any previously used topic.
- Do not make tiny variations of old topics.
- Each topic must have a clearly different angle.
- Use clear, natural English appropriate for the selected level.
- Questions must allow the student to speak for about 3 minutes.
- Make topics useful for English practice.

Return JSON exactly:
{
  "topics":[
    {
      "title":"...",
      "question":"..."
    }
  ]
}
Return exactly 5 topics.
`;

    const user = `
English word: "${word.trim()}"
Difficulty level: ${level}
Previously used topics for this word:
${JSON.stringify(usedTopics)}

Create 5 completely new topics at exactly the requested level.
`;

    const result = await executeAIText({
      system,
      user,
      customGeminiKey,
      customGroqKey,
      geminiModel: customGeminiModel,
      groqModel: customGroqModel,
    });

    const topics = Array.isArray(result.data?.topics) ? result.data.topics.slice(0, 5) : [];
    if (topics.length < 5) {
      throw new Error("L'IA n’a pas retourné 5 sujets.");
    }

    return res.json({ topics, by: result.by });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Erreur lors de la génération des sujets.' });
  }
});

// 2. Speed Speaking Topic Generation
app.post('/api/generate-speed-topic', async (req: Request, res: Response) => {
  try {
    const { word, usedTopics = [], customGeminiKey, customGroqKey, customGeminiModel, customGroqModel } = req.body;

    if (!word || typeof word !== 'string' || !word.trim()) {
      return res.status(400).json({ error: 'Écris un mot d’abord.' });
    }

    const system = `
You are an English speaking speed-practice teacher.
Create ONE genuinely new speaking topic based on the student's word.

IMPORTANT:
- Never repeat a previous topic.
- Do not make a tiny variation of a previous topic.
- Use a different angle.
- The question must be open-ended.
- The student will speak for only 30 seconds.
- Use simple, natural English.

Return exactly:
{
  "topic":{
    "title":"...",
    "question":"..."
  }
}
`;

    const user = `
English word: "${word.trim()}"
Previously used topics:
${JSON.stringify(usedTopics)}

Create ONE completely new topic.
`;

    const result = await executeAIText({
      system,
      user,
      customGeminiKey,
      customGroqKey,
      geminiModel: customGeminiModel,
      groqModel: customGroqModel,
    });

    const topic = result.data?.topic;
    if (!topic || !topic.question) {
      throw new Error('Aucun sujet reçu.');
    }

    return res.json({ topic, by: result.by });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Erreur lors de la génération du sujet.' });
  }
});

// 3. Audio Analysis for Topic Speaking
app.post('/api/analyze-topic', async (req: Request, res: Response) => {
  try {
    const {
      word,
      topicTitle,
      question,
      audioBase64,
      customGeminiKey,
      customGroqKey,
      customGeminiModel,
      customGroqModel,
      customWhisperModel,
      mimeType,
      textResponse,
    } = req.body;

    if (!audioBase64 && !textResponse) {
      return res.status(400).json({ error: 'Enregistrement audio ou texte manquant.' });
    }

    const context = `
Word: "${word || ''}"
Topic: "${topicTitle || ''}"
Question: "${question || ''}"
${textResponse ? `\nStudent answer:\n"${textResponse}"\n` : ''}

Analyze the student's spoken answer very carefully as an English teacher.

MANDATORY RECAP:
- Write a short French recap of what the student actually explained or said.
- The recap must summarize the student's ideas, not invent information.
- The recap must never be empty when a usable transcript exists.

MANDATORY ERROR AUDIT:
1. First produce the transcript as accurately as possible.
2. Read the transcript again sentence by sentence.
3. Check grammar, tense, articles, prepositions, singular/plural agreement,
   subject-verb agreement, word choice, and word order.
4. Separate genuine English mistakes from hesitation phenomena.
5. Repeated words, false starts, fillers, pauses, and self-corrections are NOT errors
   unless the final intended sentence itself contains a genuine English mistake.
6. Do not give "errors: []" when the transcript contains a genuine English mistake.
7. Do not mark every imperfect spoken phrase as an error; use normal spoken-English judgment.
8. NEVER invent an error from a possible transcription mistake. If the audio/transcript
   is unclear, leave that part uncorrected.
9. For every error, copy the student's actual phrase into 'said'. The 'said' text must
   be traceable to the transcript/audio, with only punctuation/capitalization differences.
10. A correction must fix a real mistake, not merely replace correct English with a
    more sophisticated, more native-like, or stylistically different alternative.
11. There is NO maximum number of errors. Report every genuine error that can be
    supported by the student's actual speech. Do not omit real errors to keep the list short.
12. If the same genuine mistake is repeated, do not silently discard it as hesitation.
13. Repetition by itself is NOT an English error. If the student repeats a grammatically
    correct phrase or sentence, do NOT create a "Vocabulary / repetition" error.

Return in JSON:
{
 "transcript":"",
 "summary":"",
 "strengths":[],
 "errors":[
   {
     "said":"",
     "correct":"",
     "explanation":"",
     "category":""
   }
 ],
 "pronunciation":[
   {
     "word":"",
     "tip":""
   }
 ],
 "new_vocabulary":[
   {
     "word":"",
     "meaning":""
   }
 ],
 "focus":[]
}
`;

    const geminiKey = customGeminiKey?.trim() || process.env.GEMINI_API_KEY?.trim() || '';
    const groqKey = customGroqKey?.trim() || '';

    if (geminiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const parts: any[] = [{ text: context }];
        if (audioBase64) {
          parts.push({
            inlineData: {
              mimeType: mimeType || 'audio/wav',
              data: audioBase64,
            },
          });
        }

        const resp = await ai.models.generateContent({
          model: customGeminiModel || 'gemini-2.5-flash',
          contents: [
            {
              role: 'user',
              parts,
            },
          ],
          config: {
            systemInstruction: TEACHER_RULES,
            responseMimeType: 'application/json',
            temperature: 0.4,
          },
        });

        const text = resp.text || '';
        return res.json({ data: parseJSON(text), by: 'Gemini' });
      } catch (err: any) {
        if (!groqKey) {
          throw err;
        }
      }
    }

    if (groqKey) {
      let transcript = textResponse || '';
      if (audioBase64) {
        const wavBuffer = Buffer.from(audioBase64, 'base64');
        transcript = await groqTranscribe(groqKey, customWhisperModel || 'whisper-large-v3-turbo', wavBuffer);
      }
      const data = await callGroq(
        groqKey,
        customGroqModel || 'openai/gpt-oss-120b',
        TEACHER_RULES + '\nPronunciation must be [].',
        context + '\nTranscript:\n' + transcript
      );
      return res.json({ data, by: 'Groq' });
    }

    throw new Error('Clé API manquante pour analyser l’audio.');
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Erreur lors de l’analyse audio.' });
  }
});

// 4. Audio Analysis for Speed Speaking
app.post('/api/analyze-speed', async (req: Request, res: Response) => {
  try {
    const {
      word,
      topicTitle,
      question,
      audioBase64,
      customGeminiKey,
      customGroqKey,
      customGeminiModel,
      customGroqModel,
      customWhisperModel,
      mimeType,
      textResponse,
    } = req.body;

    if (!audioBase64 && !textResponse) {
      return res.status(400).json({ error: 'Enregistrement audio ou texte manquant.' });
    }

    const context = `
Word: "${word || ''}"
Topic: "${topicTitle || ''}"
Question: "${question || ''}"
${textResponse ? `\nStudent response:\n"${textResponse}"\n` : ''}
The student had approximately 30 seconds to answer.

Analyze:
1. English mistakes
2. Speaking speed
3. Naturalness
4. Strengths
5. What to improve

IMPORTANT:
Pauses, "uh", "um", repeated words, false starts and self-corrections
are NOT English mistakes. Repetition by itself is NOT an English error.
Do not create a "Vocabulary / repetition" correction just because the student
repeated a grammatically correct phrase. Only report a repeated phrase when
the phrase itself contains a genuine English mistake.

Only report real grammar, tense, article, preposition, plural, agreement,
word-choice, or word-order errors. Do not rewrite correct English merely to
make it sound more native or sophisticated. If the speech/transcript is unclear,
do not invent an error. There is NO maximum number of errors: report every
genuine error that is clearly supported by the student's speech.

The transcript must contain everything the student said,
as accurately as possible. Do not replace it with a summary.

Return exactly in JSON:
{
 "transcript":"",
 "summary":"",
 "strengths":[],
 "errors":[],
 "pronunciation":[],
 "new_vocabulary":[],
 "focus":[]
}
`;

    const geminiKey = customGeminiKey?.trim() || process.env.GEMINI_API_KEY?.trim() || '';
    const groqKey = customGroqKey?.trim() || '';

    if (geminiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const parts: any[] = [{ text: context }];
        if (audioBase64) {
          parts.push({
            inlineData: {
              mimeType: mimeType || 'audio/wav',
              data: audioBase64,
            },
          });
        }

        const resp = await ai.models.generateContent({
          model: customGeminiModel || 'gemini-2.5-flash',
          contents: [
            {
              role: 'user',
              parts,
            },
          ],
          config: {
            systemInstruction: TEACHER_RULES,
            responseMimeType: 'application/json',
            temperature: 0.4,
          },
        });

        const text = resp.text || '';
        return res.json({ data: parseJSON(text), by: 'Gemini' });
      } catch (err: any) {
        if (!groqKey) {
          throw err;
        }
      }
    }

    if (groqKey) {
      let transcript = textResponse || '';
      if (audioBase64) {
        const wavBuffer = Buffer.from(audioBase64, 'base64');
        transcript = await groqTranscribe(groqKey, customWhisperModel || 'whisper-large-v3-turbo', wavBuffer);
      }
      const data = await callGroq(
        groqKey,
        customGroqModel || 'openai/gpt-oss-120b',
        TEACHER_RULES + '\nPronunciation must be [].',
        context + '\nTranscript:\n' + transcript
      );
      return res.json({ data, by: 'Groq' });
    }

    throw new Error('Clé API manquante pour analyser la vitesse.');
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Erreur lors de l’analyse de vitesse.' });
  }
});

// 5. Tap-to-Translate
app.post('/api/translate', async (req: Request, res: Response) => {
  try {
    const { word, context, customGeminiKey, customGroqKey, customGeminiModel, customGroqModel } = req.body;

    if (!word) {
      return res.status(400).json({ error: 'Mot manquant.' });
    }

    const system = `
You are a precise English-to-French dictionary assistant for an English learner.
Translate ONLY the requested English word as it is used in the provided sentence.
Return JSON exactly:
{
  "translation":""
}
Rules:
- Give the most natural French translation for this context.
- If there are two very common French meanings in this context, separate them with " / ".
- Do not give Creole.
- Do not give a long explanation.
- Do not replace the word with a different English word.
`;

    const user = `
English word: "${word}"
Sentence/context: "${context || word}"
Give the French translation of the word in this context.
`;

    const result = await executeAIText({
      system,
      user,
      customGeminiKey,
      customGroqKey,
      geminiModel: customGeminiModel,
      groqModel: customGroqModel,
    });

    const translation = String(result.data?.translation || '').trim();
    if (!translation) {
      throw new Error('Aucune traduction reçue.');
    }

    return res.json({ translation, by: result.by });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Erreur de traduction.' });
  }
});

// Setup Vite middleware in dev or static files in production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT}`);
  });
}

startServer();
