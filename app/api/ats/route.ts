import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Monochrome filled star — no color, no emoji
const STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="#333" stroke="#333" stroke-width="1" style="display:inline;vertical-align:-2px;margin-right:5px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

function normalizeKey(type: string): string {
  return (type || '').toLowerCase().trim();
}

function stripEmoji(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u2600-\u27BF]/g, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
    .replace(/[\u{1FA00}-\u{1FA9F}]/gu, '')
    .replace(/^STAR:\s*/i, '')
    .replace(/^⭐\s*/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .trim();
}

function isRewriteable(type: string): boolean {
  const k = normalizeKey(type);
  return k.includes('summary') || k.includes('profile') || k.includes('objective') ||
    k.includes('experience') || k.includes('work') || k.includes('skill');
}

function buildRewritePrompt(sections: any[], keywords: string[]): string {
  const rewriteableSections = sections.filter(s => isRewriteable(s.type));

  let prompt = `You are a senior career strategist and executive resume writer with deep expertise in ATS optimization. Rewrite the resume content below as a polished, high-impact professional document that naturally incorporates the provided ATS keywords.

WRITING STYLE — NON-NEGOTIABLE:
- Write in the voice of an accomplished senior professional: confident, precise, results-oriented
- Use strong action verbs (Led, Drove, Architected, Delivered, Secured, Spearheaded, Accelerated, etc.) — no first-person "I"
- Each rewritten bullet preserves the original achievement's meaning, metrics, and sentiment while naturally weaving in ATS language
- Keywords are vocabulary to draw from — integrate them into natural sentence flow; never insert them as standalone terms
- Every sentence must read as if a skilled human writer crafted it — never mechanical, never keyword-stuffed
- Maintain the implied first-person tone consistent with resume convention throughout

OUTPUT FORMAT — ABSOLUTE RULES:
- Return ONLY valid JSON — zero markdown, zero code fences, zero explanation text
- ZERO asterisks (**), ZERO underscores (__), ZERO markdown of any kind inside string values
- ZERO emoji characters anywhere in output
- The JSON must use the section's exact original type string as the key

CONTENT RULES:
- Preserve ALL metrics, percentages, dollar amounts exactly (43%, $370K, 50%, 35%, 30%, 60–90%, 65%, 75%, 25%)
- Do NOT change company names, job titles, or date ranges
- Do NOT invent achievements or fabricate numbers
- Keep bullet count exactly equal to originals — never add or remove bullets

SKILLS SECTION:
- Add ALL ATS keywords from the provided list as new skill items if not already present
- Keep every existing skill — do not remove any
- Place most ATS-relevant skills first
- Return the complete merged list

ATS KEYWORDS TO WEAVE IN:
${keywords.join(', ')}

REQUIRED JSON STRUCTURE:
{
`;

  rewriteableSections.forEach(section => {
    const k = normalizeKey(section.type);
    if (k.includes('summary') || k.includes('profile') || k.includes('objective')) {
      const d = section.data || {};
      prompt += `  "${section.type}": {\n`;
      if (d.paragraph) prompt += `    "paragraph": "<rewritten — natural prose, ATS vocab woven in, no markdown>",\n`;
      if (d.bullets?.length) prompt += `    "bullets": [/* exactly ${d.bullets.length} bullets, naturally rewritten */]\n`;
      prompt += `  },\n`;
    } else if (k.includes('experience') || k.includes('work')) {
      const entries = section.data?.entries || [];
      prompt += `  "${section.type}": { "entries": [\n`;
      entries.forEach((entry: any, idx: number) => {
        const count = entry.bullets?.length || 0;
        prompt += `    { "bullets": [/* EXACTLY ${count} bullet${count !== 1 ? 's' : ''} for ${entry.title} at ${entry.company} — no markdown */] }${idx < entries.length - 1 ? ',' : ''}\n`;
      });
      prompt += `  ]},\n`;
    } else if (k.includes('skill')) {
      const count = section.data?.items?.length || 0;
      prompt += `  "${section.type}": { "items": [/* all ${count} existing skills PLUS new ATS keywords not already present, most relevant first */] },\n`;
    }
  });

  prompt += `}

ORIGINAL CONTENT:

`;

  rewriteableSections.forEach(section => {
    const k = normalizeKey(section.type);
    prompt += `=== ${section.type} ===\n`;
    if (k.includes('summary') || k.includes('profile') || k.includes('objective')) {
      const d = section.data || {};
      if (d.paragraph) prompt += `Paragraph: ${d.paragraph}\n`;
      if (d.bullets?.length) {
        prompt += `Bullets (return exactly ${d.bullets.length}):\n`;
        d.bullets.forEach((b: string, i: number) => prompt += `  ${i + 1}. ${b}\n`);
      }
    } else if (k.includes('experience') || k.includes('work')) {
      const entries = section.data?.entries || [];
      entries.forEach((e: any, idx: number) => {
        prompt += `Entry ${idx + 1}: ${e.title} at ${e.company} (${e.dates || ''}) — return EXACTLY ${e.bullets?.length || 0} bullets\n`;
        (e.bullets || []).forEach((b: string, bi: number) => prompt += `  ${bi + 1}. ${b}\n`);
      });
    } else if (k.includes('skill')) {
      prompt += `Existing skills: ${(section.data?.items || []).join(', ')}\n`;
    }
    prompt += '\n';
  });

  return prompt;
}

function mergeByIndex(sections: any[], rewritten: any): any[] {
  if (!rewritten) return sections;
  return sections.map(section => {
    if (!isRewriteable(section.type)) return section;
    const rw = rewritten[section.type];
    if (!rw) return section;
    const k = normalizeKey(section.type);
    if (k.includes('summary') || k.includes('profile') || k.includes('objective')) {
      return {
        ...section,
        data: {
          ...section.data,
          paragraph: rw.paragraph ? stripEmoji(rw.paragraph) : section.data?.paragraph,
          bullets: Array.isArray(rw.bullets) && rw.bullets.length > 0
            ? rw.bullets.map((b: string) => stripEmoji(b))
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
              ? rwEntries[idx].bullets.map((b: string) => stripEmoji(b))
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
            ? rw.items.map((s: string) => stripEmoji(s))
            : section.data?.items,
        },
      };
    }
    return section;
  });
}

/**
 * Replace display text with anchor tags wherever a resolved link matches.
 * Runs on any string — bullet text, paragraphs, etc.
 * Only replaces the FIRST occurrence to avoid double-wrapping.
 * Safe: skips if displayText or url is empty.
 */
function linkifyText(text: string, resolvedLinks: { displayText: string; url: string }[]): string {
  let result = text;
  for (const link of resolvedLinks) {
    if (!link.displayText || !link.url) continue;
    // Escape special regex chars in the display text
    const escaped = link.displayText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const href = link.url.startsWith('http') ? link.url : `https://${link.url}`;
    result = result.replace(
      new RegExp(`(?<!<a[^>]*>)(${escaped})(?![^<]*<\/a>)`, 'i'),
      `<a href="${href}" target="_blank" style="color:inherit;text-decoration:underline">$1</a>`
    );
  }
  return result;
}

function buildHTML(resume: any, atsTitle: string, jobTitle?: string): string {
  const c = resume.contact || {};
  const links: any[] = c.links || [];

  // Build full resolvedLinks from contact links + any companyUrls in experience
  // These are used by linkifyText to make any matching text clickable
  const resolvedLinks: { displayText: string; url: string }[] = [
    ...(resume.resolvedLinks || []),
    ...links.filter((l: any) => l.url),
  ];
  // Deduplicate by url
  const seenUrls = new Set<string>();
  const uniqueResolvedLinks = resolvedLinks.filter((l: any) => {
    if (!l.url || seenUrls.has(l.url)) return false;
    seenUrls.add(l.url);
    return true;
  });

  const contactParts: string[] = [];
  if (c.phone) contactParts.push(`<span>${c.phone}</span>`);
  if (c.email) contactParts.push(`<span><a href="mailto:${c.email}">${c.email}</a></span>`);
  links.forEach((l: any) => {
    if (l.url && l.url.trim()) {
      const href = l.url.startsWith('http') ? l.url : `https://${l.url}`;
      contactParts.push(`<span><a href="${href}" target="_blank">${l.displayText || l.url}</a></span>`);
    } else if (l.displayText && l.displayText.trim()) {
      contactParts.push(`<span>${l.displayText}</span>`);
    }
  });
  if (c.location) contactParts.push(`<span>${c.location}</span>`);

  const sectionsHtml = (resume.sections || []).map((section: any) => {
    const k = normalizeKey(section.type);
    const label = section.type || '';
    const data = section.data || {};

    if (k.includes('summary') || k.includes('profile') || k.includes('objective')) {
      const bullets = (data.bullets || []).map((b: string) => linkifyText(stripEmoji(b), uniqueResolvedLinks));
      const paragraph = linkifyText(stripEmoji(data.paragraph || ''), uniqueResolvedLinks);
      return `
<div class="section">
  <div class="section-title">${label}</div>
  ${paragraph ? `<p class="summary-para">${paragraph}</p>` : ''}
  ${bullets.length ? `<ul class="summary-bullets">${bullets.map((b: string) => `<li>${b}</li>`).join('')}</ul>` : ''}
</div>`;
    }

    if (k.includes('experience') || k.includes('work')) {
      const entries = data.entries || [];
      const entriesHtml = entries.map((entry: any) => {
        const bullets = (entry.bullets || []).map((b: string) => linkifyText(stripEmoji(b), uniqueResolvedLinks));
        return `
<div class="job">
  <div class="job-header">
    <div class="job-left">
      <span class="job-title">${entry.title || ''}</span>
      ${entry.companyUrl
        ? `<a href="${entry.companyUrl.startsWith('http') ? entry.companyUrl : 'https://' + entry.companyUrl}" target="_blank" class="job-company" style="text-decoration:underline">${entry.company || ''}</a>`
        : `<span class="job-company">${entry.company || ''}</span>`
      }
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

    if (k.includes('skill')) {
      const items = (data.items || []).map((s: string) => stripEmoji(s));
      return `
<div class="section">
  <div class="section-title">${label}</div>
  <div class="skills-wrap">${items.map((s: string) => `<span class="skill-tag">${s}</span>`).join('')}</div>
</div>`;
    }

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
<title>${c.name || 'Resume'} — ATS Resume${jobTitle ? ` · ${jobTitle}` : ''}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
  font-size: 11pt; color: #1a1a1a;
  max-width: 860px; margin: 0 auto; padding: 36px 48px; line-height: 1.5;
  background: #fff;
}
a { color: inherit; text-decoration: none; }
a:hover { text-decoration: underline; }
.action-bar {
  position: fixed; top: 0; left: 0; right: 0;
  background: #1a1a1a; color: white;
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 20px; gap: 12px; z-index: 100;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
}
.action-bar-left { display: flex; align-items: center; gap: 10px; }
.action-bar-right { display: flex; align-items: center; gap: 8px; }
.action-bar span.label { font-size: 12px; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px; }
.btn-back {
  background: rgba(255,255,255,0.12); color: white; border: 1px solid rgba(255,255,255,0.2);
  border-radius: 8px; padding: 6px 14px; font-size: 13px; cursor: pointer; white-space: nowrap;
}
.btn-back:hover { background: rgba(255,255,255,0.2); }
.btn-print {
  background: #007aff; color: white; border: none;
  border-radius: 8px; padding: 7px 18px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.btn-print:hover { background: #0066dd; }
.resume-body { margin-top: 52px; }
.header { margin-bottom: 20px; border-bottom: 2px solid #1a1a1a; padding-bottom: 14px; }
.header-name { font-size: 22pt; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 3px; }
.header-title { font-size: 10.5pt; font-weight: 500; color: #444; margin-bottom: 8px; line-height: 1.5; }
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
  .resume-body { margin-top: 60px; }
  .header-name { font-size: 16pt; }
  .job-header { flex-direction: column; gap: 2px; }
  .job-right { text-align: left; }
  .action-bar { padding: 8px 16px; }
  .action-bar span.label { display: none; }
}
@media print {
  .action-bar { display: none; }
  .resume-body { margin-top: 0; }
  body { padding: 20px 28px; }
  .skill-tag { background: #f5f5f5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
</head>
<body>
<div class="action-bar">
  <div class="action-bar-left">
    <button class="btn-back" onclick="history.back()">← Back to Results</button>
    <span class="label">${jobTitle ? `ATS Resume · ${jobTitle}` : 'ATS Resume'}</span>
  </div>
  <div class="action-bar-right">
    <button class="btn-print" onclick="window.print()">Save as PDF</button>
  </div>
</div>
<div class="resume-body">
<div class="header">
  <div class="header-name">${c.name || ''}</div>
  ${atsTitle ? `<div class="header-title">${atsTitle}</div>` : ''}
  <div class="header-contact">${contactParts.join('')}</div>
</div>
${sectionsHtml}
</div>
</body>
</html>`;
}

export async function POST(req: Request) {
  try {
    const { jobText, snippet, parsedResume, jobTitle } = await req.json();
    const apiKey = req.headers.get('x-gemini-key');

    if (!apiKey) return NextResponse.json({ error: 'Missing API Key' }, { status: 401 });
    if (!parsedResume) return NextResponse.json({ error: 'No parsed resume' }, { status: 400 });

    const jdText = jobText || snippet || '';
    if (!jdText) return NextResponse.json({ error: 'No job description text' }, { status: 400 });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // Step 1 — Extract ATS keywords AND role descriptor phrases for title line
    // Single call returns both — no extra latency
    const kwRes = await model.generateContent(
      `Analyze this job description and return a JSON object with two keys:

1. "keywords": array of the top 25 ATS keywords and phrases (skills, tools, methodologies, role-specific terms, action verbs)
2. "titleDescriptors": array of 2–4 short role descriptor phrases that naturally extend a professional title line on a resume. These should be drawn from the JD's required skills, specialties, or focus areas — terms that read as professional specializations (e.g. "Design Systems", "Product Strategy", "AI Experience Design", "Systems Architecture"). They must be concise (1–3 words each), title-case, and sound natural when pipe-separated after a job title like: "Senior Product Designer | Design Systems | AI Experience". Do NOT include generic terms like "Leadership" or "Communication".

Return ONLY valid JSON, no markdown, no explanation.

Job description:
${jdText}`
    );

    let kwText = kwRes.response.text().trim();
    if (kwText.startsWith('`')) kwText = kwText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();

    let keywords: string[] = [];
    let titleDescriptors: string[] = [];

    try {
      const parsed = JSON.parse(kwText);
      keywords = Array.isArray(parsed.keywords) ? parsed.keywords : [];
      titleDescriptors = Array.isArray(parsed.titleDescriptors) ? parsed.titleDescriptors : [];
    } catch {
      // Fallback: treat entire response as flat keyword array
      try { keywords = JSON.parse(kwText); } catch { keywords = []; }
    }

    // Build the ATS title line: JD job title + pipe-separated descriptors
    // e.g. "Director, UX Design | Design Systems | Product Strategy | AI Experience"
    const atsTitleParts = [jobTitle, ...titleDescriptors].filter(Boolean);
    const atsTitle = atsTitleParts.join(' | ');

    // Step 2 — Build rewrite prompt
    const sections = parsedResume.sections || [];
    const rewritePrompt = buildRewritePrompt(sections, keywords);

    // Step 3 — Rewrite
    const rwRes = await model.generateContent(rewritePrompt);
    let rwText = rwRes.response.text().trim();
    if (rwText.startsWith('`')) rwText = rwText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();

    let rewritten: any = null;
    try {
      rewritten = JSON.parse(rwText);
    } catch {
      const fix = await model.generateContent(
        `Fix this malformed JSON and return only valid JSON, no markdown:\n\n${rwText.substring(0, 6000)}`
      );
      let fixText = fix.response.text().trim();
      if (fixText.startsWith('`')) fixText = fixText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
      rewritten = JSON.parse(fixText);
    }

    // Step 4 — Merge
    const mergedSections = mergeByIndex(sections, rewritten);
    const mergedResume = { ...parsedResume, sections: mergedSections };

    // Step 5 — Build HTML with atsTitle in header, jobTitle in action bar only
    const html = buildHTML(mergedResume, atsTitle, jobTitle);
    return NextResponse.json({ html });

  } catch (error) {
    console.error('ATS error:', error);
    return NextResponse.json({ error: 'ATS generation failed' }, { status: 500 });
  }
}
