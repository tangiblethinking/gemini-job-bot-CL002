"use client";
import React, { useRef } from 'react';
import { useApp } from '@/context/AppContext';

interface Job {
  title: string;
  company: string;   // extracted company name — overline
  link: string;
  snippet: string;
  source: string;    // domain fallback
}

// ─── Resume overlay (mobile) ──────────────────────────────────────────────────

function ResumeOverlay({ html, onClose }: { html: string; onClose: () => void }) {
  React.useEffect(() => {
    window.history.pushState({ resumeOverlay: true }, '');
    const handlePop = () => onClose();
    window.addEventListener('popstate', handlePop);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('popstate', handlePop);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#fff', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#1a1a1a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', gap: 10, flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer' }}>
          ← Back to Results
        </button>
        <button onClick={() => window.print()} style={{ background: '#007aff', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          Save as PDF
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', background: '#fff' }} dangerouslySetInnerHTML={{ __html: extractBody(html) }} />
    </div>
  );
}

function extractBody(html: string): string {
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  let styles = styleMatch ? `<style>${styleMatch[1]}</style>` : '';
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let body = bodyMatch ? bodyMatch[1] : html;
  // Remove the action-bar since overlay renders its own
  body = body.replace(/<div class="action-bar">[\s\S]*?<\/div>/, '');
  // Remove margin-top that was added for the action-bar
  body = body.replace(/margin-top:\s*52px/, 'margin-top: 0');
  body = body.replace(/margin-top:\s*60px/, 'margin-top: 0');
  return styles + body;
}

// ─── Static HTML strings for desktop tab ─────────────────────────────────────

const LOADING_HTML = (jobTitle: string) => `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Generating Resume</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#f5f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:20px;padding:24px;text-align:center}img{width:100px;opacity:.85}p{font-size:14px;color:#555}small{font-size:12px;color:#888;max-width:300px;line-height:1.4}.dots::after{content:'';animation:d 1.4s steps(4,end) infinite}@keyframes d{0%{content:''}25%{content:'.'}50%{content:'..'}75%{content:'...'}100%{content:'...'}}</style>
</head><body>
<img src="https://cdn.myportfolio.com/abc1e0ab-7370-4502-8c78-92428397bf66/15a26956-0efa-4a8d-be26-27a030f18db9.png?h=6a5aea5f291cc6ed6573f41e6a765bf2" alt="Ape X"/>
<p>Generating ATS resume<span class="dots"></span></p>
<small>${jobTitle}</small>
</body></html>`;

// Desktop error: window.close() returns user to the app tab (blank tab has no history)
const ERROR_HTML = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:16px;background:#f5f5f7;padding:24px;text-align:center}img{width:80px;opacity:.4}p{font-size:14px;color:#c00}small{font-size:12px;color:#999}.b{background:#1a1a1a;color:#fff;border:none;border-radius:10px;padding:10px 24px;font-size:14px;cursor:pointer;margin-top:8px}</style>
</head><body>
<img src="https://cdn.myportfolio.com/abc1e0ab-7370-4502-8c78-92428397bf66/15a26956-0efa-4a8d-be26-27a030f18db9.png?h=6a5aea5f291cc6ed6573f41e6a765bf2" alt="Ape X"/>
<p>Resume generation failed.</p>
<small>Please go back and try again.</small>
<button class="b" onclick="window.close()">← Go Back</button>
</body></html>`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
}

function writeToTab(tab: Window, html: string) {
  tab.document.open();
  tab.document.write(html);
  tab.document.close();
}

// Inject window.close() into the Back button of the generated resume HTML (desktop tab)
function injectDesktopClose(html: string): string {
  // Replace history.back() in the action bar back button with window.close()
  return html.replace(
    /onclick="history\.back\(\)"/g,
    'onclick="window.close()"'
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function JobList({ jobs }: { jobs: Job[] }) {
  const { geminiKey, parsedResume, atsProcessing, setAtsProcessing, markJobReady, readyToApplyJobs } = useApp();
  const generatedHtmlRef = useRef<Map<string, string>>(new Map());
  const [overlayHtml, setOverlayHtml] = React.useState<string | null>(null);

  async function runATS(job: Job): Promise<string> {
    const jdRes = await fetch('/api/jd-extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobUrl: job.link, snippet: job.snippet }),
    });
    const jdData = await jdRes.json();
    const jobText = jdData.text || job.snippet;

    const atsRes = await fetch('/api/ats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-gemini-key': geminiKey },
      body: JSON.stringify({
        jobText,
        snippet: job.snippet,
        parsedResume,
        // Pass clean title only — company already extracted
        jobTitle: job.title,
      }),
    });
    const atsData = await atsRes.json();
    if (!atsData.html) throw new Error(atsData.error || 'No HTML returned');
    return atsData.html;
  }

  // DESKTOP: new tab — use window.close() for back navigation
  function handleDesktop(job: Job) {
    const tab = window.open('', '_blank');
    if (!tab) return;
    writeToTab(tab, LOADING_HTML(job.title));
    setAtsProcessing(job.link, true);
    runATS(job)
      .then(html => {
        // Inject window.close() so Back button works from a tab with no prior history
        const desktopHtml = injectDesktopClose(html);
        writeToTab(tab, desktopHtml);
        generatedHtmlRef.current.set(job.link, html); // store original (with history.back) for mobile reopen
        markJobReady(job.link);
      })
      .catch(() => writeToTab(tab, ERROR_HTML))
      .finally(() => setAtsProcessing(job.link, false));
  }

  // MOBILE: in-page overlay — popstate handles back
  function handleMobile(job: Job) {
    setAtsProcessing(job.link, true);
    setOverlayHtml(
      `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-family:-apple-system,sans-serif;color:#555;font-size:14px;flex-direction:column;gap:12px;padding:24px;text-align:center">
        <p>Generating resume...</p>
        <small style="color:#999;font-size:12px">${job.title}</small>
      </div>`
    );
    runATS(job)
      .then(html => {
        generatedHtmlRef.current.set(job.link, html);
        markJobReady(job.link);
        setOverlayHtml(html);
      })
      .catch(() => {
        setOverlayHtml(null);
        alert('Resume generation failed. Please try again.');
      })
      .finally(() => setAtsProcessing(job.link, false));
  }

  function handleATS(job: Job) {
    isMobile() ? handleMobile(job) : handleDesktop(job);
  }

  function handleReopenResume(job: Job) {
    const html = generatedHtmlRef.current.get(job.link);
    if (!html) return;
    if (isMobile()) {
      setOverlayHtml(html);
    } else {
      const tab = window.open('', '_blank');
      if (tab) writeToTab(tab, injectDesktopClose(html));
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
    <>
      {overlayHtml && (
        <ResumeOverlay html={overlayHtml} onClose={() => setOverlayHtml(null)} />
      )}

      <div className="flex flex-col gap-3">
        {jobs.map((job, i) => {
          const isDone = readyToApplyJobs.has(job.link);
          const isProcessing = atsProcessing[job.link];

          // Company overline: use extracted company name, fall back to domain source
          const overline = job.company || job.source;

          return (
            <div key={i} className="bg-white border border-gray-200 rounded-2xl p-4 hover:border-gray-300 transition w-full">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {/* Company name as overline */}
                  <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-0.5 truncate">
                    {overline}
                  </p>
                  {/* Clean role title */}
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <h3 className="font-semibold text-gray-900 text-sm leading-snug">{job.title}</h3>
                    {isDone && (
                      <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                        ✓ Resume ready
                      </span>
                    )}
                  </div>
                  <p className="text-gray-500 text-sm leading-relaxed line-clamp-3">{job.snippet}</p>
                  {isProcessing && (
                    <p className="text-amber-600 text-xs mt-2 animate-pulse">
                      Generating resume — takes ~30 seconds...
                    </p>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex flex-col gap-2" style={{ flexShrink: 0 }}>
                  <a
                    href={job.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 px-3 py-2 rounded-xl text-center transition whitespace-nowrap block"
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
    </>
  );
}
