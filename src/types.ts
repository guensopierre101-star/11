export interface Topic {
  title: string;
  question: string;
}

export interface ErrorItem {
  said: string;
  correct: string;
  explanation: string;
  category?: string;
}

export interface PronunciationItem {
  word: string;
  tip: string;
}

export interface VocabularyItem {
  word: string;
  meaning: string;
}

export interface AnalysisResult {
  transcript?: string;
  summary?: string;
  strengths?: (string | any)[];
  errors?: (ErrorItem | any)[];
  pronunciation?: (PronunciationItem | any)[];
  new_vocabulary?: (VocabularyItem | any)[];
  focus?: (string | any)[];
}

export interface SpeedAnalysisResult {
  data: AnalysisResult;
  by: string;
  wpm: number;
  wordCount: number;
  pauses: number;
  score: number;
  speedLabel: string;
  challengeSeconds: number;
}

export interface AppSettings {
  gkey: string;
  rkey: string;
  gmodel: string;
  rmodel: string;
  wmodel: string;
}

export type ActiveScreen = 'home' | 'topic' | 'speed' | 'set';
export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
