import React, { useState, useRef, useEffect } from 'react';
import { Topic, AnalysisResult, SpeedAnalysisResult } from '../types';
import { getUsedTopics, saveUsedTopics, normalizeErrors } from '../services/storage';
import {
  toWav,
  blobToB64,
  SILENCE_THRESHOLD,
  countWords,
  getSpeedLabel,
  calculateSpeedScore,
} from '../services/audio';
import { apiGenerateSpeedTopic, apiAnalyzeSpeed } from '../services/api';
import { TapWordText } from './TapWordText';
import { AnalysisResultsView } from './AnalysisResultsView';

const SPEED_MAX_SECONDS = 30;

interface SpeedSpeakingScreenProps {
  onTranslateWord: (word: string, context: string) => void;
}

export const SpeedSpeakingScreen: React.FC<SpeedSpeakingScreenProps> = ({ onTranslateWord }) => {
  const [word, setWord] = useState('');
  const [topic, setTopic] = useState<Topic | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [speedMsg, setSpeedMsg] = useState('');

  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [speechStarted, setSpeechStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(SPEED_MAX_SECONDS);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [speedResult, setSpeedResult] = useState<SpeedAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Audio analysis refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const levelTimerRef = useRef<any>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const speechStartedRef = useRef(false);
  const challengeStartTimeRef = useRef(0);
  const lastSpeechTimeRef = useRef(0);
  const pauseCountRef = useRef(0);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, []);

  const cleanupAudio = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (levelTimerRef.current) clearInterval(levelTimerRef.current);

    try {
      audioSourceRef.current?.disconnect();
      analyserRef.current?.disconnect();
      audioContextRef.current?.close();
    } catch {}

    audioSourceRef.current = null;
    analyserRef.current = null;
    audioContextRef.current = null;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
    }
    audioStreamRef.current = null;
  };

  const handleGenerateTopic = async () => {
    const trimmed = word.trim();
    if (!trimmed) {
      setSpeedMsg('Écris un mot d’abord.');
      return;
    }

    setIsGenerating(true);
    setSpeedMsg('Création d’un nouveau sujet…');
    setTopic(null);
    setSpeedResult(null);
    setAnalysisError(null);

    const used = getUsedTopics(trimmed);

    try {
      const res = await apiGenerateSpeedTopic(trimmed, used);
      setTopic(res.topic);
      saveUsedTopics(trimmed, [res.topic]);
      setSpeedMsg(res.by === 'Groq' ? 'Groq utilisé comme secours.' : '');
    } catch (err: any) {
      setSpeedMsg('⚠️ ' + (err?.message || 'Erreur lors de la génération.'));
    } finally {
      setIsGenerating(false);
    }
  };

  const startSpeedTimer = () => {
    if (challengeStartTimeRef.current) return;

    challengeStartTimeRef.current = Date.now();
    setTimeLeft(SPEED_MAX_SECONDS);

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          stopRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const startAudioMeasurement = (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      audioSourceRef.current = source;

      const data = new Uint8Array(analyser.fftSize);
      speechStartedRef.current = false;
      challengeStartTimeRef.current = 0;
      lastSpeechTimeRef.current = Date.now();
      pauseCountRef.current = 0;

      levelTimerRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const now = Date.now();

        if (rms > SILENCE_THRESHOLD) {
          if (!speechStartedRef.current) {
            speechStartedRef.current = true;
            setSpeechStarted(true);
            startSpeedTimer();
          } else {
            if (now - lastSpeechTimeRef.current > 1000) {
              pauseCountRef.current++;
            }
          }
          lastSpeechTimeRef.current = now;
        }
      }, 200);
    } catch {}
  };

  const startRecording = async () => {
    if (mediaRecorderRef.current) return;

    if (!navigator.mediaDevices || !window.MediaRecorder) {
      alert('Ton navigateur ne supporte pas l’enregistrement.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      audioChunksRef.current = [];
      setIsRecording(true);
      setSpeechStarted(false);
      setTimeLeft(SPEED_MAX_SECONDS);
      speechStartedRef.current = false;
      challengeStartTimeRef.current = 0;
      pauseCountRef.current = 0;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const speakingDuration = challengeStartTimeRef.current
          ? (Date.now() - challengeStartTimeRef.current) / 1000
          : 0;

        const chunks = audioChunksRef.current.slice();
        const type = recorder.mimeType || 'audio/webm';

        cleanupAudio();
        setIsRecording(false);
        setSpeechStarted(false);

        if (speakingDuration < 2 && !speechStartedRef.current) {
          alert('Trop court ou aucune parole détectée, réessaie.');
          return;
        }

        const rawBlob = new Blob(chunks, { type });
        await handleAnalyze(rawBlob, speakingDuration);
      };

      recorder.start();
      startAudioMeasurement(stream);
    } catch {
      alert('Micro refusé ou indisponible. Autorise le microphone.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleAnalyze = async (rawBlob: Blob, speakingDuration: number) => {
    if (!topic) return;

    setIsAnalyzing(true);
    setAnalysisError(null);
    setSpeedResult(null);

    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    try {
      const wavBlob = await toWav(rawBlob);
      const b64 = await blobToB64(wavBlob);
      const res = await apiAnalyzeSpeed(word, topic.title, topic.question, b64);

      const transcript = String(res.data?.transcript || '');
      const wordCount = countWords(transcript);
      const speakingSeconds = Math.max(1, Math.min(30, Math.round(speakingDuration || 30)));
      const wpm = Math.round(wordCount / (speakingSeconds / 60));
      const errors = normalizeErrors(res.data?.errors);
      const speedLabel = getSpeedLabel(wpm);
      const score = calculateSpeedScore(wpm, pauseCountRef.current, errors.length);

      setSpeedResult({
        data: res.data,
        by: res.by,
        wpm,
        wordCount,
        pauses: pauseCountRef.current,
        score,
        speedLabel,
        challengeSeconds: speakingSeconds,
      });

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    } catch (err: any) {
      setAnalysisError(err?.message || 'Impossible d’analyser la vitesse.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div>
      <div className="card">
        <b>Speed Speaking</b>
        <p className="muted">
          Écris un mot. Tu recevras un seul nouveau sujet. Tu dois parler naturellement pendant 30
          secondes.
        </p>

        <input
          id="speedWord"
          placeholder="ex : travel"
          autoCapitalize="none"
          autoComplete="off"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleGenerateTopic();
          }}
        />

        <div style={{ marginTop: '10px' }}>
          <button
            className="btn"
            id="speedGen"
            onClick={handleGenerateTopic}
            disabled={isGenerating}
          >
            {isGenerating ? 'Création en cours…' : 'Générer un nouveau sujet'}
          </button>
        </div>

        {speedMsg && <p className="muted" id="speedMsg">{speedMsg}</p>}
      </div>

      {topic && (
        <div id="speedTopic">
          <div className="card topic">
            <span className="pill">Speed Speaking</span>

            <h3>
              <TapWordText
                text={topic.title || ''}
                context={topic.question || topic.title}
                onWordClick={onTranslateWord}
              />
            </h3>

            <p>
              <TapWordText
                text={topic.question || ''}
                context={topic.question || topic.title}
                onWordClick={onTranslateWord}
              />
            </p>

            {isRecording && (
              <div id="speedTimer" style={{ margin: '14px 0' }}>
                <div className="rec">0:{String(timeLeft).padStart(2, '0')}</div>
                <div className="bar">
                  <i
                    style={{
                      width: `${((SPEED_MAX_SECONDS - timeLeft) / SPEED_MAX_SECONDS) * 100}%`,
                    }}
                  />
                </div>
                <p className="muted" style={{ textAlign: 'center', marginTop: '6px' }}>
                  {speechStarted
                    ? 'Parle naturellement. Le chrono est lancé.'
                    : '🎤 Parle quand tu es prêt. Le chrono commence dès que tu commences à parler.'}
                </p>
              </div>
            )}

            <button
              className={`btn ${isRecording ? 'red' : ''}`}
              onClick={() => {
                if (isRecording) {
                  stopRecording();
                } else {
                  startRecording();
                }
              }}
              disabled={isAnalyzing}
            >
              {isRecording ? '⏹ Terminer' : '⚡ Parler — 30 secondes'}
            </button>
          </div>
        </div>
      )}

      {/* Results / Status container */}
      <div ref={resultRef} id="speedResult">
        {isAnalyzing && (
          <div className="card">
            <b>Analyse de ta vitesse…</b>
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

        {speedResult && !isAnalyzing && (
          <AnalysisResultsView
            result={speedResult.data}
            speedMeta={{
              by: speedResult.by,
              wpm: speedResult.wpm,
              wordCount: speedResult.wordCount,
              pauses: speedResult.pauses,
              score: speedResult.score,
              speedLabel: speedResult.speedLabel,
              challengeSeconds: speedResult.challengeSeconds,
            }}
          />
        )}
      </div>
    </div>
  );
};
