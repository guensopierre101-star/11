import React from 'react';
import { ActiveScreen } from '../types';

interface HeaderProps {
  screen: ActiveScreen;
  onNavigateHome: () => void;
}

const TITLES: Record<ActiveScreen, string> = {
  home: 'THE10th🎤',
  topic: 'Topic Speaking',
  speed: 'Speed Speaking',
  set: 'Paramètres',
};

export const Header: React.FC<HeaderProps> = ({ screen, onNavigateHome }) => {
  return (
    <header>
      {screen !== 'home' && (
        <button id="back" className="back-btn" onClick={onNavigateHome} style={{ display: 'flex' }}>
          ‹ Accueil
        </button>
      )}
      <b id="title">{TITLES[screen] || 'THE10th🎤'}</b>
    </header>
  );
};
