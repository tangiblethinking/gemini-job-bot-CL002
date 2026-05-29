"use client";

import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';
import TopNav from '@/components/TopNav';
import ApiKeySidesheet from '@/components/ApiKeySidesheet';
import JobTitleChips from '@/components/JobTitleChips';
import JobList from '@/components/JobList';
import Image from 'next/image';

export default function Page() {
  const {
    appState, setAppState,
    setRawResumeText, setParsedResume,
    setSearchTitles, setContact,
    geminiKey, serperKey, searchTitles,
  } = useApp();

  const [jobs, setJobs] = useState<any[]>([]);
  const [searchError, setSearchError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');
    setUploading(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'x-gemini-key': geminiKey },
        body: formData,
      });

      if (res.status === 422) {
        setUploadError('This PDF looks like a scanned image. Please upload a text-based PDF.');
        return;
      }

      const data = await res.json();

      if (data.error) {
        setUploadError('Resume extraction failed. Please try again.');
        return;
      }

      // Store everything in context
      setRawResumeText(data.rawText || '');
      setParsedResume(data.parsedResume || null);
      setSearchTitles(data.titles || []);
      setContact(data.contact || { name: '' });
      setAppState('PARSED');

    } catch (err) {
      console.error('Extract failed:', err);
      setUploadError('Resume extraction failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchTitles.length) {
      setSearchError('Please add at least one job title before searching.');
      return;
    }
    setSearchError('');
    setAppState('SEARCHING');
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-serper-key': serperKey,
        },
        body: JSON.stringify({ titles: searchTitles }),
      });
      const data = await res.json();
      setJobs(Array.isArray(data) ? data : []);
      setAppState('RESULTS');
    } catch (err) {
      console.error('Search failed:', err);
      setSearchError('Search request failed. Please try again.');
      setAppState('PARSED');
    }
  };

  const hasKeys = !!(geminiKey && serperKey);

  return (
    <>
      <TopNav />
      <ApiKeySidesheet />
      <main className="max-w-3xl mx-auto px-6 py-12">

        {appState === 'IDLE' && (
          <div className="text-center py-16">
            <div className="flex justify-center mb-6">
              <Image
                src="https://cdn.myportfolio.com/abc1e0ab-7370-4502-8c78-92428397bf66/15a26956-0efa-4a8d-be26-27a030f18db9.png?h=6a5aea5f291cc6ed6573f41e6a765bf2"
                alt="Ape X Job Hunt"
                width={180}
                height={48}
                style={{ objectFit: 'contain', height: '48px', width: 'auto' }}
                priority
                unoptimized
              />
            </div>
            <p className="text-gray-500 text-base mb-8">Upload your resume to get started.</p>

            {!hasKeys && (
              <div className="mb-6 inline-flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 text-sm px-4 py-2 rounded-xl">
                ⚠ Set your API keys first — click &ldquo;API Keys&rdquo; in the top right
              </div>
            )}

            {uploadError && (
              <p className="text-red-500 text-sm mb-4">{uploadError}</p>
            )}

            <label
              className={`cursor-pointer inline-flex items-center gap-2 font-medium px-8 py-4 rounded-2xl transition text-sm ${
                hasKeys
                  ? 'bg-gray-900 hover:bg-gray-800 text-white'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed pointer-events-none'
              }`}
            >
              {uploading ? 'Parsing resume...' : '↑ Upload Resume (PDF)'}
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileUpload}
                className="hidden"
                disabled={!hasKeys || uploading}
              />
            </label>

            {uploading && (
              <p className="text-gray-400 text-xs mt-4">
                Reading and structuring your resume — this takes about 15 seconds
              </p>
            )}
          </div>
        )}

        {(appState === 'PARSED' || appState === 'SEARCHING' || appState === 'RESULTS') && (
          <>
            <JobTitleChips onSearch={handleSearch} />
            {searchError && <p className="text-red-500 mt-2 text-sm">{searchError}</p>}
          </>
        )}

        {appState === 'SEARCHING' && (
          <div className="text-center py-16">
            <div className="inline-flex items-center gap-3 text-gray-500 text-sm">
              <span className="animate-spin text-lg">⟳</span>
              Searching verified job boards...
            </div>
          </div>
        )}

        {appState === 'RESULTS' && (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-500">{jobs.length} roles found</p>
              <button
                onClick={handleSearch}
                className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 px-3 py-1.5 rounded-xl transition"
              >
                ↺ Re-run search
              </button>
            </div>
            <JobList jobs={jobs} />
          </>
        )}
      </main>
    </>
  );
}
