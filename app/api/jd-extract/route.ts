import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { jobUrl, snippet } = await req.json();
    if (!jobUrl) return NextResponse.json({ text: snippet || '' });

    let text = '';
    try {
      const res = await fetch(`https://r.jina.ai/${encodeURIComponent(jobUrl)}`, {
        headers: { Accept: 'text/plain' },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const t = await res.text();
        text = t.trim().length < 200 || t.includes('Enable JavaScript') ? '' : t.substring(0, 6000);
      }
    } catch { text = ''; }

    if (!text) text = snippet || '';
    return NextResponse.json({ text });
  } catch (error) {
    console.error('JD extract error:', error);
    return NextResponse.json({ text: '' });
  }
}
