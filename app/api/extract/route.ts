import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as zlib from 'zlib';
import { promisify } from 'util';

const inflateRaw = promisify(zlib.inflateRaw);
const inflate = promisify(zlib.inflate);

/**
 * Extract all hyperlink URIs from a PDF buffer.
 *
 * Strategy: PDFs store hyperlinks as /URI annotations inside object streams.
 * Modern PDFs compress object streams with zlib (FlateDecode). We:
 * 1. Try plain-text regex on raw buffer first (uncompressed PDFs)
 * 2. Find all FlateDecode streams, decompress them, regex on the result
 * 3. Deduplicate and return all found URLs
 */
async function extractUrlsFromPdf(buffer: Buffer): Promise<string[]> {
  const urls = new Set<string>();

  // Helper: extract URIs from a string using both /URI(...) and /URI<...> patterns
  function extractUris(text: string) {
    // Standard string form: /URI(https://...)
    const re1 = /\/URI\s*\(([^)]+)\)/g;
    let m;
    while ((m = re1.exec(text)) !== null) {
      const url = m[1].trim().replace(/\\\//g, '/');
      if (url.startsWith('http') || url.startsWith('mailto:')) urls.add(url);
    }
    // Also catch /URI followed by whitespace then (url)
    const re2 = /\/URI\s*\n\s*\(([^)]+)\)/g;
    while ((m = re2.exec(text)) !== null) {
      const url = m[1].trim().replace(/\\\//g, '/');
      if (url.startsWith('http') || url.startsWith('mailto:')) urls.add(url);
    }
  }

  // Pass 1: raw buffer as latin1 (works for uncompressed / partially compressed PDFs)
  const raw = buffer.toString('latin1');
  extractUris(raw);

  // Pass 2: find and decompress all FlateDecode streams
  // PDF stream format: <<...>> stream\r\n[compressed bytes]\r\nendstream
  // We find stream boundaries and try to inflate the bytes between them
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch;
  const decompressPromises: Promise<void>[] = [];

  while ((streamMatch = streamRegex.exec(raw)) !== null) {
    const streamContent = streamMatch[1];
    // Only attempt decompression if this looks like a binary/compressed stream
    // (contains non-printable chars suggesting compression)
    const hasBinary = /[\x00-\x08\x0e-\x1f\x80-\xff]/.test(streamContent.substring(0, 100));
    if (!hasBinary) {
      // Already plain text — extract URIs directly
      extractUris(streamContent);
      continue;
    }

    // Convert the matched string back to a Buffer for decompression
    const streamBuf = Buffer.from(streamContent, 'latin1');

    decompressPromises.push(
      (async () => {
        // Try inflate (zlib header) first, then inflateRaw (no header)
        for (const decompress of [inflate, inflateRaw]) {
          try {
            const decompressed = await decompress(streamBuf);
            extractUris(decompressed.toString('latin1'));
            break;
          } catch {
            // Not decompressible with this method — try next
          }
        }
      })()
    );
  }

  // Run all decompressions in parallel
  await Promise.allSettled(decompressPromises);

  return [...urls];
}

export async function POST(req: Request) {
  try {
    const apiKey = req.headers.get('x-gemini-key');
    if (!apiKey) return NextResponse.json({ error: 'Missing API Key' }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());

    // ── Step 1: Extract raw URLs from PDF streams (compressed + uncompressed) ─
    const rawUrls = await extractUrlsFromPdf(buffer);
    console.log('Extracted URLs from PDF:', rawUrls);

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

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // ── Step 3: Single Gemini call — parse resume AND map URLs ────────────────
    const urlMappingSection = rawUrls.length > 0 ? `

HYPERLINK MAPPING (CRITICAL):
The following URLs were extracted from the PDF's hyperlink annotations. For each URL,
identify the EXACT word or phrase it was embedded in within the resume — the display
text the author hyperlinked. Use the resume content as context.

Extracted URLs:
${rawUrls.map((u, i) => `${i + 1}. ${u}`).join('\n')}

Return these as "resolvedLinks" at the top level:
"resolvedLinks": [
  { "displayText": "exact anchor text from resume", "url": "the full URL" }
]

Rules:
- displayText = EXACT text from resume (e.g. "LinkedIn", "Portfolio", "Plexus Worldwide")
- For known platforms (linkedin.com, github.com, dribbble.com, behance.net, twitter.com,
  medium.com, notion.so) use the platform name if no explicit anchor text found
- Include ALL URLs — none omitted
- Unknown domains: use the company or person name the URL most likely belongs to
` : `
"resolvedLinks": [],`;

    const prompt = `You are a resume parser. Read this resume text and return a single JSON object capturing EVERYTHING exactly as written.

CRITICAL RULES:
- Do NOT invent, summarize, or omit anything
- Preserve every bullet point word for word
- Preserve all metrics, percentages, dollar amounts exactly
- Preserve all dates, company names, job titles exactly
- Capture sections in the ORDER they appear in the resume
- Every bullet point must be its own string in an array — never merge or split bullets
- For the contact object: look for any mention of LinkedIn, Portfolio, GitHub, website, or similar. Capture the display text and any URL visible in the text. If a URL is not visible but a platform name is (e.g. "LinkedIn"), set the url to "" and displayText to "LinkedIn"
- Do NOT use emoji characters anywhere — replace ⭐ or similar with "STAR:"
- For experience entries: if a company has an associated URL from resolvedLinks, add "companyUrl" to that entry
${urlMappingSection}

Return this JSON structure:

{
  "resolvedLinks": [...],
  "contact": {
    "name": "full name",
    "title": "professional title",
    "email": "email",
    "phone": "phone",
    "location": "location",
    "links": [
      { "displayText": "LinkedIn", "url": "" },
      { "displayText": "Portfolio", "url": "" }
    ]
  },
  "sections": [
    {
      "type": "exact section heading",
      "data": {}
    }
  ]
}

Section data format:
- Summary/Profile/Objective: { "paragraph": "...", "bullets": ["..."] }
- Experience/Work History: { "entries": [ { "title": "...", "company": "...", "companyUrl": "", "dates": "...", "location": "...", "bullets": ["..."] } ] }
- Skills: { "items": ["skill1", "skill2"] }
- Education/Certifications: { "items": ["line1"] }
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

    // ── Step 4: Merge resolvedLinks → contact.links + experience companyUrls ──
    const resolvedLinks: { displayText: string; url: string }[] =
      parsedResume.resolvedLinks || [];

    const CONTACT_DOMAINS = [
      'linkedin', 'github', 'dribbble', 'behance', 'twitter', 'x.com',
      'instagram', 'portfolio', 'myportfolio', 'medium', 'notion',
      'behance', 'figma', 'read.cv',
    ];

    // Map displayText (lowercase) → url for fast lookup
    const resolvedMap = new Map<string, string>();
    resolvedLinks.forEach(rl => {
      if (rl.url) resolvedMap.set(rl.displayText.toLowerCase().trim(), rl.url);
    });

    // Backfill contact.links with resolved URLs
    const contactLinks = (parsedResume.contact?.links || []).map((cl: any) => {
      const resolved = resolvedMap.get(cl.displayText.toLowerCase().trim());
      return { ...cl, url: resolved || cl.url || '' };
    });

    // Add any resolvedLinks not in contactLinks that are contact/social type
    resolvedLinks.forEach(rl => {
      const alreadyIn = contactLinks.some(
        (cl: any) => cl.displayText.toLowerCase() === rl.displayText.toLowerCase()
      );
      if (!alreadyIn && rl.url) {
        const isContactType = CONTACT_DOMAINS.some(d =>
          rl.url.toLowerCase().includes(d) ||
          rl.displayText.toLowerCase().includes(d)
        );
        if (isContactType) contactLinks.push({ displayText: rl.displayText, url: rl.url });
      }
    });

    // Update experience entries with companyUrls
    const sections = (parsedResume.sections || []).map((section: any) => {
      const k = (section.type || '').toLowerCase();
      if (!k.includes('experience') && !k.includes('work')) return section;

      const entries = (section.data?.entries || []).map((entry: any) => {
        if (entry.companyUrl) return entry;
        const companyLower = (entry.company || '').toLowerCase().trim();
        const match = resolvedLinks.find(rl => {
          if (!rl.url) return false;
          const dl = rl.displayText.toLowerCase().trim();
          return dl === companyLower ||
            companyLower.includes(dl) ||
            dl.includes(companyLower);
        });
        return match ? { ...entry, companyUrl: match.url } : { ...entry, companyUrl: '' };
      });

      return { ...section, data: { ...section.data, entries } };
    });

    const finalResume = {
      ...parsedResume,
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
