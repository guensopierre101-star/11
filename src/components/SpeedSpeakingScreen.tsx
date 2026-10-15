import React, { useState, useRef, useEffect } from 'react';
import { Topic, SpeedAnalysisResult } from '../types';
import { getUsedTopics, saveUsedTopics, normalizeErrors } from '../services/storage';
import {
  toWavOrOriginal,
  blobToB64,
  countWords,
  getSpeedLabel,
  calculateSpeedScore,
  getSupportedAudioMimeType,
} from '../services/audio';
import { apiGenerateSpeedTopic, apiAnalyzeSpeed } from '../services/api';
import { TapWordText } from './TapWordText';
import { AnalysisResultsView } from './AnalysisResultsView';

const SPEED_MAX_SECONDS = 30;
const VOICE_THRESHOLD = 0.008;

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
  const [isStartingMic, setIsStartingMic] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [speechStarted, setSpeechStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(SPEED_MAX_SECONDS);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [speedResult, setSpeedResult] = useState<SpeedAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Alternative input modes
  const [isTextMode, setIsTextMode] = useState(false);
  const [textResponse, setTextResponse] = useState('');

  // Audio analysis refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const levelTimerRef = useRef<any>(null);
  const autoStartTimerRef = useRef<any>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const speechStartedRef = useRef(false);
  const challengeStartTimeRef = useRef(0);
  const lastSpeechTimeRef = useRef(0);
  const pauseCountRef = useRef(0);
  const resultRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, []);

  const cleanupAudio = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (levelTimerRef.current) clearInterval(levelTimerRef.current);
    if (autoStartTimerRef.current) clearTimeout(autoStartTimerRef.current);

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
    setMicError(null);
    setIsTextMode(false);

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

  const triggerStartCountdown = () => {
    if (speechStartedRef.current) return;
    speechStartedRef.current = true;
    setSpeechStarted(true);
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
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      audioContextRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
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
        const levelPercent = Math.min(100, Math.round(rms * 400));
        setAudioLevel(levelPercent);

        const now = Date.now();

        if (rms > VOICE_THRESHOLD) {
          if (!speechStartedRef.current) {
            triggerStartCountdown();
          } else {
            if (now - lastSpeechTimeRef.current > 1000) {
              pauseCountRef.current++;
            }
          }
          lastSpeechTimeRef.current = now;
        }
      }, 150);

      // Auto-start timer after 3 seconds if silence detection didn't trigger
      autoStartTimerRef.current = setTimeout(() => {
        if (!speechStartedRef.current && isRecording) {
          triggerStartCountdown();
        }
      }, 3000);
    } catch (err) {
      console.warn('Audio measurement init failed:', err);
      autoStartTimerRef.current = setTimeout(() => {
        triggerStartCountdown();
      }, 1000);
    }
  };

  const startRecording = async () => {
    if (mediaRecorderRef.current) return;
    setMicError(null);
    setIsStartingMic(true);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setIsStartingMic(false);
      setMicError(
        "L'accès au microphone n'est pas supporté par ce navigateur ou est bloqué par la sécurité du site. Utilisez les options alternatives ci-dessous (importer un enregistrement ou écrire votre réponse)."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      audioStreamRef.current = stream;
      audioChunksRef.current = [];
      setIsRecording(true);
      setIsStartingMic(false);
      setSpeechStarted(false);
      setTimeLeft(SPEED_MAX_SECONDS);
      speechStartedRef.current = false;
      challengeStartTimeRef.current = 0;
      pauseCountRef.current = 0;

      const mimeType = getSupportedAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
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
        const detectedType = recorder.mimeType || 'audio/webm';

        cleanupAudio();
        setIsRecording(false);
        setSpeechStarted(false);
        setAudioLevel(0);

        if (speakingDuration < 1.5 && chunks.length === 0) {
          setMicError('Enregistrement trop court. Parlez pendant au moins quelques secondes.');
          return;
        }

        const rawBlob = new Blob(chunks, { type: detectedType });
        await handleAnalyzeAudio(rawBlob, Math.max(2, speakingDuration));
      };

      recorder.start(250);
      startAudioMeasurement(stream);
    } catch (err: any) {
      setIsStartingMic(false);
      console.error('Microphone error in speed speaking:', err);
      let errorMsg = "Impossible d'accéder au microphone.";
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.message?.includes('Permission denied')) {
        errorMsg = "L'accès au microphone a été refusé (Permission Denied). Votre navigateur a bloqué le micro.";
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMsg = "Aucun microphone détecté sur cet appareil.";
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        errorMsg = "Le microphone est déjà utilisé par une autre application.";
      }
      setMicError(errorMsg);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleAnalyzeAudio = async (rawBlob: Blob, speakingDuration: number) => {
    if (!topic) return;

    setIsAnalyzing(true);
    setAnalysisError(null);
    setSpeedResult(null);

    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    try {
      const { blob: finalBlob, mimeType } = await toWavOrOriginal(rawBlob);
      const b64 = await blobToB64(finalBlob);
      const res = await apiAnalyzeSpeed(word, topic.title, topic.question, b64, mimeType);

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !topic) return;

    setIsAnalyzing(true);
    setAnalysisError(null);
    setSpeedResult(null);

    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    try {
      const b64 = await blobToB64(file);
      const res = await apiAnalyzeSpeed(word, topic.title, topic.question, b64, file.type || 'audio/wav');
      const transcript = String(res.data?.transcript || '');
      const wordCount = countWords(transcript);
      const speakingSeconds = 30; // estimated challenge duration
      const wpm = Math.round(wordCount / (speakingSeconds / 60));
      const errors = normalizeErrors(res.data?.errors);
      const speedLabel = getSpeedLabel(wpm);
      const score = calculateSpeedScore(wpm, 1, errors.length);

      setSpeedResult({
        data: res.data,
        by: res.by,
        wpm,
        wordCount,
        pauses: 1,
        score,
        speedLabel,
        challengeSeconds: speakingSeconds,
      });

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    } catch (err: any) {
      setAnalysisError(err?.message || "Impossible d'analyser le fichier audio.");
    } finally {
      setIsAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAnalyzeText = async () => {
    const text = textResponse.trim();
    if (!topic || !text) return;

    setIsAnalyzing(true);
    setAnalysisError(null);
    setSpeedResult(null);

    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    try {
      const res = await apiAnalyzeSpeed(word, topic.title, topic.question, undefined, undefined, text);
      const wordCount = countWords(text);
      const speakingSeconds = 30;
      const wpm = Math.round(wordCount / (speakingSeconds / 60));
      const errors = normalizeErrors(res.data?.errors);
      const speedLabel = getSpeedLabel(wpm);
      const score = calculateSpeedScore(wpm, 0, errors.length);

      setSpeedResult({
        data: res.data,
        by: res.by,
        wpm,
        wordCount,
        pauses: 0,
        score,
        speedLabel,
        challengeSeconds: speakingSeconds,
      });

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    } catch (err: any) {
      setAnalysisError(err?.message || "Impossible d'analyser la réponse écrite.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div>
      {/* Hidden file input for audio file upload */}
      <input
        type="file"
        ref={fileInputRef}
        accept="audio/*,.mp3,.wav,.m4a,.webm,.aac,.ogg"
        style={{ display: 'none' }}
        onChange={handleFileUpload}
      />

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

      {/* Global mic error banner if permission failed */}
      {micError && (
        <div className="card" style={{ borderLeft: '4px solid #e5484d', background: '#fff6f6' }}>
          <b style={{ color: '#c0282d' }}>⚠️ Accès au microphone bloqué (Permission Denied)</b>
          <p style={{ margin: '6px 0 10px', fontSize: '14px', color: '#4f5872', lineHeight: 1.5 }}>
            {micError}
          </p>

          <div style={{ background: '#fff', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', color: '#394159', border: '1px solid #fed7d7', marginBottom: '12px' }}>
            <b>🔧 Comment autoriser le micro :</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: '18px', lineHeight: 1.6 }}>
              <li><b>Sur ordinateur (Chrome / Edge / Firefox) :</b> Cliquez sur l'icône de cadenas 🔒 ou de caméra à gauche de l'adresse du site (URL) &gt; activez <i>Microphone</i> &gt; rechargez la page.</li>
              <li><b>Sur téléphone / tablette :</b> Allez dans les réglages de votre navigateur &gt; <i>Paramètres de site</i> &gt; <i>Microphone</i> &gt; <i>Autoriser</i>.</li>
            </ul>
          </div>

          <p className="muted" style={{ fontSize: '13px', margin: '4px 0 0' }}>
            💡 <b>Pas de micro ?</b> Vous pouvez tout de même vous entraîner ci-dessous en <b>important un enregistrement audio</b> ou en <b>saisissant votre réponse par écrit</b>.
          </p>
        </div>
      )}

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
              <div id="speedTimer" style={{ margin: '14px 0', padding: '12px', background: '#fdf2f2', borderRadius: '12px', border: '1px solid #fed7d7' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', background: speechStarted ? '#2e9e5b' : '#e5484d', animation: 'pulse 1.2s infinite' }}></span>
                  <span style={{ fontWeight: 700, color: speechStarted ? '#2e9e5b' : '#e5484d', fontSize: '14px' }}>
                    {speechStarted ? 'CHRONOMÈTRE EN COURS (30s)' : 'EN ATTENTE DE TA VOIX…'}
                  </span>
                </div>

                <div className="rec">0:{String(timeLeft).padStart(2, '0')}</div>

                <div className="bar" style={{ margin: '8px 0' }}>
                  <i
                    style={{
                      width: `${((SPEED_MAX_SECONDS - timeLeft) / SPEED_MAX_SECONDS) * 100}%`,
                    }}
                  />
                </div>

                {/* Audio wave level meter */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                  <span style={{ fontSize: '12px', color: '#6a7390' }}>Son micro :</span>
                  <div style={{ flex: 1, height: '6px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, audioLevel * 2)}%`,
                        background: audioLevel > 15 ? '#2e9e5b' : '#3182ce',
                        transition: 'width 0.1s ease',
                      }}
                    />
                  </div>
                </div>

                <p className="muted" style={{ textAlign: 'center', marginTop: '8px', marginBottom: '6px' }}>
                  {speechStarted
                    ? 'Parle naturellement. Quand tu as fini, clique sur Terminer.'
                    : '🎤 Parle dès que tu es prêt : le chronomètre démarre dès que tu parles.'}
                </p>

                {!speechStarted && (
                  <div style={{ textAlign: 'center', marginTop: '6px' }}>
                    <button
                      className="btn gray"
                      style={{ padding: '8px 12px', fontSize: '13px', width: 'auto' }}
                      onClick={triggerStartCountdown}
                    >
                      ▶️ Lancer le chrono maintenant
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Text mode input area */}
            {isTextMode && (
              <div style={{ margin: '12px 0', padding: '12px', background: '#f7f8fc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                <label style={{ margin: '0 0 6px', fontWeight: 600, color: '#1c2333' }}>
                  ✍️ Écris ta réponse spontanée en anglais :
                </label>
                <textarea
                  rows={4}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: '8px',
                    border: '1px solid #cdd3e4',
                    fontSize: '15px',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                  }}
                  placeholder="Type your response in English (aim for ~40-60 words in 30 seconds)..."
                  value={textResponse}
                  onChange={(e) => setTextResponse(e.target.value)}
                />
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button
                    className="btn green"
                    style={{ flex: 2, padding: '10px 14px', fontSize: '14px' }}
                    onClick={handleAnalyzeText}
                    disabled={isAnalyzing || !textResponse.trim()}
                  >
                    🚀 Analyser ma réponse
                  </button>
                  <button
                    className="btn gray"
                    style={{ flex: 1, padding: '10px 14px', fontSize: '14px' }}
                    onClick={() => setIsTextMode(false)}
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
              <button
                className={`btn ${isRecording ? 'red' : ''}`}
                style={{ flex: 2 }}
                onClick={() => {
                  if (isRecording) {
                    stopRecording();
                  } else {
                    startRecording();
                  }
                }}
                disabled={isAnalyzing || isStartingMic}
              >
                {isStartingMic
                  ? '⏳ Connexion micro…'
                  : isRecording
                  ? '⏹ Terminer'
                  : '⚡ Parler — 30 secondes'}
              </button>

              {/* Alternative: File Upload */}
              <button
                className="btn gray"
                style={{ flex: 1, minWidth: '130px', padding: '10px 12px', fontSize: '13px' }}
                onClick={() => fileInputRef.current?.click()}
                disabled={isRecording || isAnalyzing}
                title="Téléverser un mémo vocal ou fichier audio"
              >
                📁 Audio
              </button>

              {/* Alternative: Text Mode */}
              <button
                className="btn gray"
                style={{ flex: 1, minWidth: '120px', padding: '10px 12px', fontSize: '13px' }}
                onClick={() => setIsTextMode(!isTextMode)}
                disabled={isRecording || isAnalyzing}
                title="Écrire ma réponse"
              >
                ✍️ Écrit
              </button>
            </div>
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
