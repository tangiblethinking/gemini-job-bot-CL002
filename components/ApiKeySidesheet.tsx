"use client";
import React, { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';

type KeyStatus = 'idle' | 'saving' | 'valid' | 'invalid';

export default function ApiKeySidesheet() {
  const { geminiKey, serperKey, setApiKeys } = useApp();

  const [keysVerifiedThisSession, setKeysVerifiedThisSession] = useState(false);
  const [geminiInput, setGeminiInput] = useState('');
  const [serperInput, setSerperInput] = useState('');
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<KeyStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  // Auto-populate from saved keys on hydration
  useEffect(() => {
    if (geminiKey) setGeminiInput(geminiKey);
    if (serperKey) setSerperInput(serperKey);
  }, [geminiKey, serperKey]);

  const handleSaveAndVerify = async () => {
    const g = geminiInput.trim();
    const s = serperInput.trim();
    if (!g || !s) {
      setErrorMsg('Both keys are required.');
      setStatus('invalid');
      return;
    }

    setStatus('saving');
    setErrorMsg('');

    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geminiKey: g, serperKey: s }),
      });
      const data = await res.json();
      const gValid = data.gemini === 'valid';
      const sValid = data.serper === 'valid';

      if (gValid && sValid) {
        setApiKeys(g, s);
        setKeysVerifiedThisSession(true);
        setStatus('valid');
        setOpen(false);
      } else {
        setStatus('invalid');
        const problems = [];
        if (!gValid) problems.push('Gemini key is invalid');
        if (!sValid) problems.push('Serper key is invalid');
        setErrorMsg(problems.join(' · '));
      }
    } catch {
      setStatus('invalid');
      setErrorMsg('Could not reach verification endpoint. Check your connection.');
    }
  };

  const hasStoredKeys = !!(geminiKey && serperKey);
  const showVerified = keysVerifiedThisSession;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`fixed top-3 right-4 text-sm px-4 py-2 rounded-xl border transition z-50 ${
          showVerified
            ? 'bg-green-50 border-green-300 text-green-700'
            : hasStoredKeys
            ? 'bg-amber-50 border-amber-300 text-amber-700'
            : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
        }`}
      >
        API Keys {showVerified ? '✓' : hasStoredKeys ? '↻' : '⚠'}
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex justify-end">
          <div className="bg-white w-full max-w-sm h-full p-6 flex flex-col gap-5 border-l border-gray-200 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-gray-900 font-semibold text-lg">API Keys</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
            </div>

            {hasStoredKeys && !showVerified && status === 'idle' && (
              <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-xl px-3 py-2">
                Keys are saved but not verified this session. Save to verify they're still active.
              </div>
            )}

            {status === 'invalid' && errorMsg && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-3 py-2">
                {errorMsg}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="text-gray-500 text-sm">Gemini API Key</label>
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-form-type="other"
                value={geminiInput}
                onChange={e => { setGeminiInput(e.target.value); setStatus('idle'); setErrorMsg(''); setKeysVerifiedThisSession(false); }}
                placeholder="AIza..."
                className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 w-full font-mono"
              />
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:underline"
              >
                Get Gemini key ↗
              </a>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-gray-500 text-sm">Serper API Key</label>
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-form-type="other"
                value={serperInput}
                onChange={e => { setSerperInput(e.target.value); setStatus('idle'); setErrorMsg(''); setKeysVerifiedThisSession(false); }}
                placeholder="Enter Serper key..."
                className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 w-full font-mono"
              />
              <a
                href="https://serper.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:underline"
              >
                Get Serper key ↗
              </a>
            </div>

            <button
              onClick={handleSaveAndVerify}
              disabled={status === 'saving'}
              className={`mt-auto font-medium px-4 py-3 rounded-xl text-sm transition ${
                status === 'saving'
                  ? 'bg-gray-300 text-gray-500 cursor-wait'
                  : 'bg-gray-900 hover:bg-gray-800 text-white'
              }`}
            >
              {status === 'saving' ? 'Verifying...' : 'Save Keys'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
