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

    const prompt = `You are a resume parser. Read this resume text and return a single JSON object that captures EVERYTHING in the resume exactly as written.

RULES:
- Do not invent, summarize, or omit anything
- Preserve every bullet point word for word
- Preserve all metrics, percentages, dollar amounts exactly
- Preserve all dates, company names, job titles exactly
- Capture sections in the ORDER they appear in the resume
- If a section type is unclear, name it descriptively (e.g. "volunteer", "publications", "awards")
- Every bullet point in every job must be captured individually in an array
- Do not merge bullets or split bullets

Return this exact JSON structure — adapting the sections array to whatever actually exists in the resume:

{
  "contact": {
    "name": "full name",
    "title": "professional title if present on resume",
    "email": "email",
    "phone": "phone",
    "location": "location",
    "linkedin": "linkedin url if present",
    "portfolio": "portfolio url if present",
    "other": "any other contact links"
  },
  "sections": [
    {
      "type": "the section name exactly as it appears or a clear descriptive label",
      "data": <section content — see format rules below>
    }
  ]
}

Section data format rules:
- For a summary/profile/objective section: { "paragraph": "...", "bullets": ["...", "..."] } — omit bullets if none exist
- For an experience/work history section: { "entries": [ { "title": "...", "company": "...", "dates": "...", "location": "...", "bullets": ["...", "...", "..."] } ] }
- For a skills section: { "items": ["skill1", "skill2", ...] }
- For an education section: { "items": ["degree line 1", "degree line 2", ...] }
- For an achievements/accomplishments section: { "items": ["achievement 1", "achievement 2", ...] }
- For certifications: { "items": ["cert 1", "cert 2", ...] }
- For any other section type: { "items": ["line 1", "line 2", ...] }

Return only valid JSON. No markdown. No explanation. No code fences.

Resume text:
${rawText}`;

    const result = await model.generateContent(prompt);
    let responseText = result.response.text().trim();

    // Strip markdown code fences if model adds them
    if (responseText.startsWith('```')) {
      responseText = responseText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    let parsedResume: any;
    try {
      parsedResume = JSON.parse(responseText);
    } catch {
      // Retry once with a stricter prompt if JSON is malformed
      const retryResult = await model.generateContent(
        `The following is a partial or malformed JSON resume parse. Fix it and return only valid JSON, no markdown, no explanation:\n\n${responseText.substring(0, 8000)}`
      );
      let retryText = retryResult.response.text().trim();
      if (retryText.startsWith('```')) {
        retryText = retryText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
      }
      parsedResume = JSON.parse(retryText);
    }

    // Extract top job titles for search chips (from first experience section)
    const expSection = parsedResume.sections?.find((s: any) =>
      s.type?.toLowerCase().includes('experience') || s.type?.toLowerCase().includes('work')
    );
    const titles: string[] = expSection?.data?.entries
      ?.slice(0, 3)
      .map((e: any) => e.title)
      .filter(Boolean) || [];

    return NextResponse.json({
      parsedResume,
      titles,
      rawText,
      contact: parsedResume.contact || {},
    });

  } catch (error) {
    console.error('Extract error:', error);
    return NextResponse.json({ error: 'Extraction failed' }, { status: 500 });
  }
}
