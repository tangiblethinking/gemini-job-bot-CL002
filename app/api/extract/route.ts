import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface ResolvedLink {
  displayText: string;
  url: string;
}

/**
 * Extract all hyperlinks from a PDF using pdfjs-dist annotation API.
 * Returns { displayText, url } pairs where displayText is the exact
 * text the author hyperlinked, matched by coordinate overlap.
 *
 * This handles all PDF variants including object-stream compressed PDFs
 * (PDF 1.5+) which raw buffer regex cannot reach.
 */
async function extractLinksFromPdf(buffer: Buffer): Promise<ResolvedLink[]> {
  // Dynamic import — pdfjs-dist is ESM only
  const { getDocument, GlobalWorkerOptions } = await import(
    'pdfjs-dist/legacy/build/pdf.mjs' as any
  );

  // In Node.js serverless with pdfjs-dist as external package,
  // set workerSrc to a non-empty string to satisfy the check.
  // The legacy build runs the worker inline (fake worker) when the src
  // doesn't resolve to an actual separate worker thread — which is fine
  // for serverless Node environments.
  GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';

  const data = new Uint8Array(buffer);
  const doc = await getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
    disableAutoFetch: true,
  }).promise;

  const results = new Map<string, string>(); // url -> displayText

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const [annotations, textContent] = await Promise.all([
      page.getAnnotations(),
      page.getTextContent(),
    ]);

    const links = (annotations as any[]).filter(
      (a: any) => a.subtype === 'Link' && a.url
    );
    if (!links.length) continue;

    for (const link of links) {
      if (results.has(link.url)) continue; // deduplicate
      const [x1, y1, x2, y2] = link.rect as number[];

      // Match text items whose baseline falls within the annotation rect
      const matched: string[] = [];
      for (const item of (textContent as any).items) {
        if (!item.str?.trim()) continue;
        const tx: number = item.transform[4];
        const ty: number = item.transform[5];
        // Small tolerance (2pt) for floating point variation
        if (tx >= x1 - 2 && tx <= x2 + 2 && ty >= y1 - 2 && ty <= y2 + 2) {
          matched.push(item.str.trim());
        }
      }

      const displayText = matched.join(' ').trim();
      if (displayText) {
        results.set(link.url, displayText);
      } else {
        // Fallback: no text matched — use domain as display
        try {
          const host = new URL(link.url).hostname.replace('www.', '');
          results.set(link.url, host);
        } catch {
          results.set(link.url, link.url);
        }
      }
    }
  }

  // Return as array, filtering out mailto (handled by contact.email already)
  return [...results.entries()]
    .filter(([url]) => !url.startsWith('mailto:'))
    .map(([url, displayText]) => ({ displayText, url }));
}

export async function POST(req: Request) {
  try {
    const apiKey = req.headers.get('x-gemini-key');
    if (!apiKey) return NextResponse.json({ error: 'Missing API Key' }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());

    // ── Step 1: Extract hyperlinks with exact anchor text via pdfjs ───────────
    let resolvedLinks: ResolvedLink[] = [];
    try {
      resolvedLinks = await extractLinksFromPdf(buffer);
      console.log('Extracted URLs from PDF:', resolvedLinks);
    } catch (err) {
      // Non-fatal — continue without links if pdfjs fails
      console.warn('pdfjs link extraction failed:', err);
    }

    // ── Step 2: Parse text from PDF ───────────────────────────────────────────
    const pdfParse = (await import('pdf-parse')).default;
    const parsed = await pdfParse(buffer);
    const rawText = parsed.text;

    if (rawText.trim().length < 100) {
      return NextResponse.json(
        { error: 'Scanned PDF detected. Please upload a text-based PDF.' },
        { status: 422 }
      );
    }

    // ── Step 3: Gemini parse — resume structure only, no URL mapping needed ───
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `You are a resume parser. Read this resume text and return a single JSON object capturing EVERYTHING exactly as written.

CRITICAL RULES:
- Do NOT invent, summarize, or omit anything
- Preserve every bullet point word for word
- Preserve all metrics, percentages, dollar amounts exactly
- Preserve all dates, company names, job titles exactly
- Capture sections in the ORDER they appear in the resume
- Every bullet point must be its own string in an array — never merge or split bullets
- For the contact object: look for any mention of LinkedIn, Portfolio, GitHub, website, or similar. Capture the display text. Set url to "" — URLs are provided separately.
- Do NOT use emoji characters anywhere — replace ⭐ or similar with "STAR:"

Return this JSON structure:

{
  "contact": {
    "name": "full name",
    "title": "professional title if shown at top",
    "email": "email address",
    "phone": "phone number",
    "location": "location",
    "links": [
      { "displayText": "LinkedIn", "url": "" },
      { "displayText": "Portfolio", "url": "" }
    ]
  },
  "sections": [
    {
      "type": "exact section heading from resume",
      "data": {}
    }
  ]
}

Section data format:
- Summary/Profile/Objective: { "paragraph": "...", "bullets": ["...", "..."] }
- Experience/Work History: { "entries": [ { "title": "...", "company": "...", "companyUrl": "", "dates": "...", "location": "...", "bullets": ["...", "..."] } ] }
- Skills: { "items": ["skill1", "skill2"] }
- Education/Certifications: { "items": ["line1", "line2"] }
- Achievements/Accomplishments: { "items": ["achievement text"] }
- Any other section: { "items": ["line1"] }

Return only valid JSON. No markdown. No explanation.

Resume text:
${rawText}`;

    const result = await model.generateContent(prompt);
    let responseText = result.response.text().trim();
    if (responseText.startsWith('```')) {
      responseText = responseText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    let parsedResume: any;
    try {
      parsedResume = JSON.parse(responseText);
    } catch {
      const retryResult = await model.generateContent(
        `Fix this malformed JSON and return only valid JSON, no markdown:\n\n${responseText.substring(0, 8000)}`
      );
      let retryText = retryResult.response.text().trim();
      if (retryText.startsWith('```')) {
        retryText = retryText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
      }
      parsedResume = JSON.parse(retryText);
    }

    // ── Step 4: Merge resolvedLinks into contact.links + experience entries ───
    // Build lookup: displayText (lowercase) → url
    const linkByText = new Map<string, string>();
    resolvedLinks.forEach(rl => linkByText.set(rl.displayText.toLowerCase().trim(), rl.url));

    // Backfill contact.links with resolved URLs matched by displayText
    const contactLinks = (parsedResume.contact?.links || []).map((cl: any) => {
      const url = linkByText.get(cl.displayText.toLowerCase().trim()) || cl.url || '';
      return { ...cl, url };
    });

    // Add any resolvedLinks not already in contactLinks
    const CONTACT_DOMAINS = [
      'linkedin', 'github', 'dribbble', 'behance', 'twitter', 'x.com',
      'instagram', 'myportfolio', 'uxapex', 'medium', 'notion', 'read.cv',
    ];
    resolvedLinks.forEach(rl => {
      const already = contactLinks.some(
        (cl: any) => cl.displayText.toLowerCase() === rl.displayText.toLowerCase()
      );
      if (!already) {
        const isContact = CONTACT_DOMAINS.some(d =>
          rl.url.toLowerCase().includes(d) || rl.displayText.toLowerCase().includes(d)
        );
        if (isContact) contactLinks.push({ displayText: rl.displayText, url: rl.url });
      }
    });

    // Backfill experience entry companyUrls matched by company name
    const sections = (parsedResume.sections || []).map((section: any) => {
      const k = (section.type || '').toLowerCase();
      if (!k.includes('experience') && !k.includes('work')) return section;

      const entries = (section.data?.entries || []).map((entry: any) => {
        // Match by displayText === company name (exact, set by pdfjs extraction)
        const companyLower = (entry.company || '').toLowerCase().trim();
        const url = linkByText.get(companyLower) || '';
        return { ...entry, companyUrl: url };
      });

      return { ...section, data: { ...section.data, entries } };
    });

    const finalResume = {
      ...parsedResume,
      resolvedLinks,
      contact: { ...parsedResume.contact, links: contactLinks },
      sections,
    };

    // Extract job titles for search chips
    const expSection = finalResume.sections?.find((s: any) =>
      s.type?.toLowerCase().includes('experience') || s.type?.toLowerCase().includes('work')
    );
    const titles: string[] = expSection?.data?.entries
      ?.slice(0, 3).map((e: any) => e.title).filter(Boolean) || [];

    const contact = {
      name: finalResume.contact?.name || '',
      email: finalResume.contact?.email || '',
      phone: finalResume.contact?.phone || '',
      location: finalResume.contact?.location || '',
      title: finalResume.contact?.title || '',
      links: finalResume.contact?.links || [],
    };

    return NextResponse.json({ parsedResume: finalResume, titles, rawText, contact });

  } catch (error) {
    console.error('Extract error:', error);
    return NextResponse.json({ error: 'Extraction failed' }, { status: 500 });
  }
}
