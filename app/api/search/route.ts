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

/**
 * Clean raw page titles from ATS job boards into a readable role title + company name.
 *
 * Raw examples:
 *   "Job Application for Product Designer / UX/UI Designer at Next Street"  → title: "Product Designer / UX/UI Designer", company: "Next Street"
 *   "Senior Product Designer - Figma"                                        → title: "Senior Product Designer", company: "Figma"
 *   "UX Designer | Stripe"                                                   → title: "UX Designer", company: "Stripe"
 *   "Product Designer (Remote) at Shopify"                                   → title: "Product Designer", company: "Shopify"
 *   "Director of UX — Airbnb"                                                → title: "Director of UX", company: "Airbnb"
 */
function parseJobTitle(raw: string): { title: string; company: string } {
  let title = raw.trim();
  let company = '';

  // Pattern 1: "Job Application for [ROLE] at [COMPANY]" — Greenhouse
  const ghMatch = title.match(/^job application for (.+?) at (.+)$/i);
  if (ghMatch) {
    return {
      title: ghMatch[1].trim(),
      company: ghMatch[2].trim(),
    };
  }

  // Pattern 2: "[ROLE] at [COMPANY]"
  const atMatch = title.match(/^(.+?)\s+at\s+([A-Z][^|\-–—]+)$/i);
  if (atMatch) {
    return {
      title: atMatch[1].trim(),
      company: atMatch[2].trim(),
    };
  }

  // Pattern 3: "[ROLE] | [COMPANY]" or "[ROLE] - [COMPANY]" or "[ROLE] — [COMPANY]" or "[ROLE] – [COMPANY]"
  const sepMatch = title.match(/^(.+?)\s*[\|][\s]+(.+)$/) ||
                   title.match(/^(.+?)\s+[-–—]\s+([A-Z][^\-–—]+)$/);
  if (sepMatch) {
    return {
      title: sepMatch[1].trim(),
      company: sepMatch[2].trim(),
    };
  }

  // No company extractable — return cleaned title as-is
  // Strip common noise suffixes
  title = title
    .replace(/\s*\(remote\)/gi, '')
    .replace(/\s*\(hybrid\)/gi, '')
    .replace(/\s*\(on-?site\)/gi, '')
    .trim();

  return { title, company };
}

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
          return (data.organic || []).map((result: any) => {
            const { title, company } = parseJobTitle(result.title || '');

            // Derive domain label as fallback source display
            const domainLabel = (() => {
              try {
                const hostname = new URL(result.link).hostname;
                return hostname.replace('boards.', '').replace('jobs.', '');
              } catch {
                return domain;
              }
            })();

            return {
              title,
              company,           // clean company name extracted from raw title
              link: result.link,
              snippet: result.snippet || '',
              source: domainLabel, // domain — kept for deduplication/display fallback
            };
          });
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
