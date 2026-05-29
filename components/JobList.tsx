"use client";
import React from 'react';
import { useApp } from '@/context/AppContext';

interface Job {
  title: string;
  link: string;
  snippet: string;
  source: string;
}

export default function JobList({ jobs }: { jobs: Job[] }) {
  const { geminiKey, rawResumeText, atsProcessing, setAtsProcessing, markJobReady, readyToApplyJobs, contact, education } = useApp();

  const handleATS = async (job: Job) => {
    setAtsProcessing(job.link, true);
    try {
      const res = await fetch('/api/ats', {
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
      });
      const data = await res.json();
      if (data.html) {
        const blob = new Blob([data.html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        markJobReady(job.link);
      }
    } catch (err) {
      console.error('ATS failed:', err);
    } finally {
      setAtsProcessing(job.link, false);
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
                <button
                  onClick={() => !isDone && handleATS(job)}
                  disabled={isProcessing || isDone}
                  className={`text-xs font-medium px-4 py-2 rounded-xl transition whitespace-nowrap ${
                    isDone
                      ? 'bg-green-50 border border-green-200 text-green-700 cursor-default'
                      : isProcessing
                      ? 'bg-gray-900 text-white opacity-60 cursor-wait'
                      : 'bg-gray-900 hover:bg-gray-800 text-white'
                  }`}
                >
                  {isDone ? 'Resume done' : isProcessing ? 'Processing...' : 'ATS Resume'}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
