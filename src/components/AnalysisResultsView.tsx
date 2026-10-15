import React from 'react';
import { AnalysisResult, SpeedAnalysisResult } from '../types';
import {
  normalizeErrors,
  normalizePronunciation,
  normalizeVocabulary,
  toList,
  textValue,
} from '../services/storage';

interface AnalysisResultsViewProps {
  result?: AnalysisResult;
  speedMeta?: Omit<SpeedAnalysisResult, 'data'>;
  by?: string;
}

export const AnalysisResultsView: React.FC<AnalysisResultsViewProps> = ({
  result,
  speedMeta,
  by,
}) => {
  if (!result) return null;

  const errors = normalizeErrors(result.errors);
  const strengths = toList(result.strengths).map(textValue);
  const pronunciation = normalizePronunciation(result.pronunciation);
  const vocabulary = normalizeVocabulary(result.new_vocabulary);
  const focus = toList(result.focus).map(textValue);

  return (
    <div style={{ marginTop: '16px' }}>
      {speedMeta ? (
        <>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>⚡ Speed Result</h2>
            <span className="tag">Analyse par {by || speedMeta.by}</span>

            <div className="score">{speedMeta.score}/100</div>

            <p style={{ textAlign: 'center', fontWeight: 600 }}>{speedMeta.speedLabel}</p>
          </div>

          <div className="row">
            <div className="stat">
              <b>{speedMeta.wpm}</b>
              <span>WPM</span>
            </div>
            <div className="stat">
              <b>{speedMeta.wordCount}</b>
              <span>Mots</span>
            </div>
            <div className="stat">
              <b>{speedMeta.pauses}</b>
              <span>Pauses</span>
            </div>
          </div>

          <div className="card" style={{ marginTop: '12px' }}>
            <h2 style={{ marginTop: 0 }}>📊 Détails</h2>
            <p>
              <b>Temps de parole : </b>
              {speedMeta.challengeSeconds}s
            </p>
            <p>
              <b>Vitesse : </b>
              {speedMeta.speedLabel}
            </p>
          </div>
        </>
      ) : (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>🎯 Ton résultat</h2>
          {by && <span className="tag">Analyse par {by}</span>}
        </div>
      )}

      {/* Recap */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>📝 Recap</h2>
        {result.summary ? (
          <p>{result.summary}</p>
        ) : (
          <p className="muted">Le recap n’a pas été retourné par l’IA.</p>
        )}
      </div>

      {/* Transcript */}
      {result.transcript && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>
            {speedMeta ? '📝 Tout ce que tu as dit' : 'Ce que tu as dit'}
          </h2>
          <p className="muted" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
            {result.transcript}
          </p>
        </div>
      )}

      {/* Errors & Corrections */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>
          {speedMeta ? '❌ ' : ''}Erreurs et corrections ({errors.length})
        </h2>

        {errors.length === 0 ? (
          <div className="good">Aucune erreur importante. Bravo ! 🎉</div>
        ) : (
          errors.map((x, i) => (
            <div className="err" key={i}>
              {x.category && <span className="tag">{x.category}</span>}
              <br />
              <span className="x">{x.said}</span>
              <br />
              <span className="ok">✅ {x.correct}</span>
              <br />
              <span className="muted">{x.explanation}</span>
            </div>
          ))
        )}
      </div>

      {/* Points forts */}
      {strengths.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{speedMeta ? '💪 ' : ''}Points forts</h2>
          {strengths.map((str, i) => (
            <div className="good" key={i}>
              {str}
            </div>
          ))}
        </div>
      )}

      {/* Prononciation */}
      {pronunciation.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{speedMeta ? '🗣️ ' : ''}Prononciation</h2>
          {pronunciation.map((item, i) => (
            <div className="err" key={i}>
              <b>{item.word}</b>
              <br />
              <span className="muted">{item.tip}</span>
            </div>
          ))}
        </div>
      )}

      {/* Nouveau vocabulaire */}
      {vocabulary.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{speedMeta ? '📚 ' : ''}Nouveau vocabulaire</h2>
          {vocabulary.map((vocab, i) => (
            <p key={i}>
              <b>{vocab.word}</b> : {vocab.meaning}
            </p>
          ))}
        </div>
      )}

      {/* Pour progresser */}
      {focus.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{speedMeta ? '🎯 ' : ''}Pour progresser</h2>
          {focus.map((f, i) => (
            <p key={i}>• {f}</p>
          ))}
        </div>
      )}
    </div>
  );
};
