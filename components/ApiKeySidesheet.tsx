"use client";
import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';

type KeyStatus = 'idle' | 'checking' | 'valid' | 'invalid';

export default function ApiKeySidesheet() {
  const { geminiKey, serperKey, setApiKeys } = useApp();
  const [geminiInput, setGeminiInput] = useState(geminiKey);
  const [serperInput, setSerperInput] = useState(serperKey);
  const [open, setOpen] = useState(false);
  const [geminiStatus, setGeminiStatus] = useState<KeyStatus>('idle');
  const [serperStatus, setSerperStatus] = useState<KeyStatus>('idle');

  const handleSave = () => {
    setApiKeys(geminiInput.trim(), serperInput.trim());
    setGeminiStatus('idle');
    setSerperStatus('idle');
    setOpen(false);
  };

  const verifyKeys = async () => {
    setGeminiStatus('checking');
    setSerperStatus('checking');
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geminiKey: geminiInput.trim(),
          serperKey: serperInput.trim(),
        }),
      });
      const data = await res.json();
      setGeminiStatus(data.gemini === 'valid' ? 'valid' : 'invalid');
      setSerperStatus(data.serper === 'valid' ? 'valid' : 'invalid');
    } catch {
      setGeminiStatus('invalid');
      setSerperStatus('invalid');
    }
  };

  const statusBadge = (status: KeyStatus) => {
    if (status === 'checking') return <span className="text-xs text-amber-600">Checking...</span>;
    if (status === 'valid') return <span className="text-xs text-green-600">✓ Valid</span>;
    if (status === 'invalid') return <span className="text-xs text-red-500">✗ Invalid</span>;
    return null;
  };

  const hasKeys = geminiKey && serperKey;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`fixed top-3 right-4 text-sm px-4 py-2 rounded-xl border transition z-50 ${
          hasKeys
            ? 'bg-green-50 border-green-300 text-green-700'
            : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
        }`}
      >
        API Keys {hasKeys ? '✓' : '⚠'}
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex justify-end">
          <div className="bg-white w-full max-w-sm h-full p-6 flex flex-col gap-5 border-l border-gray-200 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-gray-900 font-semibold text-lg">API Keys</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-gray-500 text-sm">Gemini API Key</label>
                {statusBadge(geminiStatus)}
              </div>
              <input
                type="password"
                value={geminiInput}
                onChange={e => setGeminiInput(e.target.value)}
                placeholder="AIza..."
                className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 w-full"
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-gray-500 text-sm">Serper API Key</label>
                {statusBadge(serperStatus)}
              </div>
              <input
                type="password"
                value={serperInput}
                onChange={e => setSerperInput(e.target.value)}
                placeholder="Enter Serper key..."
                className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 w-full"
              />
            </div>

            <button
              onClick={verifyKeys}
              disabled={geminiStatus === 'checking' || serperStatus === 'checking'}
              className="bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-sm px-4 py-2 rounded-xl border border-gray-200 transition"
            >
              Verify Keys
            </button>

            <button
              onClick={handleSave}
              className="mt-auto bg-gray-900 hover:bg-gray-800 text-white font-medium px-4 py-2 rounded-xl text-sm transition"
            >
              Save Keys
            </button>
          </div>
        </div>
      )}
    </>
  );
}
