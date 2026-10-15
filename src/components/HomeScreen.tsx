import React from 'react';
import { ActiveScreen } from '../types';

interface HomeScreenProps {
  onNavigate: (screen: ActiveScreen) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ onNavigate }) => {
  return (
    <div className="menu">
      <button onClick={() => onNavigate('topic')}>
        <span className="ic">🎤</span>
        <span>
          Topic Speaking
          <small>1 mot → 5 sujets différents → parle 3 min</small>
        </span>
      </button>

      <button onClick={() => onNavigate('speed')}>
        <span className="ic">⚡</span>
        <span>
          Speed Speaking
          <small>1 mot → 1 nouveau sujet → parle 30 secondes</small>
        </span>
      </button>

      <button onClick={() => onNavigate('set')}>
        <span className="ic">⚙️</span>
        <span>
          Paramètres
          <small>Clés Gemini et Groq</small>
        </span>
      </button>
    </div>
  );
};
