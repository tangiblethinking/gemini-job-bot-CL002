"use client";
import React, { createContext, useContext, useState, useEffect } from 'react';

type AppState = 'IDLE' | 'PARSED' | 'SEARCHING' | 'RESULTS';

interface Contact {
  name: string;
  email?: string;
  phone?: string;
  location?: string;
  title?: string;
  linkedin?: string;
  portfolio?: string;
  other?: string;
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
  setApiKeys: (gemini: string, serper: string) => void;
  setRawResumeText: (text: string) => void;
  setParsedResume: (resume: any) => void;
  setSearchTitles: React.Dispatch<React.SetStateAction<string[]>>;
  setAppState: (state: AppState) => void;
  markJobReady: (jobUrl: string) => void;
  setAtsProcessing: (jobUrl: string, val: boolean) => void;
  setContact: (contact: Contact) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppContextProvider({ children }: { children: React.ReactNode }) {
  const [geminiKey, setGeminiKey] = useState('');
  const [serperKey, setSerperKey] = useState('');
  const [rawResumeText, setRawResumeText] = useState('');
  const [parsedResume, setParsedResume] = useState<any | null>(null);
  const [searchTitles, setSearchTitles] = useState<string[]>([]);
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [readyToApplyJobs, setReadyToApplyJobs] = useState<Set<string>>(new Set());
  const [atsProcessing, setProcessing] = useState<Record<string, boolean>>({});
  const [contact, setContact] = useState<Contact>({ name: '' });

  useEffect(() => {
    setGeminiKey(localStorage.getItem('gemini_api_key') || '');
    setSerperKey(localStorage.getItem('serper_api_key') || '');
  }, []);

  const setApiKeys = (gemini: string, serper: string) => {
    localStorage.setItem('gemini_api_key', gemini);
    localStorage.setItem('serper_api_key', serper);
    setGeminiKey(gemini);
    setSerperKey(serper);
  };

  const markJobReady = (jobUrl: string) => {
    setReadyToApplyJobs(prev => {
      const next = new Set(prev);
      next.add(jobUrl);
      return next;
    });
  };

  const setAtsProcessing = (jobUrl: string, val: boolean) => {
    setProcessing(prev => ({ ...prev, [jobUrl]: val }));
  };

  return (
    <AppContext.Provider value={{
      geminiKey, serperKey, rawResumeText, parsedResume,
      searchTitles, appState, readyToApplyJobs, atsProcessing, contact,
      setApiKeys, setRawResumeText, setParsedResume, setSearchTitles,
      setAppState, markJobReady, setAtsProcessing, setContact,
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
