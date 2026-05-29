"use client";
import React, { useRef } from 'react';
import { useApp } from '@/context/AppContext';

interface Job {
  title: string;
  link: string;
  snippet: string;
  source: string;
}

const LOADING_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Generating Resume — Ape X Job Hunt</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #f5f5f7;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    flex-direction: column;
    gap: 24px;
  }
  img { width: 120px; opacity: 0.85; }
  .msg { font-size: 15px; color: #555; letter-spacing: 0.01em; }
  .dots { display: inline-block; }
  .dots::after {
    content: '';
    animation: dots 1.4s steps(4, end) infinite;
  }
  @keyframes dots {
    0%   { content: ''; }
    25%  { content: '.'; }
    50%  { content: '..'; }
    75%  { content: '...'; }
    100% { content: ''; }
  }
</style>
</head>
<body>
  <img src="https://cdn.myportfolio.com/abc1e0ab-7370-4502-8c78-92428397bf66/15a26956-0efa-4a8d-be26-27a030f18db9.png?h=6a5aea5f291cc6ed6573f41e6a765bf2" alt="Ape X Job Hunt" />
  <p class="msg">Generating your ATS resume<span class="dots"></span></p>
</body>
</html>`;

export default function JobList({ jobs }: { jobs: Job[] }) {
  const {
    geminiKey, rawResumeText, atsProcessing,
    setAtsProcessing, markJobReady, readyToApplyJobs,
    contact, education,
  } = useApp();

  // Store generated HTML per job link so Resume Done can re-open it
  const generatedHtmlRef = useRef<Map<string, string>>(new Map());

  const openResumeTab = (html: string): Window | null => {
    const tab = window.open('', '_blank');
    if (tab) {
      tab.document.open();
      tab.document.write(html);
      tab.document.close();
    }
    return tab;
  };

  const handleATS = (job: Job) => {
    // Open tab immediately inside user gesture — bypasses popup blocker
    const tab = window.open('', '_blank');
    if (!tab) return;

    // Write loading screen synchronously before any await
    tab.document.open();
    tab.document.write(LOADING_HTML);
    tab.document.close();

    setAtsProcessing(job.link, true);

    fetch('/api/ats', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-gemini-key': geminiKey,
      },
      body: JSON.stringify({
        jobUrl: job.link,
        resumeText: rawResumeText,
        snippet: job.snippet,
        contact,
        education,
      }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.html) {
          // Write final resume into the already-open tab
          tab.document.open();
          tab.document.write(data.html);
          tab.document.close();
          // Store so Resume Done can re-open
          generatedHtmlRef.current.set(job.link, data.html);
          markJobReady(job.link);
        } else {
          tab.document.open();
          tab.document.write('<p style="font-family:sans-serif;padding:40px;color:#c00">Resume generation failed. Please try again.</p>');
          tab.document.close();
        }
      })
      .catch(err => {
        console.error('ATS failed:', err);
        tab.document.open();
        tab.document.write('<p style="font-family:sans-serif;padding:40px;color:#c00">Resume generation failed. Please try again.</p>');
        tab.document.close();
      })
      .finally(() => {
        setAtsProcessing(job.link, false);
      });
  };

  const handleReopenResume = (job: Job) => {
    const html = generatedHtmlRef.current.get(job.link);
    if (html) {
      openResumeTab(html);
    }
  };

  if (!jobs.length) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-lg font-medium text-gray-600 mb-2">No matching jobs found</p>
        <p className="text-sm">Try adjusting your job titles and searching again.</p>
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
            className="bg-white border border-gray-200 rounded-2xl p-5 hover:border-gray-300 transition"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="font-semibold text-gray-900 text-sm leading-snug">{job.title}</h3>
                  {isDone && (
                    <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">
                      ✓ Resume ready
                    </span>
                  )}
                </div>
                <p className="text-blue-600 text-xs mb-2">{job.source}</p>
                <p className="text-gray-500 text-sm leading-relaxed line-clamp-3">{job.snippet}</p>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <a
                  href={job.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 px-4 py-2 rounded-xl text-center transition whitespace-nowrap"
                >
                  View Job
                </a>
                {isDone ? (
                  <button
                    onClick={() => handleReopenResume(job)}
                    className="text-xs font-medium px-4 py-2 rounded-xl transition whitespace-nowrap bg-green-50 border border-green-200 text-green-700 hover:bg-green-100"
                  >
                    ↗ Resume done
                  </button>
                ) : (
                  <button
                    onClick={() => !isProcessing && handleATS(job)}
                    disabled={isProcessing}
                    className={`text-xs font-medium px-4 py-2 rounded-xl transition whitespace-nowrap ${
                      isProcessing
                        ? 'bg-gray-900 text-white opacity-60 cursor-wait'
                        : 'bg-gray-900 hover:bg-gray-800 text-white'
                    }`}
                  >
                    {isProcessing ? 'Processing...' : 'ATS Resume'}
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
