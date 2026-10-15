import React, { useState, useRef, useEffect } from 'react';
import { Topic, AnalysisResult, CEFRLevel } from '../types';
import { getUsedTopics, saveUsedTopics } from '../services/storage';
import { toWav, blobToB64 } from '../services/audio';
import { apiGenerateTopics, apiAnalyzeTopic } from '../services/api';
import { TapWordText } from './TapWordText';
import { AnalysisResultsView } from './AnalysisResultsView';

const TOPIC_MAX_SECONDS = 180;

interface TopicSpeakingScreenProps {
  onTranslateWord: (word: string, context: string) => void;
}

export const TopicSpeakingScreen: React.FC<TopicSpeakingScreenProps> = ({ onTranslateWord }) => {
  const [word, setWord] = useState('');
  const [level, setLevel] = useState<CEFRLevel>('B1');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState('');

  // Recording state
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(TOPIC_MAX_SECONDS);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analyzedBy, setAnalyzedBy] = useState<string>('');
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);
  const resultRef = useRef<HTMLDivElement>(null);

  // Clean up recorder on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const handleGenerateTopics = async () => {
    const trimmed = word.trim();
    if (!trimmed) {
      setGenMsg('Écris un mot d’abord.');
      return;
    }

    setIsGenerating(true);
    setGenMsg(`Création de 5 sujets niveau ${level}…`);
    setTopics([]);
    setAnalysisResult(null);
    setAnalysisError(null);

    const used = getUsedTopics(trimmed);

    try {
      const res = await apiGenerateTopics(trimmed, level, used);
      const newTopics = res.topics.slice(0, 5);
      setTopics(newTopics);
      saveUsedTopics(trimmed, newTopics);

      setGenMsg(
        res.by === 'Groq'
          ? `Groq utilisé comme secours. Niveau ${level} généré.`
          : `5 sujets niveau ${level} prêts ✅`
      );
    } catch (err: any) {
      setGenMsg('⚠️ ' + (err?.message || 'Erreur lors de la génération.'));
    } finally {
      setIsGenerating(false);
    }
  };

  const startRecording = async (index: number) => {
    if (mediaRecorderRef.current) return;

    if (!navigator.mediaDevices || !window.MediaRecorder) {
      alert('Ton navigateur ne supporte pas l’enregistrement.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      audioChunksRef.current = [];
      setRecordingIndex(index);
      setTimeLeft(TOPIC_MAX_SECONDS);
      startTimeRef.current = Date.now();

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const duration = (Date.now() - startTimeRef.current) / 1000;
        const chunks = audioChunksRef.current.slice();
        const type = recorder.mimeType || 'audio/webm';

        // Cleanup stream & timer
        if (timerRef.current) clearInterval(timerRef.current);
        if (audioStreamRef.current) {
          audioStreamRef.current.getTracks().forEach((t) => t.stop());
        }
        mediaRecorderRef.current = null;
        audioStreamRef.current = null;
        setRecordingIndex(null);

        if (duration < 2) {
          alert('Trop court, réessaie.');
          return;
        }

        const rawBlob = new Blob(chunks, { type });
        await handleAnalyze(rawBlob, index);
      };

      recorder.start();

      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            stopRecording();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch {
      alert('Micro refusé ou indisponible. Autorise le microphone.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleAnalyze = async (rawBlob: Blob, idx: number) => {
    const topic = topics[idx];
    if (!topic) return;

    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);

    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    try {
      const wavBlob = await toWav(rawBlob);
      const b64 = await blobToB64(wavBlob);
      const res = await apiAnalyzeTopic(word, topic.title, topic.question, b64);
      setAnalysisResult(res.data);
      setAnalyzedBy(res.by);
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    } catch (err: any) {
      setAnalysisError(err?.message || 'Impossible d’analyser l’audio.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = String(secs % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div>
      <div className="card">
        <b>Topic Speaking</b>
        <p className="muted">
          Écris un mot anglais. Gemini créera 5 sujets réellement différents.
          Les anciens sujets sont mémorisés pour éviter les répétitions.
        </p>

        <input
          id="word"
          placeholder="ex : improve"
          autoCapitalize="none"
          autoComplete="off"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleGenerateTopics();
          }}
        />

        <label htmlFor="topicLevel">Niveau des sujets</label>
        <select
          id="topicLevel"
          value={level}
          onChange={(e) => setLevel(e.target.value as CEFRLevel)}
        >
          <option value="A1">A1 — Débutant</option>
          <option value="A2">A2 — Élémentaire</option>
          <option value="B1">B1 — Intermédiaire</option>
          <option value="B2">B2 — Intermédiaire avancé</option>
          <option value="C1">C1 — Avancé</option>
        </select>

        <p className="muted" style={{ margin: '8px 0 0' }}>
          Le niveau contrôle le vocabulaire, la complexité des questions et la difficulté du sujet.
        </p>

        <div style={{ marginTop: '10px' }}>
          <button
            className="btn"
            id="gen"
            onClick={handleGenerateTopics}
            disabled={isGenerating}
          >
            {isGenerating ? 'Génération en cours…' : 'Générer 5 nouveaux sujets'}
          </button>
        </div>

        {genMsg && <p className="muted" id="genMsg">{genMsg}</p>}
      </div>

      {/* Topics list */}
      <div id="topics">
        {topics.map((t, i) => {
          const isCurrentRecording = recordingIndex === i;
          const isOtherRecording = recordingIndex !== null && recordingIndex !== i;

          return (
            <div className="card topic" key={i}>
              <span className="pill">Sujet {i + 1}</span>

              <h3>
                <TapWordText
                  text={t.title || ''}
                  context={t.question || t.title}
                  onWordClick={onTranslateWord}
                />
              </h3>

              <p>
                <TapWordText
                  text={t.question || ''}
                  context={t.question || t.title}
                  onWordClick={onTranslateWord}
                />
              </p>

              {isCurrentRecording && (
                <div style={{ margin: '12px 0' }}>
                  <div className="rec">{formatTimer(timeLeft)}</div>
                  <div className="bar">
                    <i
                      style={{
                        width: `${((TOPIC_MAX_SECONDS - timeLeft) / TOPIC_MAX_SECONDS) * 100}%`,
                      }}
                    />
                  </div>
                  <p className="muted" style={{ textAlign: 'center', marginTop: '6px' }}>
                    Parle librement. Les pauses sont normales.
                  </p>
                </div>
              )}

              <button
                className={`btn ${isCurrentRecording ? 'red' : ''}`}
                onClick={() => {
                  if (isCurrentRecording) {
                    stopRecording();
                  } else {
                    startRecording(i);
                  }
                }}
                disabled={isOtherRecording || isAnalyzing}
              >
                {isCurrentRecording ? '⏹ Terminer' : '🎤 Parler — 3 min max'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Results / Status container */}
      <div ref={resultRef} id="topicResult">
        {isAnalyzing && (
          <div className="card">
            <b>Analyse en cours…</b>
            <p className="muted">Gemini analyse ton anglais.</p>
          </div>
        )}

        {analysisError && (
          <div className="card">
            <b>⚠️ Analyse impossible</b>
            <p>{analysisError}</p>
            <p className="muted">Réessaie.</p>
          </div>
        )}

        {analysisResult && !isAnalyzing && (
          <AnalysisResultsView result={analysisResult} by={analyzedBy} />
        )}
      </div>
    </div>
  );
};
