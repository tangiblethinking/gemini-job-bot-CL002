"use client";
import React, { createContext, useContext, useState, useEffect } from 'react';

type AppState = 'IDLE' | 'PARSED' | 'SEARCHING' | 'RESULTS';

interface Contact {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  title?: string;
  links?: { displayText: string; url: string }[];
}

interface AppContextType {
  geminiKey: string;
  serperKey: string;
  rawResumeText: string;
  parsedResume: any | null;
  searchTitles: string[];
  appState: AppState;
  readyToApplyJobs: Set<string>;
  atsProcessing: Record<string, boolean>;
  contact: Contact;
  jobs: any[];
  setApiKeys: (gemini: string, serper: string) => void;
  setRawResumeText: (text: string) => void;
  setParsedResume: (resume: any) => void;
  setSearchTitles: React.Dispatch<React.SetStateAction<string[]>>;
  setAppState: (state: AppState) => void;
  markJobReady: (jobUrl: string) => void;
  setAtsProcessing: (jobUrl: string, val: boolean) => void;
  setContact: (contact: Contact) => void;
  setJobs: (jobs: any[]) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppContextProvider({ children }: { children: React.ReactNode }) {
  const [geminiKey, setGeminiKey] = useState('');
  const [serperKey, setSerperKey] = useState('');
  const [rawResumeText, setRawResumeTextState] = useState('');
  const [parsedResume, setParsedResumeState] = useState<any | null>(null);
  const [searchTitles, setSearchTitlesState] = useState<string[]>([]);
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [readyToApplyJobs, setReadyToApplyJobs] = useState<Set<string>>(new Set());
  const [atsProcessing, setProcessing] = useState<Record<string, boolean>>({});
  const [contact, setContactState] = useState<Contact>({ name: '' });
  const [jobs, setJobsState] = useState<any[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Rehydrate from localStorage on mount
  useEffect(() => {
    // Keys — restore to state but NOT treated as verified this session
    const storedGemini = localStorage.getItem('gemini_api_key') || '';
    const storedSerper = localStorage.getItem('serper_api_key') || '';
    setGeminiKey(storedGemini);
    setSerperKey(storedSerper);

    const storedResume = localStorage.getItem('parsed_resume');
    const storedTitles = localStorage.getItem('search_titles');
    const storedContact = localStorage.getItem('resume_contact');
    const storedRawText = localStorage.getItem('raw_resume_text');
    const storedJobs = localStorage.getItem('jobs_results');
    const storedReady = localStorage.getItem('ready_to_apply_jobs');

    if (storedResume) {
      try {
        const pr = JSON.parse(storedResume);
        setParsedResumeState(pr);
        // Restore to RESULTS if jobs exist, otherwise PARSED
        if (storedJobs) {
          try {
            const parsedJobs = JSON.parse(storedJobs);
            if (Array.isArray(parsedJobs) && parsedJobs.length > 0) {
              setJobsState(parsedJobs);
              setAppState('RESULTS');
            } else {
              setAppState('PARSED');
            }
          } catch { setAppState('PARSED'); }
        } else {
          setAppState('PARSED');
        }
      } catch { /* ignore corrupt data */ }
    }

    if (storedTitles) {
      try { setSearchTitlesState(JSON.parse(storedTitles)); } catch { /* ignore */ }
    }
    if (storedContact) {
      try { setContactState(JSON.parse(storedContact)); } catch { /* ignore */ }
    }
    if (storedRawText) {
      setRawResumeTextState(storedRawText);
    }
    if (storedReady) {
      try {
        const arr = JSON.parse(storedReady);
        if (Array.isArray(arr)) setReadyToApplyJobs(new Set(arr));
      } catch { /* ignore */ }
    }

    setHydrated(true);
  }, []);

  const setApiKeys = (gemini: string, serper: string) => {
    localStorage.setItem('gemini_api_key', gemini);
    localStorage.setItem('serper_api_key', serper);
    setGeminiKey(gemini);
    setSerperKey(serper);
  };

  const setRawResumeText = (text: string) => {
    localStorage.setItem('raw_resume_text', text);
    setRawResumeTextState(text);
  };

  const setParsedResume = (resume: any) => {
    if (resume) {
      try { localStorage.setItem('parsed_resume', JSON.stringify(resume)); } catch { /* storage full */ }
    }
    setParsedResumeState(resume);
  };

  const setSearchTitles: React.Dispatch<React.SetStateAction<string[]>> = (action) => {
    setSearchTitlesState(prev => {
      const next = typeof action === 'function' ? action(prev) : action;
      try { localStorage.setItem('search_titles', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const setContact = (c: Contact) => {
    try { localStorage.setItem('resume_contact', JSON.stringify(c)); } catch { /* ignore */ }
    setContactState(c);
  };

  const setJobs = (j: any[]) => {
    try { localStorage.setItem('jobs_results', JSON.stringify(j)); } catch { /* ignore */ }
    setJobsState(j);
  };

  const markJobReady = (jobUrl: string) => {
    setReadyToApplyJobs(prev => {
      const next = new Set(prev);
      next.add(jobUrl);
      try { localStorage.setItem('ready_to_apply_jobs', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const setAtsProcessing = (jobUrl: string, val: boolean) => {
    setProcessing(prev => ({ ...prev, [jobUrl]: val }));
  };

  if (!hydrated) return null;

  return (
    <AppContext.Provider value={{
      geminiKey, serperKey, rawResumeText, parsedResume,
      searchTitles, appState, readyToApplyJobs, atsProcessing, contact, jobs,
      setApiKeys, setRawResumeText, setParsedResume, setSearchTitles,
      setAppState, markJobReady, setAtsProcessing, setContact, setJobs,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppContextProvider');
  return ctx;
}
