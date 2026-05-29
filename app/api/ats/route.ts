import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Builds a dynamic rewrite prompt from whatever sections exist in the parsed schema
function buildRewritePrompt(parsedResume: any, keywords: string[]): string {
  const sections = parsedResume.sections || [];
  let prompt = `You are an expert ATS resume optimizer. Rewrite ONLY the content sections listed below to naturally incorporate these ATS keywords: ${keywords.join(', ')}.

ABSOLUTE RULES — violations will break the resume:
- Return only valid JSON, no markdown, no code fences, no explanation
- Preserve ALL metrics, percentages, and dollar amounts exactly as written
- Do not change any company names, job titles, or dates
- Do not invent new achievements or fabricate numbers
- Each experience entry must return EXACTLY the same number of bullets as specified — no more, no less
- Keep bullet length similar to originals
- Reorder skills to prioritize the most relevant ATS keywords first, same total count
- If a section has no rewriteable text (e.g. education dates only), return it unchanged

Return a JSON object with this structure — one key per rewriteable section, using the exact section types listed:

{\n`;

  const rewriteable: any[] = [];

  for (const section of sections) {
    const type = section.type?.toLowerCase() || '';

    if (type.includes('summary') || type.includes('profile') || type.includes('objective')) {
      const d = section.data || {};
      prompt += `  "${section.type}": {\n`;
      if (d.paragraph) prompt += `    "paragraph": "rewritten paragraph incorporating keywords",\n`;
      if (d.bullets?.length) prompt += `    "bullets": [/* exactly ${d.bullets.length} bullets */]\n`;
      prompt += `  },\n`;
      rewriteable.push(section);
    }

    else if (type.includes('experience') || type.includes('work')) {
      const entries = section.data?.entries || [];
      prompt += `  "${section.type}": {\n    "entries": [\n`;
      entries.forEach((entry: any, idx: number) => {
        const bulletCount = entry.bullets?.length || 0;
        prompt += `      { "bullets": [/* EXACTLY ${bulletCount} bullet${bulletCount !== 1 ? 's' : ''} for ${entry.title} at ${entry.company} */] }${idx < entries.length - 1 ? ',' : ''}\n`;
      });
      prompt += `    ]\n  },\n`;
      rewriteable.push(section);
    }

    else if (type.includes('skill')) {
      const count = section.data?.items?.length || 0;
      prompt += `  "${section.type}": {\n    "items": [/* exactly ${count} skills, reordered with most ATS-relevant first */]\n  },\n`;
      rewriteable.push(section);
    }
  }

  prompt += `}\n\nOriginal content to rewrite:\n\n`;

  for (const section of rewriteable) {
    const type = section.type?.toLowerCase() || '';
    prompt += `--- ${section.type} ---\n`;

    if (type.includes('summary') || type.includes('profile') || type.includes('objective')) {
      const d = section.data || {};
      if (d.paragraph) prompt += `Paragraph: ${d.paragraph}\n`;
      if (d.bullets?.length) {
        prompt += `Bullets (${d.bullets.length} total):\n`;
        d.bullets.forEach((b: string, i: number) => prompt += `  ${i + 1}. ${b}\n`);
      }
    }

    else if (type.includes('experience') || type.includes('work')) {
      const entries = section.data?.entries || [];
      entries.forEach((entry: any, idx: number) => {
        prompt += `Entry ${idx + 1}: ${entry.title} at ${entry.company} (${entry.dates || ''}) — ${entry.bullets?.length || 0} bullets\n`;
        (entry.bullets || []).forEach((b: string, bi: number) => prompt += `  ${bi + 1}. ${b}\n`);
      });
    }

    else if (type.includes('skill')) {
      prompt += `Skills: ${(section.data?.items || []).join(', ')}\n`;
    }

    prompt += '\n';
  }

  return prompt;
}

// Merges rewritten sections back into the original parsed structure
function mergeRewrite(parsedResume: any, rewritten: any): any {
  if (!rewritten) return parsedResume;

  const mergedSections = parsedResume.sections.map((section: any) => {
    const rw = rewritten[section.type];
    if (!rw) return section; // not rewritten — return original unchanged

    const type = section.type?.toLowerCase() || '';

    if (type.includes('summary') || type.includes('profile') || type.includes('objective')) {
      return {
        ...section,
        data: {
          ...section.data,
          paragraph: rw.paragraph || section.data?.paragraph,
          bullets: rw.bullets?.length ? rw.bullets : section.data?.bullets,
        },
      };
    }

    if (type.includes('experience') || type.includes('work')) {
      const originalEntries = section.data?.entries || [];
      const rewrittenEntries = rw.entries || [];
      return {
        ...section,
        data: {
          entries: originalEntries.map((entry: any, idx: number) => ({
            ...entry,
            bullets: rewrittenEntries[idx]?.bullets?.length
              ? rewrittenEntries[idx].bullets
              : entry.bullets,
          })),
        },
      };
    }

    if (type.includes('skill')) {
      return {
        ...section,
        data: { items: rw.items?.length ? rw.items : section.data?.items },
      };
    }

    return section;
  });

  return { ...parsedResume, sections: mergedSections };
}

// Renders final HTML from merged schema — fully dynamic
function buildHTML(resume: any): string {
  const c = resume.contact || {};
  const contactParts = [c.phone, c.email, c.linkedin, c.portfolio, c.location, c.other]
    .filter(Boolean);

  const sectionsHtml = (resume.sections || []).map((section: any) => {
    const type = section.type?.toLowerCase() || '';
    const label = section.type || '';
    const data = section.data || {};

    // Summary / Profile / Objective
    if (type.includes('summary') || type.includes('profile') || type.includes('objective')) {
      const bullets = data.bullets || [];
      return `
      <div class="section">
        <div class="section-title">${label}</div>
        ${data.paragraph ? `<p class="summary-para">${data.paragraph}</p>` : ''}
        ${bullets.length ? `<ul class="summary-bullets">${bullets.map((b: string) => `<li>${b}</li>`).join('')}</ul>` : ''}
      </div>`;
    }

    // Experience / Work History
    if (type.includes('experience') || type.includes('work')) {
      const entries = data.entries || [];
      const entriesHtml = entries.map((entry: any) => `
        <div class="job">
          <div class="job-header">
            <div class="job-left">
              <span class="job-title">${entry.title || ''}</span>
              <span class="job-company">${entry.company || ''}</span>
            </div>
            <div class="job-right">
              <span class="job-dates">${entry.dates || ''}</span>
              <span class="job-location">${entry.location || ''}</span>
            </div>
          </div>
          ${entry.bullets?.length ? `<ul class="bullets">${entry.bullets.map((b: string) => `<li>${b}</li>`).join('')}</ul>` : ''}
        </div>`).join('');
      return `
      <div class="section">
        <div class="section-title">${label}</div>
        ${entriesHtml}
      </div>`;
    }

    // Skills
    if (type.includes('skill')) {
      const items = data.items || [];
      return `
      <div class="section">
        <div class="section-title">${label}</div>
        <div class="skills-wrap">${items.map((s: string) => `<span class="skill-tag">${s}</span>`).join('')}</div>
      </div>`;
    }

    // Achievements / Accomplishments
    if (type.includes('achievement') || type.includes('accomplishment')) {
      const items = data.items || [];
      return `
      <div class="section">
        <div class="section-title">${label}</div>
        <ul class="achievements">${items.map((a: string) => `<li>${a}</li>`).join('')}</ul>
      </div>`;
    }

    // Education, Certifications, or any other list-based section
    const items = data.items || data.entries || [];
    if (items.length) {
      return `
      <div class="section">
        <div class="section-title">${label}</div>
        <ul class="bullets">${items.map((item: any) => {
          if (typeof item === 'string') return `<li>${item}</li>`;
          // Handle entry objects in non-experience sections
          const parts = [item.title, item.company, item.dates, item.location].filter(Boolean);
          return `<li>${parts.join(' · ')}</li>`;
        }).join('')}</ul>
      </div>`;
    }

    // Paragraph-only section
    if (data.paragraph) {
      return `
      <div class="section">
        <div class="section-title">${label}</div>
        <p class="summary-para">${data.paragraph}</p>
      </div>`;
    }

    return '';
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${c.name || 'Resume'} — ATS Resume</title>
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
  .header { margin-bottom: 20px; border-bottom: 2px solid #1a1a1a; padding-bottom: 14px; }
  .header-name { font-size: 22pt; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 3px; }
  .header-title { font-size: 11pt; font-weight: 500; color: #444; margin-bottom: 8px; }
  .header-contact { font-size: 9.5pt; color: #555; display: flex; flex-wrap: wrap; gap: 6px 0; }
  .header-contact span::after { content: ' · '; color: #bbb; white-space: pre; }
  .header-contact span:last-child::after { content: ''; }
  .section { margin-bottom: 18px; }
  .section-title {
    font-size: 9pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: #333;
    border-bottom: 1px solid #ccc; padding-bottom: 3px; margin-bottom: 10px;
  }
  .summary-para { font-size: 10.5pt; color: #222; margin-bottom: 10px; line-height: 1.6; }
  .summary-bullets { padding-left: 18px; }
  .summary-bullets li { font-size: 10pt; color: #333; margin-bottom: 5px; line-height: 1.5; }
  .job { margin-bottom: 14px; }
  .job-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 5px; }
  .job-left { display: flex; flex-direction: column; }
  .job-title { font-size: 10.5pt; font-weight: 700; color: #111; }
  .job-company { font-size: 10pt; color: #444; font-weight: 500; }
  .job-right { text-align: right; display: flex; flex-direction: column; }
  .job-dates { font-size: 9.5pt; color: #555; }
  .job-location { font-size: 9.5pt; color: #777; }
  .bullets { padding-left: 18px; }
  .bullets li { font-size: 10pt; color: #333; margin-bottom: 4px; line-height: 1.5; }
  .achievements { list-style: none; padding-left: 0; }
  .achievements li { font-size: 10pt; color: #333; margin-bottom: 6px; line-height: 1.5; padding-left: 4px; }
  .skills-wrap { display: flex; flex-wrap: wrap; gap: 5px 6px; }
  .skill-tag {
    font-size: 9pt; background: #f0f0f0; border: 1px solid #ddd;
    border-radius: 3px; padding: 2px 7px; color: #333;
  }
  @media print {
    body { padding: 20px 28px; }
    .skill-tag { background: #f5f5f5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="header">
  <div class="header-name">${c.name || ''}</div>
  ${c.title ? `<div class="header-title">${c.title}</div>` : ''}
  <div class="header-contact">
    ${contactParts.map((p: string) => `<span>${p}</span>`).join('')}
  </div>
</div>
${sectionsHtml}
</body>
</html>`;
}

export async function POST(req: Request) {
  try {
    const { jobUrl, snippet, parsedResume } = await req.json();
    const apiKey = req.headers.get('x-gemini-key');

    if (!apiKey) return NextResponse.json({ error: 'Missing API Key' }, { status: 401 });
    if (!parsedResume) return NextResponse.json({ error: 'No parsed resume provided' }, { status: 400 });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Step 1: Fetch JD text
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

    // Step 2: Extract keywords
    const kwRes = await model.generateContent(
      `Extract the top 20 most important ATS keywords and phrases from this job description. Include skills, tools, methodologies, and role-specific terms. Return ONLY a JSON array of strings, no markdown, no explanation.\n\n${jobText}`
    );
    let kwText = kwRes.response.text().trim();
    if (kwText.startsWith('```')) kwText = kwText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    const keywords: string[] = JSON.parse(kwText);

    // Step 3: Build dynamic rewrite prompt from actual schema
    const rewritePrompt = buildRewritePrompt(parsedResume, keywords);

    // Step 4: Rewrite
    const rwRes = await model.generateContent(rewritePrompt);
    let rwText = rwRes.response.text().trim();
    if (rwText.startsWith('```')) rwText = rwText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();

    let rewritten: any = null;
    try {
      rewritten = JSON.parse(rwText);
    } catch {
      // Retry JSON fix
      const fix = await model.generateContent(
        `Fix this malformed JSON and return only valid JSON, no markdown:\n\n${rwText.substring(0, 6000)}`
      );
      let fixText = fix.response.text().trim();
      if (fixText.startsWith('```')) fixText = fixText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
      rewritten = JSON.parse(fixText);
    }

    // Step 5: Merge rewritten sections with original structure
    const merged = mergeRewrite(parsedResume, rewritten);

    // Step 6: Build HTML from merged dynamic schema
    const html = buildHTML(merged);

    return NextResponse.json({ html });

  } catch (error) {
    console.error('ATS error:', error);
    return NextResponse.json({ error: 'ATS generation failed' }, { status: 500 });
  }
}
