import React, { useState, useRef, useEffect } from 'react';
import { Topic, AnalysisResult, CEFRLevel } from '../types';
import { getUsedTopics, saveUsedTopics } from '../services/storage';
import { toWavOrOriginal, blobToB64, getSupportedAudioMimeType } from '../services/audio';
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
  const [isStartingMic, setIsStartingMic] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(TOPIC_MAX_SECONDS);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analyzedBy, setAnalyzedBy] = useState<string>('');
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);

  // Alternative input modes
  const [textModeIndex, setTextModeIndex] = useState<number | null>(null);
  const [textResponses, setTextResponses] = useState<Record<number, string>>({});

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const levelIntervalRef = useRef<any>(null);
  const startTimeRef = useRef<number>(0);
  const resultRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeUploadIndexRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      cleanupRecording();
    };
  }, []);

  const cleanupRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (levelIntervalRef.current) clearInterval(levelIntervalRef.current);

    try {
      audioContextRef.current?.close();
    } catch {}
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
    setMicError(null);
    setTextModeIndex(null);

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
      setRecordingIndex(index);
      setTimeLeft(TOPIC_MAX_SECONDS);
      startTimeRef.current = Date.now();
      setIsStartingMic(false);

      // Setup audio level visualizer
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          if (ctx.state === 'suspended') {
            await ctx.resume();
          }
          audioContextRef.current = ctx;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          const source = ctx.createMediaStreamSource(stream);
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          levelIntervalRef.current = setInterval(() => {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const avg = sum / dataArray.length;
            setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
          }, 100);
        }
      } catch (e) {
        console.warn('Audio level visualizer initialization skipped:', e);
      }

      const mimeType = getSupportedAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const duration = (Date.now() - startTimeRef.current) / 1000;
        const chunks = audioChunksRef.current.slice();
        const detectedType = recorder.mimeType || 'audio/webm';

        cleanupRecording();
        setRecordingIndex(null);
        setAudioLevel(0);

        if (duration < 1.5) {
          setMicError('Enregistrement trop court. Parlez pendant au moins quelques secondes avant de terminer.');
          return;
        }

        const rawBlob = new Blob(chunks, { type: detectedType });
        await handleAnalyzeAudio(rawBlob, index);
      };

      recorder.start(250);

      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            stopRecording();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err: any) {
      setIsStartingMic(false);
      console.error('Microphone access failed:', err);
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

  const handleAnalyzeAudio = async (rawBlob: Blob, idx: number) => {
    const topic = topics[idx];
    if (!topic) return;

    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);

    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    try {
      const { blob: finalBlob, mimeType } = await toWavOrOriginal(rawBlob);
      const b64 = await blobToB64(finalBlob);
      const res = await apiAnalyzeTopic(word, topic.title, topic.question, b64, mimeType);
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const idx = activeUploadIndexRef.current;
    const topic = topics[idx];
    if (!topic) return;

    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);

    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    try {
      const b64 = await blobToB64(file);
      const res = await apiAnalyzeTopic(word, topic.title, topic.question, b64, file.type || 'audio/wav');
      setAnalysisResult(res.data);
      setAnalyzedBy(res.by);
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

  const handleAnalyzeText = async (idx: number) => {
    const topic = topics[idx];
    const text = textResponses[idx]?.trim();
    if (!topic || !text) return;

    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisResult(null);

    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);

    try {
      const res = await apiAnalyzeTopic(word, topic.title, topic.question, undefined, undefined, text);
      setAnalysisResult(res.data);
      setAnalyzedBy(res.by);
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    } catch (err: any) {
      setAnalysisError(err?.message || "Impossible d'analyser votre réponse écrite.");
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
      {/* Hidden file input for audio file upload */}
      <input
        type="file"
        ref={fileInputRef}
        accept="audio/*,.mp3,.wav,.m4a,.webm,.aac,.ogg"
        style={{ display: 'none' }}
        onChange={handleFileUpload}
      />

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

      {/* Topics list */}
      <div id="topics">
        {topics.map((t, i) => {
          const isCurrentRecording = recordingIndex === i;
          const isOtherRecording = recordingIndex !== null && recordingIndex !== i;
          const isTextMode = textModeIndex === i;

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
                <div style={{ margin: '14px 0', padding: '12px', background: '#fdf2f2', borderRadius: '12px', border: '1px solid #fed7d7' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', background: '#e5484d', animation: 'pulse 1.2s infinite' }}></span>
                    <span style={{ fontWeight: 700, color: '#e5484d', fontSize: '14px' }}>ENREGISTREMENT EN COURS</span>
                  </div>

                  <div className="rec" style={{ margin: '4px 0' }}>{formatTimer(timeLeft)}</div>

                  <div className="bar" style={{ margin: '8px 0' }}>
                    <i
                      style={{
                        width: `${((TOPIC_MAX_SECONDS - timeLeft) / TOPIC_MAX_SECONDS) * 100}%`,
                      }}
                    />
                  </div>

                  {/* Audio wave level meter */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                    <span style={{ fontSize: '12px', color: '#6a7390' }}>Niveau micro :</span>
                    <div style={{ flex: 1, height: '6px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.min(100, audioLevel * 1.5)}%`,
                          background: audioLevel > 15 ? '#2e9e5b' : '#3182ce',
                          transition: 'width 0.1s ease',
                        }}
                      />
                    </div>
                  </div>

                  <p className="muted" style={{ textAlign: 'center', marginTop: '8px', marginBottom: 0 }}>
                    Parle librement. Quand tu as terminé, clique sur Terminer ci-dessous.
                  </p>
                </div>
              )}

              {/* Text mode input area */}
              {isTextMode && (
                <div style={{ margin: '12px 0', padding: '12px', background: '#f7f8fc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  <label style={{ margin: '0 0 6px', fontWeight: 600, color: '#1c2333' }}>
                    ✍️ Écris ta réponse en anglais (mode sans micro) :
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
                    placeholder="Type what you want to say in English..."
                    value={textResponses[i] || ''}
                    onChange={(e) =>
                      setTextResponses((prev) => ({ ...prev, [i]: e.target.value }))
                    }
                  />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button
                      className="btn green"
                      style={{ flex: 2, padding: '10px 14px', fontSize: '14px' }}
                      onClick={() => handleAnalyzeText(i)}
                      disabled={isAnalyzing || !textResponses[i]?.trim()}
                    >
                      🚀 Analyser ma réponse
                    </button>
                    <button
                      className="btn gray"
                      style={{ flex: 1, padding: '10px 14px', fontSize: '14px' }}
                      onClick={() => setTextModeIndex(null)}
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                <button
                  className={`btn ${isCurrentRecording ? 'red' : ''}`}
                  style={{ flex: 2 }}
                  onClick={() => {
                    if (isCurrentRecording) {
                      stopRecording();
                    } else {
                      startRecording(i);
                    }
                  }}
                  disabled={isOtherRecording || isAnalyzing || isStartingMic}
                >
                  {isStartingMic && recordingIndex === null
                    ? '⏳ Connexion micro…'
                    : isCurrentRecording
                    ? '⏹ Terminer'
                    : '🎤 Parler — 3 min max'}
                </button>

                {/* Alternative: File Upload */}
                <button
                  className="btn gray"
                  style={{ flex: 1, minWidth: '130px', padding: '10px 12px', fontSize: '13px' }}
                  onClick={() => {
                    activeUploadIndexRef.current = i;
                    fileInputRef.current?.click();
                  }}
                  disabled={isCurrentRecording || isAnalyzing}
                  title="Téléverser un mémo vocal ou fichier audio"
                >
                  📁 Audio
                </button>

                {/* Alternative: Text Mode */}
                <button
                  className="btn gray"
                  style={{ flex: 1, minWidth: '120px', padding: '10px 12px', fontSize: '13px' }}
                  onClick={() => setTextModeIndex(isTextMode ? null : i)}
                  disabled={isCurrentRecording || isAnalyzing}
                  title="Écrire ma réponse"
                >
                  ✍️ Écrit
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Results / Status container */}
      <div ref={resultRef} id="topicResult">
        {isAnalyzing && (
          <div className="card">
            <b>Analyse en cours…</b>
            <p className="muted">Gemini analyse ta réponse en détail.</p>
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
