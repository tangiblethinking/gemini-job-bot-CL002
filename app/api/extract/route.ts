import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function POST(req: Request) {
  try {
    const apiKey = req.headers.get('x-gemini-key');
    if (!apiKey) return NextResponse.json({ error: 'Missing API Key' }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
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

    const prompt = `You are a resume parser. Read this resume text and return a single JSON object capturing EVERYTHING exactly as written.

CRITICAL RULES:
- Do NOT invent, summarize, or omit anything
- Preserve every bullet point word for word
- Preserve all metrics, percentages, dollar amounts exactly
- Preserve all dates, company names, job titles exactly
- Capture sections in the ORDER they appear in the resume
- Every bullet point must be its own string in an array — never merge or split bullets
- For the contact object: look for any mention of LinkedIn, Portfolio, GitHub, website, or similar. Capture the display text and any URL visible in the text. If a URL is not visible but a platform name is (e.g. "LinkedIn"), set the url to "" and displayText to "LinkedIn"
- Do NOT use emoji characters anywhere in your output — replace any ⭐ or similar with plain text marker "STAR:"

Return this JSON structure — adapt sections array to whatever actually exists:

{
  "contact": {
    "name": "full name",
    "title": "professional title if shown at top of resume",
    "email": "email address",
    "phone": "phone number",
    "location": "location",
    "links": [
      { "displayText": "LinkedIn", "url": "https://linkedin.com/in/..." },
      { "displayText": "Portfolio", "url": "https://..." }
    ]
  },
  "sections": [
    {
      "type": "exact section heading from resume or a clear label",
      "data": <see format rules below>
    }
  ]
}

Section data format rules:
- Summary/Profile/Objective: { "paragraph": "...", "bullets": ["...", "..."] } — omit bullets key if none
- Experience/Work History: { "entries": [ { "title": "...", "company": "...", "dates": "...", "location": "...", "bullets": ["...", "..."] } ] }
- Skills: { "items": ["skill1", "skill2"] }
- Education/Certifications: { "items": ["line1", "line2"] }
- Achievements/Accomplishments: { "items": ["achievement text without emoji prefix", "..."] }
- Any other section: { "items": ["line1", "line2"] }

Return only valid JSON. No markdown fences. No explanation.

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

    // Extract job titles from first experience section for search chips
    const expSection = parsedResume.sections?.find((s: any) =>
      s.type?.toLowerCase().includes('experience') || s.type?.toLowerCase().includes('work')
    );
    const titles: string[] = expSection?.data?.entries
      ?.slice(0, 3)
      .map((e: any) => e.title)
      .filter(Boolean) || [];

    // Build flat contact for backwards compatibility
    const contact = {
      name: parsedResume.contact?.name || '',
      email: parsedResume.contact?.email || '',
      phone: parsedResume.contact?.phone || '',
      location: parsedResume.contact?.location || '',
      title: parsedResume.contact?.title || '',
      links: parsedResume.contact?.links || [],
    };

    return NextResponse.json({ parsedResume, titles, rawText, contact });

  } catch (error) {
    console.error('Extract error:', error);
    return NextResponse.json({ error: 'Extraction failed' }, { status: 500 });
  }
}
