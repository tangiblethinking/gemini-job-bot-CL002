import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const rewriteSchema = {
  type: "object",
  properties: {
    jobTitle: { type: "string" },
    summary: { type: "string" },
    skills: { type: "array", items: { type: "string" } },
    experience: { type: "string" },
  },
  required: ["jobTitle", "summary", "skills", "experience"],
};

const keywordSchema = {
  type: "array",
  items: { type: "string" },
};

export async function POST(req: Request) {
  try {
    const { jobUrl, resumeText, snippet, contact, education } = await req.json();
    const apiKey = req.headers.get('x-gemini-key');
    if (!apiKey) return NextResponse.json({ error: 'Missing API Key' }, { status: 401 });

    const genAI = new GoogleGenerativeAI(apiKey);

    let jobText = '';
    try {
      const jinaRes = await fetch(`https://r.jina.ai/${encodeURIComponent(jobUrl)}`, {
        headers: { 'Accept': 'text/plain' },
      });
      if (jinaRes.ok) {
        const jinaText = await jinaRes.text();
        const jinaFailed = jinaText.trim().length < 200 || jinaText.includes('Enable JavaScript');
        jobText = jinaFailed ? '' : jinaText.substring(0, 5000);
      }
    } catch {
      jobText = '';
    }

    const usingFallback = !jobText;
    if (usingFallback) jobText = snippet || '';

    const keywordModel = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: keywordSchema as any,
      },
    });

    const keywordPrompt = usingFallback
      ? `I am providing a short snippet because the full job page was unreachable. Extract top 15 ATS keywords from: "${jobText}". Return as a JSON array of strings.`
      : `Extract top 15 ATS keywords from this job description: "${jobText}". Return as a JSON array of strings.`;

    const kRes = await keywordModel.generateContent(keywordPrompt);
    const keywords: string[] = JSON.parse(kRes.response.text());

    const rewriteModel = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: rewriteSchema as any,
      },
    });

    const rewritePrompt = `You are an ATS resume optimization expert. Rewrite only the Summary, Skills, and Experience sections of this resume to naturally incorporate these keywords: ${keywords.join(', ')}. Do not rewrite Education or Contact info. Resume text: "${resumeText.substring(0, 4000)}"`;

    const rRes = await rewriteModel.generateContent(rewritePrompt);
    const rewritten = JSON.parse(rRes.response.text());

    const contactName = contact?.name || '';
    const contactEmail = contact?.email || '';
    const contactPhone = contact?.phone || '';
    const contactLocation = contact?.location || '';
    const educationLines: string[] = education || [];

    const resumeHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>ATS Resume — ${contactName}</title>
<style>
body { font-family: Georgia, serif; max-width: 800px; margin: 40px auto; padding: 0 40px; color: #111; }
h1 { font-size: 28px; margin-bottom: 4px; }
.contact-bar { font-size: 13px; color: #555; margin-bottom: 24px; }
.contact-bar span { margin-right: 16px; }
h2 { font-size: 14px; font-weight: normal; color: #555; margin-bottom: 24px; }
h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 24px; }
p, li { font-size: 13px; line-height: 1.7; }
ul { padding-left: 20px; }
@media print { body { margin: 20px; } }
</style>
</head>
<body>
<h1>${contactName}</h1>
<div class="contact-bar">
${contactEmail ? `<span>${contactEmail}</span>` : ''}
${contactPhone ? `<span>${contactPhone}</span>` : ''}
${contactLocation ? `<span>${contactLocation}</span>` : ''}
</div>
<h2>${rewritten.jobTitle || 'ATS Optimized Resume'}</h2>
<h3>Summary</h3>
<p>${rewritten.summary}</p>
<h3>Skills</h3>
<p>${Array.isArray(rewritten.skills) ? rewritten.skills.join(' · ') : rewritten.skills}</p>
<h3>Experience</h3>
<p>${rewritten.experience}</p>
${educationLines.length > 0 ? `
<h3>Education</h3>
<ul>${educationLines.map((e: string) => `<li>${e}</li>`).join('')}</ul>
` : ''}
</body>
</html>`;

    return NextResponse.json({ html: resumeHtml });
  } catch (error) {
    console.error('ATS error:', error);
    return NextResponse.json({ error: 'ATS generation failed' }, { status: 500 });
  }
}
