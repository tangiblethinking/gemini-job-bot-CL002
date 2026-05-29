"use client";
import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';

export default function JobTitleChips({ onSearch }: { onSearch: () => void }) {
  const { searchTitles, setSearchTitles, appState } = useApp();
  const [input, setInput] = useState('');

  const addTitle = () => {
    const t = input.trim();
    if (t && !searchTitles.includes(t)) {
      setSearchTitles(prev => [...prev, t]);
    }
    setInput('');
  };

  const removeTitle = (t: string) => setSearchTitles(prev => prev.filter(x => x !== t));

  return (
    <div className="mb-6">
      <p className="text-gray-500 text-sm mb-3">Job titles to search — edit or add more before searching</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {searchTitles.map(t => (
          <span
            key={t}
            className="flex items-center gap-2 bg-gray-100 border border-gray-200 text-gray-700 text-sm px-3 py-1.5 rounded-full"
          >
            {t}
            <button
              onClick={() => removeTitle(t)}
              className="text-gray-400 hover:text-gray-700 leading-none"
              aria-label={`Remove ${t}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTitle()}
          placeholder="Add a title and press Enter..."
          className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 flex-1"
        />
        <button
          onClick={addTitle}
          className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-xl text-sm border border-gray-200 transition"
        >
          Add
        </button>
        <button
          onClick={onSearch}
          disabled={appState === 'SEARCHING' || searchTitles.length === 0}
          className="bg-gray-900 hover:bg-gray-800 disabled:opacity-40 text-white font-medium px-6 py-2 rounded-xl text-sm transition"
        >
          {appState === 'SEARCHING' ? 'Searching...' : 'Search Jobs'}
        </button>
      </div>
    </div>
  );
}
