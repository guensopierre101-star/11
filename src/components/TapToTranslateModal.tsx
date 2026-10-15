import React, { useEffect, useState } from 'react';
import { apiTranslate } from '../services/api';

interface TapToTranslateModalProps {
  word: string;
  context: string;
  isOpen: boolean;
  onClose: () => void;
}

const translationCache = new Map<string, string>();

export const TapToTranslateModal: React.FC<TapToTranslateModalProps> = ({
  word,
  context,
  isOpen,
  onClose,
}) => {
  const [translation, setTranslation] = useState<string>('Recherche…');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !word) return;

    const cacheKey = (word + '\n' + context).toLowerCase();
    if (translationCache.has(cacheKey)) {
      setTranslation(translationCache.get(cacheKey)!);
      setError(null);
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setTranslation('Recherche…');
    setError(null);

    apiTranslate(word, context)
      .then((res) => {
        if (!isMounted) return;
        const trans = res.translation || 'Aucune traduction trouvée';
        translationCache.set(cacheKey, trans);
        setTranslation(trans);
        setLoading(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err?.message || 'Erreur lors de la traduction.');
        setTranslation('');
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, word, context]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSpeak = () => {
    if (!word || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  };

  if (!isOpen) return null;

  return (
    <div
      className="translate-backdrop on"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-hidden={!isOpen}
    >
      <div className="translate-box" role="dialog" aria-modal="true" aria-labelledby="translateWord">
        <div className="translate-top">
          <div className="translate-word" id="translateWord">
            {word}
          </div>
          <button className="translate-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </div>

        <div className="translate-label">🇫🇷 Traduction française</div>
        <div className="translate-result" id="translateResult">
          {loading && <span className="muted">Traduction en cours…</span>}
          {error && <span style={{ color: '#e5484d', fontSize: '15px' }}>⚠️ {error}</span>}
          {!loading && !error && translation}
        </div>

        <div className="translate-label">Contexte</div>
        <div className="translate-context" id="translateContext">
          {context || word}
        </div>

        <div className="translate-actions">
          <button className="btn gray" onClick={handleSpeak}>
            🔊 Écouter
          </button>
          <button className="btn" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
