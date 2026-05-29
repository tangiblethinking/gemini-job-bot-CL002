import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Schema: parse original resume into full structured sections
const parseSchema = {
  type: 'object',
  properties: {
    contact: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        title: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        location: { type: 'string' },
        linkedin: { type: 'string' },
        portfolio: { type: 'string' },
      },
      required: ['name'],
    },
    summaryParagraph: { type: 'string' },
    summaryBullets: { type: 'array', items: { type: 'string' } },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          company: { type: 'string' },
          dates: { type: 'string' },
          location: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'company', 'bullets'],
      },
    },
    achievements: { type: 'array', items: { type: 'string' } },
    skills: { type: 'array', items: { type: 'string' } },
    education: { type: 'array', items: { type: 'string' } },
    certifications: { type: 'array', items: { type: 'string' } },
  },
  required: ['contact', 'summaryParagraph', 'experience', 'skills'],
};

// Schema: rewritten sections only
const rewriteSchema = {
  type: 'object',
  properties: {
    summaryParagraph: { type: 'string' },
    summaryBullets: { type: 'array', items: { type: 'string' } },
    experience: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          bullets: { type: 'array', items: { type: 'string' } },
        },
        required: ['bullets'],
      },
    },
    skills: { type: 'array', items: { type: 'string' } },
  },
  required: ['summaryParagraph', 'experience', 'skills'],
};

const keywordSchema = { type: 'array', items: { type: 'string' } };

export async function POST(req: Request) {
  try {
    const { jobUrl, resumeText, snippet, contact: ctxContact, education: ctxEdu } = await req.json();
    const apiKey = req.headers.get('x-gemini-key');
    if (!apiKey) return NextResponse.json({ error: 'Missing API Key' }, { status: 401 });

    const genAI = new GoogleGenerativeAI(apiKey);

    // --- Step 1: Fetch job description ---
    let jobText = '';
    try {
      const jinaRes = await fetch(`https://r.jina.ai/${encodeURIComponent(jobUrl)}`, {
        headers: { Accept: 'text/plain' },
      });
      if (jinaRes.ok) {
        const t = await jinaRes.text();
        jobText = t.trim().length < 200 || t.includes('Enable JavaScript') ? '' : t.substring(0, 5000);
      }
    } catch { jobText = ''; }
    if (!jobText) jobText = snippet || '';

    // --- Step 2: Extract ATS keywords from JD ---
    const kwModel = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json', responseSchema: keywordSchema as any },
    });
    const kwRes = await kwModel.generateContent(
      `Extract the top 20 most important ATS keywords and phrases from this job description. Include skills, tools, methodologies, and role-specific terms. Return as a JSON array of strings.\n\nJob description:\n${jobText}`
    );
    const keywords: string[] = JSON.parse(kwRes.response.text());

    // --- Step 3: Parse original resume into full structure ---
    const parseModel = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json', responseSchema: parseSchema as any },
    });
    const parseRes = await parseModel.generateContent(
      `Parse this resume text into structured JSON. Extract every section exactly as written — preserve all bullet points verbatim, all metrics, all dates, company names, and job titles. Do not summarize or collapse content.\n\nResume:\n${resumeText.substring(0, 6000)}`
    );
    const parsed = JSON.parse(parseRes.response.text());

    // --- Step 4: Rewrite only summary + job bullets + skills with ATS keywords ---
    const rewriteModel = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json', responseSchema: rewriteSchema as any },
    });

    const experienceContext = parsed.experience
      .map((j: any, idx: number) => `Job ${idx + 1} (${j.title} at ${j.company}):\n${(j.bullets || []).join('\n')}`)
      .join('\n\n');

    const rewriteRes = await rewriteModel.generateContent(
      `You are an expert ATS resume optimizer. Your task is to rewrite ONLY the summary and bullet points to naturally incorporate these ATS keywords: ${keywords.join(', ')}.

RULES:
- Preserve all metrics, percentages, and numbers exactly (e.g. "43%", "$370K", "50%")
- Keep the same number of bullet points per job — do not add or remove bullets
- Do not change company names, job titles, or dates
- Do not invent new achievements
- Keep bullet point length similar to originals
- Reorder skills list to prioritize keywords that match the job description first

Original summary paragraph:
${parsed.summaryParagraph}

Original summary bullets:
${(parsed.summaryBullets || []).join('\n')}

Original job bullets:
${experienceContext}

Original skills:
${(parsed.skills || []).join(', ')}

Return JSON with: summaryParagraph (rewritten), summaryBullets (array), experience (array of {bullets: string[]} — one per job in same order), skills (reordered array).`
    );
    const rewritten = JSON.parse(rewriteRes.response.text());

    // --- Step 5: Merge rewritten sections with preserved structure ---
    const mergedExperience = parsed.experience.map((job: any, idx: number) => ({
      ...job,
      bullets: rewritten.experience?.[idx]?.bullets || job.bullets,
    }));

    const mergedSummaryBullets = rewritten.summaryBullets?.length
      ? rewritten.summaryBullets
      : parsed.summaryBullets || [];

    // --- Step 6: Build HTML matching original resume style ---
    const c = parsed.contact || {};
    const name = c.name || ctxContact?.name || '';
    const title = c.title || '';
    const phone = c.phone || ctxContact?.phone || '';
    const email = c.email || ctxContact?.email || '';
    const location = c.location || ctxContact?.location || '';
    const linkedin = c.linkedin || '';
    const portfolio = c.portfolio || '';

    const contactParts = [phone, email, linkedin, portfolio, location].filter(Boolean);

    const skillsHtml = (rewritten.skills || parsed.skills || [])
      .map((s: string) => `<span class="skill-tag">${s}</span>`)
      .join(' ');

    const experienceHtml = mergedExperience
      .map((job: any) => `
        <div class="job">
          <div class="job-header">
            <div class="job-left">
              <div class="job-title">${job.title}</div>
              <div class="job-company">${job.company}</div>
            </div>
            <div class="job-right">
              <div class="job-dates">${job.dates || ''}</div>
              <div class="job-location">${job.location || ''}</div>
            </div>
          </div>
          <ul class="bullets">
            ${(job.bullets || []).map((b: string) => `<li>${b}</li>`).join('')}
          </ul>
        </div>`)
      .join('');

    const achievementsHtml = (parsed.achievements || []).length > 0
      ? `<div class="section">
          <div class="section-title">Key Achievements</div>
          <ul class="achievements">
            ${(parsed.achievements || []).map((a: string) => `<li>⭐ ${a}</li>`).join('')}
          </ul>
        </div>`
      : '';

    const educationLines = [...(parsed.education || []), ...(parsed.certifications || []), ...(ctxEdu || [])];
    const educationHtml = educationLines.length > 0
      ? `<div class="section">
          <div class="section-title">Education &amp; Certifications</div>
          <ul class="bullets">
            ${educationLines.map((e: string) => `<li>${e}</li>`).join('')}
          </ul>
        </div>`
      : '';

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${name} — ATS Resume</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
    font-size: 11pt;
    color: #1a1a1a;
    max-width: 860px;
    margin: 0 auto;
    padding: 36px 48px;
    line-height: 1.5;
  }

  /* Header */
  .header { margin-bottom: 20px; border-bottom: 2px solid #1a1a1a; padding-bottom: 14px; }
  .header-name { font-size: 22pt; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 3px; }
  .header-title { font-size: 11pt; font-weight: 500; color: #444; margin-bottom: 8px; }
  .header-contact { font-size: 9.5pt; color: #555; display: flex; flex-wrap: wrap; gap: 6px 16px; }
  .header-contact span::after { content: ' ·'; color: #bbb; }
  .header-contact span:last-child::after { content: ''; }

  /* Sections */
  .section { margin-bottom: 18px; }
  .section-title {
    font-size: 9pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #333;
    border-bottom: 1px solid #ccc;
    padding-bottom: 3px;
    margin-bottom: 10px;
  }

  /* Summary */
  .summary-para { font-size: 10.5pt; color: #222; margin-bottom: 10px; line-height: 1.6; }
  .summary-bullets { padding-left: 18px; }
  .summary-bullets li { font-size: 10pt; color: #333; margin-bottom: 5px; line-height: 1.5; }

  /* Experience */
  .job { margin-bottom: 14px; }
  .job-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 5px; }
  .job-left .job-title { font-size: 10.5pt; font-weight: 700; color: #111; }
  .job-left .job-company { font-size: 10pt; color: #444; font-weight: 500; }
  .job-right { text-align: right; }
  .job-right .job-dates { font-size: 9.5pt; color: #555; }
  .job-right .job-location { font-size: 9.5pt; color: #777; }
  .bullets { padding-left: 18px; }
  .bullets li { font-size: 10pt; color: #333; margin-bottom: 4px; line-height: 1.5; }

  /* Achievements */
  .achievements { list-style: none; padding-left: 0; }
  .achievements li { font-size: 10pt; color: #333; margin-bottom: 6px; line-height: 1.5; padding-left: 4px; }

  /* Skills */
  .skills-wrap { display: flex; flex-wrap: wrap; gap: 5px 6px; }
  .skill-tag {
    font-size: 9pt;
    background: #f0f0f0;
    border: 1px solid #ddd;
    border-radius: 3px;
    padding: 2px 7px;
    color: #333;
  }

  @media print {
    body { padding: 20px 28px; }
    .skill-tag { background: #f5f5f5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

<div class="header">
  <div class="header-name">${name}</div>
  ${title ? `<div class="header-title">${title}</div>` : ''}
  <div class="header-contact">
    ${contactParts.map(p => `<span>${p}</span>`).join('')}
  </div>
</div>

<div class="section">
  <div class="section-title">Summary</div>
  <p class="summary-para">${rewritten.summaryParagraph || parsed.summaryParagraph}</p>
  ${mergedSummaryBullets.length > 0 ? `<ul class="summary-bullets">${mergedSummaryBullets.map((b: string) => `<li>${b}</li>`).join('')}</ul>` : ''}
</div>

<div class="section">
  <div class="section-title">Experience</div>
  ${experienceHtml}
</div>

${achievementsHtml}

<div class="section">
  <div class="section-title">Skills</div>
  <div class="skills-wrap">${skillsHtml}</div>
</div>

${educationHtml}

</body>
</html>`;

    return NextResponse.json({ html });
  } catch (error) {
    console.error('ATS error:', error);
    return NextResponse.json({ error: 'ATS generation failed' }, { status: 500 });
  }
}
