import { Topic, AnalysisResult } from '../types';
import { getSettings } from './storage';

export async function fetchServerConfig(): Promise<{ hasServerGeminiKey: boolean }> {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return { hasServerGeminiKey: false };
    return await res.json();
  } catch {
    return { hasServerGeminiKey: false };
  }
}

export async function apiGenerateTopics(
  word: string,
  level: string,
  usedTopics: string[]
): Promise<{ topics: Topic[]; by: string }> {
  const settings = getSettings();
  const res = await fetch('/api/generate-topics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      word,
      level,
      usedTopics,
      customGeminiKey: settings.gkey,
      customGroqKey: settings.rkey,
      customGeminiModel: settings.gmodel,
      customGroqModel: settings.rmodel,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || `Erreur ${res.status}`);
  }
  return json;
}

export async function apiGenerateSpeedTopic(
  word: string,
  usedTopics: string[]
): Promise<{ topic: Topic; by: string }> {
  const settings = getSettings();
  const res = await fetch('/api/generate-speed-topic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      word,
      usedTopics,
      customGeminiKey: settings.gkey,
      customGroqKey: settings.rkey,
      customGeminiModel: settings.gmodel,
      customGroqModel: settings.rmodel,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || `Erreur ${res.status}`);
  }
  return json;
}

export async function apiAnalyzeTopic(
  word: string,
  topicTitle: string,
  question: string,
  audioBase64?: string,
  mimeType: string = 'audio/wav',
  textResponse?: string
): Promise<{ data: AnalysisResult; by: string }> {
  const settings = getSettings();
  const res = await fetch('/api/analyze-topic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      word,
      topicTitle,
      question,
      audioBase64,
      mimeType,
      textResponse,
      customGeminiKey: settings.gkey,
      customGroqKey: settings.rkey,
      customGeminiModel: settings.gmodel,
      customGroqModel: settings.rmodel,
      customWhisperModel: settings.wmodel,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || `Erreur ${res.status}`);
  }
  return json;
}

export async function apiAnalyzeSpeed(
  word: string,
  topicTitle: string,
  question: string,
  audioBase64?: string,
  mimeType: string = 'audio/wav',
  textResponse?: string
): Promise<{ data: AnalysisResult; by: string }> {
  const settings = getSettings();
  const res = await fetch('/api/analyze-speed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      word,
      topicTitle,
      question,
      audioBase64,
      mimeType,
      textResponse,
      customGeminiKey: settings.gkey,
      customGroqKey: settings.rkey,
      customGeminiModel: settings.gmodel,
      customGroqModel: settings.rmodel,
      customWhisperModel: settings.wmodel,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || `Erreur ${res.status}`);
  }
  return json;
}

export async function apiTranslate(
  word: string,
  context: string
): Promise<{ translation: string; by: string }> {
  const settings = getSettings();
  const res = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      word,
      context,
      customGeminiKey: settings.gkey,
      customGroqKey: settings.rkey,
      customGeminiModel: settings.gmodel,
      customGroqModel: settings.rmodel,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error || `Erreur ${res.status}`);
  }
  return json;
}
