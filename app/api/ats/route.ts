import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Lucide "star" filled SVG inline — no external dependency
const STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="#f59e0b" stroke="#f59e0b" stroke-width="1" style="display:inline;vertical-align:-2px;margin-right:5px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

// Normalize section type to a stable lowercase key for matching
function normalizeKey(type: string): string {
  return (type || '').toLowerCase().trim();
}

// Strip emoji from text
function stripEmoji(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u2600-\u27BF]/g, '')
    .replace(/^STAR:\s*/i, '')
    .replace(/^⭐\s*/g, '')
    .trim();
}

// Identify which sections are rewriteable
function isRewriteable(type: string): boolean {
  const k = normalizeKey(type);
  return k.includes('summary') || k.includes('profile') || k.includes('objective') ||
    k.includes('experience') || k.includes('work') || k.includes('skill');
}

// Build dynamic rewrite prompt from schema — uses indices not string keys
function buildRewritePrompt(sections: any[], keywords: string[]): string {
  const rewriteableSections = sections.filter(s => isRewriteable(s.type));

  let prompt = `You are an expert ATS resume optimizer. Rewrite the content below to naturally incorporate these ATS keywords: ${keywords.join(', ')}.

ABSOLUTE RULES:
- Return ONLY valid JSON — no markdown, no code fences, no explanation
- The JSON must have exactly one key per rewriteable section, named by the section's original type string verbatim
- Preserve ALL metrics, percentages, and dollar amounts exactly (43%, $370K, 50%, 35%, 30%, etc.)
- Do NOT change any company names, job titles, or dates
- Do NOT invent new achievements or fabricate numbers
- Do NOT use any emoji characters
- Keep bullet length similar to originals
- For skills: reorder to put most ATS-relevant first, same total count

REQUIRED OUTPUT STRUCTURE:
{
`;

  rewriteableSections.forEach(section => {
    const k = normalizeKey(section.type);
    if (k.includes('summary') || k.includes('profile') || k.includes('objective')) {
      const d = section.data || {};
      prompt += `  "${section.type}": {\n`;
      if (d.paragraph) prompt += `    "paragraph": "<rewritten paragraph>",\n`;
      if (d.bullets?.length) prompt += `    "bullets": [/* exactly ${d.bullets.length} bullets */]\n`;
      prompt += `  },\n`;
    } else if (k.includes('experience') || k.includes('work')) {
      const entries = section.data?.entries || [];
      prompt += `  "${section.type}": { "entries": [\n`;
      entries.forEach((entry: any, idx: number) => {
        const count = entry.bullets?.length || 0;
        prompt += `    { "bullets": [/* EXACTLY ${count} bullet${count !== 1 ? 's' : ''} — ${entry.title} at ${entry.company} */] }${idx < entries.length - 1 ? ',' : ''}\n`;
      });
      prompt += `  ]},\n`;
    } else if (k.includes('skill')) {
      const count = section.data?.items?.length || 0;
      prompt += `  "${section.type}": { "items": [/* exactly ${count} skills reordered */] },\n`;
    }
  });

  prompt += `}

ORIGINAL CONTENT TO REWRITE:

`;

  rewriteableSections.forEach(section => {
    const k = normalizeKey(section.type);
    prompt += `=== ${section.type} ===\n`;
    if (k.includes('summary') || k.includes('profile') || k.includes('objective')) {
      const d = section.data || {};
      if (d.paragraph) prompt += `Paragraph: ${d.paragraph}\n`;
      if (d.bullets?.length) {
        prompt += `Bullets (must return exactly ${d.bullets.length}):\n`;
        d.bullets.forEach((b: string, i: number) => prompt += `  ${i + 1}. ${b}\n`);
      }
    } else if (k.includes('experience') || k.includes('work')) {
      const entries = section.data?.entries || [];
      entries.forEach((e: any, idx: number) => {
        prompt += `Entry ${idx + 1}: ${e.title} at ${e.company} (${e.dates || ''}) — must return exactly ${e.bullets?.length || 0} bullets\n`;
        (e.bullets || []).forEach((b: string, bi: number) => prompt += `  ${bi + 1}. ${b}\n`);
      });
    } else if (k.includes('skill')) {
      prompt += `Skills: ${(section.data?.items || []).join(', ')}\n`;
    }
    prompt += '\n';
  });

  return prompt;
}

// Merge by section index position — not string key matching
function mergeByIndex(sections: any[], rewritten: any): any[] {
  if (!rewritten) return sections;

  return sections.map(section => {
    if (!isRewriteable(section.type)) return section;

    // Find rewritten data by the exact type string key
    const rw = rewritten[section.type];
    if (!rw) return section; // fallback to original if AI missed this section

    const k = normalizeKey(section.type);

    if (k.includes('summary') || k.includes('profile') || k.includes('objective')) {
      return {
        ...section,
        data: {
          ...section.data,
          paragraph: rw.paragraph || section.data?.paragraph,
          bullets: Array.isArray(rw.bullets) && rw.bullets.length > 0
            ? rw.bullets
            : section.data?.bullets,
        },
      };
    }

    if (k.includes('experience') || k.includes('work')) {
      const origEntries = section.data?.entries || [];
      const rwEntries = rw.entries || [];
      return {
        ...section,
        data: {
          entries: origEntries.map((entry: any, idx: number) => ({
            ...entry,
            bullets: Array.isArray(rwEntries[idx]?.bullets) && rwEntries[idx].bullets.length > 0
              ? rwEntries[idx].bullets
              : entry.bullets,
          })),
        },
      };
    }

    if (k.includes('skill')) {
      return {
        ...section,
        data: {
          items: Array.isArray(rw.items) && rw.items.length > 0
            ? rw.items
            : section.data?.items,
        },
      };
    }

    return section;
  });
}

// Build HTML — fully dynamic, no hardcoded sections
function buildHTML(resume: any): string {
  const c = resume.contact || {};
  const links: any[] = c.links || [];

  // Build contact line
  const contactParts: string[] = [];
  if (c.phone) contactParts.push(`<span>${c.phone}</span>`);
  if (c.email) contactParts.push(`<span><a href="mailto:${c.email}">${c.email}</a></span>`);
  links.forEach((l: any) => {
    if (l.url) {
      contactParts.push(`<span><a href="${l.url}" target="_blank">${l.displayText || l.url}</a></span>`);
    } else if (l.displayText) {
      contactParts.push(`<span>${l.displayText}</span>`);
    }
  });
  if (c.location) contactParts.push(`<span>${c.location}</span>`);

  const sectionsHtml = (resume.sections || []).map((section: any) => {
    const k = normalizeKey(section.type);
    const label = section.type || '';
    const data = section.data || {};

    // Summary / Profile / Objective
    if (k.includes('summary') || k.includes('profile') || k.includes('objective')) {
      const bullets = (data.bullets || []).map((b: string) => stripEmoji(b));
      const paragraph = stripEmoji(data.paragraph || '');
      return `
      <div class="section">
        <div class="section-title">${label}</div>
        ${paragraph ? `<p class="summary-para">${paragraph}</p>` : ''}
        ${bullets.length ? `<ul class="summary-bullets">${bullets.map((b: string) => `<li>${b}</li>`).join('')}</ul>` : ''}
      </div>`;
    }

    // Experience / Work
    if (k.includes('experience') || k.includes('work')) {
      const entries = data.entries || [];
      const entriesHtml = entries.map((entry: any) => {
        const bullets = (entry.bullets || []).map((b: string) => stripEmoji(b));
        return `
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
          ${bullets.length ? `<ul class="bullets">${bullets.map((b: string) => `<li>${b}</li>`).join('')}</ul>` : ''}
        </div>`;
      }).join('');
      return `
      <div class="section">
        <div class="section-title">${label}</div>
        ${entriesHtml}
      </div>`;
    }

    // Skills
    if (k.includes('skill')) {
      const items = (data.items || []).map((s: string) => stripEmoji(s));
      return `
      <div class="section">
        <div class="section-title">${label}</div>
        <div class="skills-wrap">${items.map((s: string) => `<span class="skill-tag">${s}</span>`).join('')}</div>
      </div>`;
    }

    // Achievements / Accomplishments — Lucide star SVG, no emoji
    if (k.includes('achievement') || k.includes('accomplishment')) {
      const items = (data.items || []).map((a: string) => stripEmoji(a));
      return `
      <div class="section">
        <div class="section-title">${label}</div>
        <ul class="achievements">
          ${items.map((a: string) => `<li>${STAR_SVG}${a}</li>`).join('')}
        </ul>
      </div>`;
    }

    // Education, Certifications, or any other list-based section
    const items = data.items || [];
    if (items.length) {
      return `
      <div class="section">
        <div class="section-title">${label}</div>
        <ul class="bullets">
          ${items.map((item: any) => {
            if (typeof item === 'string') return `<li>${stripEmoji(item)}</li>`;
            const parts = [item.title, item.company, item.dates, item.location].filter(Boolean);
            return `<li>${parts.join(' · ')}</li>`;
          }).join('')}
        </ul>
      </div>`;
    }

    // Paragraph-only fallback
    if (data.paragraph) {
      return `
      <div class="section">
        <div class="section-title">${label}</div>
        <p class="summary-para">${stripEmoji(data.paragraph)}</p>
      </div>`;
    }

    return '';
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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
  a { color: inherit; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .header { margin-bottom: 20px; border-bottom: 2px solid #1a1a1a; padding-bottom: 14px; }
  .header-name { font-size: 22pt; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 3px; }
  .header-title { font-size: 11pt; font-weight: 500; color: #444; margin-bottom: 8px; line-height: 1.4; }
  .header-contact { font-size: 9.5pt; color: #555; display: flex; flex-wrap: wrap; gap: 4px 0; }
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
  .job-right { text-align: right; display: flex; flex-direction: column; flex-shrink: 0; }
  .job-dates { font-size: 9.5pt; color: #555; }
  .job-location { font-size: 9.5pt; color: #777; }
  .bullets { padding-left: 18px; }
  .bullets li { font-size: 10pt; color: #333; margin-bottom: 4px; line-height: 1.5; }
  .achievements { list-style: none; padding-left: 0; }
  .achievements li { font-size: 10pt; color: #333; margin-bottom: 6px; line-height: 1.5; }
  .skills-wrap { display: flex; flex-wrap: wrap; gap: 5px 6px; }
  .skill-tag {
    font-size: 9pt; background: #f0f0f0; border: 1px solid #ddd;
    border-radius: 3px; padding: 2px 7px; color: #333;
  }
  @media screen and (max-width: 600px) {
    body { padding: 20px 16px; font-size: 10pt; }
    .header-name { font-size: 16pt; }
    .job-header { flex-direction: column; gap: 2px; }
    .job-right { text-align: left; }
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
  <div class="header-contact">${contactParts.join('')}</div>
</div>
${sectionsHtml}
</body>
</html>`;
}

export async function POST(req: Request) {
  try {
    const { jobText, snippet, parsedResume } = await req.json();
    const apiKey = req.headers.get('x-gemini-key');

    if (!apiKey) return NextResponse.json({ error: 'Missing API Key' }, { status: 401 });
    if (!parsedResume) return NextResponse.json({ error: 'No parsed resume' }, { status: 400 });

    const jdText = jobText || snippet || '';
    if (!jdText) return NextResponse.json({ error: 'No job description text' }, { status: 400 });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Step 1 — Extract ATS keywords
    const kwRes = await model.generateContent(
      `Extract the top 20 most important ATS keywords and phrases from this job description. Include skills, tools, methodologies, role-specific terms, and action verbs. Return ONLY a JSON array of strings — no markdown, no explanation.\n\n${jdText}`
    );
    let kwText = kwRes.response.text().trim();
    if (kwText.startsWith('```')) kwText = kwText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    const keywords: string[] = JSON.parse(kwText);

    // Step 2 — Build dynamic rewrite prompt from actual schema sections
    const sections = parsedResume.sections || [];
    const rewritePrompt = buildRewritePrompt(sections, keywords);

    // Step 3 — Rewrite
    const rwRes = await model.generateContent(rewritePrompt);
    let rwText = rwRes.response.text().trim();
    if (rwText.startsWith('```')) rwText = rwText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();

    let rewritten: any = null;
    try {
      rewritten = JSON.parse(rwText);
    } catch {
      const fix = await model.generateContent(
        `Fix this malformed JSON and return only valid JSON, no markdown:\n\n${rwText.substring(0, 6000)}`
      );
      let fixText = fix.response.text().trim();
      if (fixText.startsWith('```')) fixText = fixText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
      rewritten = JSON.parse(fixText);
    }

    // Step 4 — Merge rewritten into original schema by index
    const mergedSections = mergeByIndex(sections, rewritten);
    const mergedResume = { ...parsedResume, sections: mergedSections };

    // Step 5 — Build HTML
    const html = buildHTML(mergedResume);
    return NextResponse.json({ html });

  } catch (error) {
    console.error('ATS error:', error);
    return NextResponse.json({ error: 'ATS generation failed' }, { status: 500 });
  }
}
