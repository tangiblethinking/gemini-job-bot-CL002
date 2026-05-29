import { NextResponse } from 'next/server';

const VERIFIED_DOMAINS = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'workday.com',
  'myworkdayjobs.com',
  'icims.com',
  'jobvite.com',
  'smartrecruiters.com',
];

export async function POST(req: Request) {
  try {
    const { titles } = await req.json();
    const serperKey = req.headers.get('x-serper-key');

    if (!serperKey || !titles?.length) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    const query = titles.join(' OR ');

    const results = await Promise.all(
      VERIFIED_DOMAINS.map(async (domain) => {
        try {
          const res = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
              'X-API-KEY': serperKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ q: `${query} site:${domain}`, num: 5 }),
          });
          const data = await res.json();
          return (data.organic || []).map((result: any) => ({
            title: result.title,
            link: result.link,
            snippet: result.snippet || '',
            source: (() => {
              try {
                const hostname = new URL(result.link).hostname;
                return hostname.replace('boards.', '').replace('jobs.', '');
              } catch {
                return domain;
              }
            })(),
          }));
        } catch {
          return [];
        }
      })
    );

    const seen = new Set<string>();
    const jobs = results.flat().filter((job) => {
      if (seen.has(job.link)) return false;
      seen.add(job.link);
      return true;
    });

    console.log(`Total jobs found: ${jobs.length}`);
    return NextResponse.json(jobs);
  } catch (error) {
    console.error('Search API Error:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
