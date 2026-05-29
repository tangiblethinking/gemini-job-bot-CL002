import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: Request) {
  try {
    const { geminiKey, serperKey } = await req.json();
    const results: { gemini?: string; serper?: string } = {};

    if (geminiKey) {
      try {
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        await model.generateContent('ping');
        results.gemini = 'valid';
      } catch {
        results.gemini = 'invalid';
      }
    }

    if (serperKey) {
      try {
        const res = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: 'test', num: 1 }),
        });
        results.serper = res.ok ? 'valid' : 'invalid';
      } catch {
        results.serper = 'invalid';
      }
    }

    return NextResponse.json(results);
  } catch (error) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
