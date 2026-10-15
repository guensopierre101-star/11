import { AppSettings, Topic, ErrorItem, PronunciationItem, VocabularyItem } from '../types';

export const S = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch {
      return d;
    }
  },

  set<T>(k: string, v: T): void {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

export function getSettings(): AppSettings {
  const savedGroqModel = S.get<string>('rmodel', '');
  const rmodel =
    savedGroqModel === 'llama-3.3-70b-versatile' || !savedGroqModel
      ? 'openai/gpt-oss-120b'
      : savedGroqModel;

  return {
    gkey: S.get('gkey', ''),
    rkey: S.get('rkey', ''),
    gmodel: S.get('gmodel', 'gemini-2.5-flash'),
    rmodel: rmodel,
    wmodel: S.get('wmodel', 'whisper-large-v3-turbo'),
  };
}

export function saveSettings(settings: AppSettings): void {
  S.set('gkey', settings.gkey.trim());
  S.set('rkey', settings.rkey.trim());
  S.set('gmodel', settings.gmodel.trim() || 'gemini-2.5-flash');
  S.set('rmodel', settings.rmodel.trim() || 'openai/gpt-oss-120b');
  S.set('wmodel', settings.wmodel.trim() || 'whisper-large-v3-turbo');
}

export function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

export function getUsedTopics(word: string): string[] {
  const all = S.get<Record<string, string[]>>('usedTopicsByWord', {});
  return all[normalizeWord(word)] || [];
}

export function saveUsedTopics(word: string, topics: Topic[]): void {
  const all = S.get<Record<string, string[]>>('usedTopicsByWord', {});
  const key = normalizeWord(word);

  if (!all[key]) {
    all[key] = [];
  }

  topics.forEach((t) => {
    const text = ((t.title || '') + ' | ' + (t.question || '')).trim();
    if (text && !all[key].includes(text)) {
      all[key].push(text);
    }
  });

  all[key] = all[key].slice(-100);
  S.set('usedTopicsByWord', all);
}

export function toList<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || (value as any) === '') return [];
  return [value];
}

export function textValue(value: any): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    return (
      value.text ||
      value.tip ||
      value.explanation ||
      value.meaning ||
      value.word ||
      JSON.stringify(value)
    );
  }
  return String(value ?? '');
}

export function normalizeErrors(value: any): ErrorItem[] {
  return toList(value).map((x: any) => {
    if (x && typeof x === 'object') {
      return {
        said: String(x.said || ''),
        correct: String(x.correct || ''),
        explanation: String(x.explanation || ''),
        category: String(x.category || ''),
      };
    }
    return {
      said: String(x || ''),
      correct: '',
      explanation: '',
      category: '',
    };
  });
}

export function normalizePronunciation(value: any): PronunciationItem[] {
  return toList(value).map((x: any) => {
    if (x && typeof x === 'object') {
      return {
        word: String(x.word || ''),
        tip: String(x.tip || ''),
      };
    }
    return {
      word: String(x || ''),
      tip: '',
    };
  });
}

export function normalizeVocabulary(value: any): VocabularyItem[] {
  return toList(value).map((x: any) => {
    if (x && typeof x === 'object') {
      return {
        word: String(x.word || ''),
        meaning: String(x.meaning || ''),
      };
    }
    return {
      word: String(x || ''),
      meaning: '',
    };
  });
}
