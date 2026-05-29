"use client";
import React, { useRef } from 'react';
import { useApp } from '@/context/AppContext';

interface Job {
  title: string;
  link: string;
  snippet: string;
  source: string;
}

const LOADING_HTML = (jobTitle: string) => `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Generating Resume — Ape X Job Hunt</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:20px;padding:24px;text-align:center}
  img{width:120px;opacity:.85}
  .title{font-size:15px;color:#555;letter-spacing:.01em}
  .job{font-size:13px;color:#888;max-width:320px;line-height:1.4}
  .dots::after{content:'';animation:dots 1.4s steps(4,end) infinite}
  @keyframes dots{0%{content:''}25%{content:'.'}50%{content:'..'}75%{content:'...'}100%{content:''}}
</style>
</head>
<body>
  <img src="https://cdn.myportfolio.com/abc1e0ab-7370-4502-8c78-92428397bf66/15a26956-0efa-4a8d-be26-27a030f18db9.png?h=6a5aea5f291cc6ed6573f41e6a765bf2" alt="Ape X" />
  <p class="title">Generating your ATS resume<span class="dots"></span></p>
  <p class="job">${jobTitle}</p>
</body>
</html>`;

const ERROR_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Error — Ape X Job Hunt</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;background:#f5f5f7;padding:24px;text-align:center}
  img{width:100px;opacity:.5}
  p{font-size:14px;color:#c00}
  small{font-size:12px;color:#999}
</style>
</head>
<body>
  <img src="https://cdn.myportfolio.com/abc1e0ab-7370-4502-8c78-92428397bf66/15a26956-0efa-4a8d-be26-27a030f18db9.png?h=6a5aea5f291cc6ed6573f41e6a765bf2" alt="Ape X" />
  <p>Resume generation failed.</p>
  <small>Close this tab and try again.</small>
</body>
</html>`;

function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
}

function writeToTab(tab: Window, html: string) {
  tab.document.open();
  tab.document.write(html);
  tab.document.close();
}

export default function JobList({ jobs }: { jobs: Job[] }) {
  const {
    geminiKey,
    parsedResume,
    atsProcessing,
    setAtsProcessing,
    markJobReady,
    readyToApplyJobs,
  } = useApp();

  const generatedHtmlRef = useRef<Map<string, string>>(new Map());
  // For mobile: store pending result keyed by job link
  const pendingMobileRef = useRef<Map<string, string>>(new Map());

  // Core fetch — JD extract then ATS rewrite
  async function runATS(job: Job): Promise<string> {
    // Step 1: fetch JD text (fast, no AI)
    const jdRes = await fetch('/api/jd-extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobUrl: job.link, snippet: job.snippet }),
    });
    const jdData = await jdRes.json();
    const jobText = jdData.text || job.snippet;

    // Step 2: ATS rewrite with pre-parsed resume + JD text
    const atsRes = await fetch('/api/ats', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gemini-key': geminiKey,
      },
      body: JSON.stringify({ jobText, snippet: job.snippet, parsedResume }),
    });
    const atsData = await atsRes.json();
    if (!atsData.html) throw new Error(atsData.error || 'No HTML returned');
    return atsData.html;
  }

  // DESKTOP: open blank tab immediately, write loading, write result when ready
  function handleDesktop(job: Job) {
    const tab = window.open('', '_blank');
    if (!tab) return;
    writeToTab(tab, LOADING_HTML(job.title));
    setAtsProcessing(job.link, true);

    runATS(job)
      .then(html => {
        writeToTab(tab, html);
        generatedHtmlRef.current.set(job.link, html);
        markJobReady(job.link);
      })
      .catch(() => writeToTab(tab, ERROR_HTML))
      .finally(() => setAtsProcessing(job.link, false));
  }

  // MOBILE: show inline loading indicator, generate, then open blob URL via anchor click
  function handleMobile(job: Job) {
    setAtsProcessing(job.link, true);

    // Store a flag so the UI shows "generating" state
    pendingMobileRef.current.set(job.link, 'pending');

    runATS(job)
      .then(html => {
        pendingMobileRef.current.delete(job.link);
        generatedHtmlRef.current.set(job.link, html);
        markJobReady(job.link);

        // Use blob URL + programmatic anchor click — works on mobile Safari
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoke after delay to allow tab to load
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      })
      .catch(() => {
        pendingMobileRef.current.delete(job.link);
        alert('Resume generation failed. Please try again.');
      })
      .finally(() => setAtsProcessing(job.link, false));
  }

  function handleATS(job: Job) {
    if (isMobile()) {
      handleMobile(job);
    } else {
      handleDesktop(job);
    }
  }

  function handleReopenResume(job: Job) {
    const html = generatedHtmlRef.current.get(job.link);
    if (!html) return;
    if (isMobile()) {
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } else {
      const tab = window.open('', '_blank');
      if (tab) writeToTab(tab, html);
    }
  }

  if (!jobs.length) {
    return (
      <div className="text-center py-16">
        <p className="text-lg font-medium text-gray-600 mb-2">No matching jobs found</p>
        <p className="text-sm text-gray-400">Try adjusting your job titles and searching again.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {jobs.map((job, i) => {
        const isDone = readyToApplyJobs.has(job.link);
        const isProcessing = atsProcessing[job.link];
        return (
          <div
            key={i}
            className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 hover:border-gray-300 transition"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="font-semibold text-gray-900 text-sm leading-snug">{job.title}</h3>
                  {isDone && (
                    <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                      ✓ Resume ready
                    </span>
                  )}
                </div>
                <p className="text-blue-600 text-xs mb-2">{job.source}</p>
                <p className="text-gray-500 text-sm leading-relaxed line-clamp-3">{job.snippet}</p>
                {isProcessing && (
                  <p className="text-amber-600 text-xs mt-2 animate-pulse">
                    Generating resume — this takes about 30 seconds...
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <a
                  href={job.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 px-3 py-2 rounded-xl text-center transition whitespace-nowrap"
                >
                  View Job
                </a>
                {isDone ? (
                  <button
                    onClick={() => handleReopenResume(job)}
                    className="text-xs font-medium px-3 py-2 rounded-xl transition whitespace-nowrap bg-green-50 border border-green-200 text-green-700 hover:bg-green-100"
                  >
                    ↗ Resume done
                  </button>
                ) : (
                  <button
                    onClick={() => !isProcessing && handleATS(job)}
                    disabled={isProcessing}
                    className={`text-xs font-medium px-3 py-2 rounded-xl transition whitespace-nowrap ${
                      isProcessing
                        ? 'bg-gray-900 text-white opacity-60 cursor-wait'
                        : 'bg-gray-900 hover:bg-gray-800 text-white active:bg-gray-700'
                    }`}
                  >
                    {isProcessing ? 'Generating...' : 'ATS Resume'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
