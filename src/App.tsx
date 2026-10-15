import React, { useState } from 'react';
import { ActiveScreen } from './types';
import { Header } from './components/Header';
import { HomeScreen } from './components/HomeScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { TopicSpeakingScreen } from './components/TopicSpeakingScreen';
import { SpeedSpeakingScreen } from './components/SpeedSpeakingScreen';
import { TapToTranslateModal } from './components/TapToTranslateModal';

export const App: React.FC = () => {
  const [activeScreen, setActiveScreen] = useState<ActiveScreen>('home');
  const [translateState, setTranslateState] = useState<{
    isOpen: boolean;
    word: string;
    context: string;
  }>({
    isOpen: false,
    word: '',
    context: '',
  });

  const handleNavigate = (screen: ActiveScreen) => {
    setActiveScreen(screen);
    window.scrollTo(0, 0);
  };

  const handleOpenTranslate = (word: string, context: string) => {
    setTranslateState({
      isOpen: true,
      word,
      context,
    });
  };

  const handleCloseTranslate = () => {
    setTranslateState((prev) => ({ ...prev, isOpen: false }));
  };

  return (
    <>
      <Header screen={activeScreen} onNavigateHome={() => handleNavigate('home')} />

      <main>
        {activeScreen === 'home' && <HomeScreen onNavigate={handleNavigate} />}
        {activeScreen === 'topic' && (
          <TopicSpeakingScreen onTranslateWord={handleOpenTranslate} />
        )}
        {activeScreen === 'speed' && (
          <SpeedSpeakingScreen onTranslateWord={handleOpenTranslate} />
        )}
        {activeScreen === 'set' && <SettingsScreen />}
      </main>

      <TapToTranslateModal
        isOpen={translateState.isOpen}
        word={translateState.word}
        context={translateState.context}
        onClose={handleCloseTranslate}
      />
    </>
  );
};

export default App;
