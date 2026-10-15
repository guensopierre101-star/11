import React, { useState, useEffect } from 'react';
import { getSettings, saveSettings } from '../services/storage';
import { fetchServerConfig } from '../services/api';

export const SettingsScreen: React.FC = () => {
  const [gkey, setGkey] = useState('');
  const [rkey, setRkey] = useState('');
  const [gmodel, setGmodel] = useState('gemini-2.5-flash');
  const [rmodel, setRmodel] = useState('openai/gpt-oss-120b');
  const [wmodel, setWmodel] = useState('whisper-large-v3-turbo');
  const [msg, setMsg] = useState('');
  const [hasServerKey, setHasServerKey] = useState(false);

  useEffect(() => {
    const s = getSettings();
    setGkey(s.gkey);
    setRkey(s.rkey);
    setGmodel(s.gmodel);
    setRmodel(s.rmodel);
    setWmodel(s.wmodel);

    fetchServerConfig().then((cfg) => {
      setHasServerKey(cfg.hasServerGeminiKey);
    });
  }, []);

  const handleSave = () => {
    saveSettings({
      gkey,
      rkey,
      gmodel,
      rmodel,
      wmodel,
    });
    setMsg('Enregistré ✅');
    setTimeout(() => {
      setMsg('');
    }, 4000);
  };

  return (
    <div>
      {hasServerKey && (
        <div className="card" style={{ borderLeft: '4px solid #2e9e5b', background: '#f2fbf5' }}>
          <b style={{ color: '#1f8a4c' }}>✨ Clé Gemini serveur détectée</b>
          <p className="muted" style={{ margin: '4px 0 0', color: '#2e493a' }}>
            Une clé Gemini est déjà configurée côté serveur. L’application fonctionne directement sans configuration manuelle.
          </p>
        </div>
      )}

      <div className="card">
        <b>Gemini — principal</b>
        <p className="muted">La clé reste uniquement dans le navigateur.</p>

        <label htmlFor="gkey">Clé Gemini</label>
        <input
          id="gkey"
          type="password"
          placeholder="AIza..."
          autoComplete="new-password"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck="false"
          value={gkey}
          onChange={(e) => setGkey(e.target.value)}
        />

        <label htmlFor="gmodel">Modèle Gemini</label>
        <input
          id="gmodel"
          value={gmodel}
          onChange={(e) => setGmodel(e.target.value)}
        />
      </div>

      <div className="card">
        <b>Groq — secours</b>

        <label htmlFor="rkey">Clé Groq</label>
        <input
          id="rkey"
          type="password"
          placeholder="gsk_..."
          autoComplete="new-password"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck="false"
          value={rkey}
          onChange={(e) => setRkey(e.target.value)}
        />

        <label htmlFor="rmodel">Modèle Groq</label>
        <input
          id="rmodel"
          value={rmodel}
          onChange={(e) => setRmodel(e.target.value)}
        />

        <label htmlFor="wmodel">Modèle Whisper</label>
        <input
          id="wmodel"
          value={wmodel}
          onChange={(e) => setWmodel(e.target.value)}
        />
      </div>

      <button className="btn" id="saveSet" onClick={handleSave}>
        Enregistrer
      </button>

      {msg && (
        <p className="muted" id="setMsg" style={{ fontWeight: 600, color: '#2e9e5b', marginTop: '10px', textAlign: 'center' }}>
          {msg}
        </p>
      )}
    </div>
  );
};
