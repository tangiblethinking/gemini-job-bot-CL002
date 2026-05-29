import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const responseSchema = {
  type: "object",
  properties: {
    titles: {
      type: "array",
      items: { type: "string" },
      description: "Top 3 job titles the user is qualified for"
    },
    skills: {
      type: "array",
      items: { type: "string" },
      description: "Core technical and soft skills"
    },
    seniority: {
      type: "string",
      description: "Current seniority level e.g. Junior, Senior, Director"
    },
    contact: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        location: { type: "string", description: "City, State or Remote preference" }
      },
      required: ["name", "email"]
    },
    education: {
      type: "array",
      items: { type: "string" },
      description: "List of degrees and certifications exactly as formatted on resume"
    }
  },
  required: ["titles", "skills", "seniority", "contact", "education"]
};

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
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: responseSchema as any,
      },
    });

    const prompt = `Extract the following from this resume text: top 3 job titles the candidate is qualified for, core skills, seniority level, contact information (name, email, phone, location), and education history. Resume text: "${rawText.substring(0, 5000)}"`;

    const result = await model.generateContent(prompt);
    const parsed_json = JSON.parse(result.response.text());

    return NextResponse.json({ ...parsed_json, rawText });
  } catch (error) {
    console.error('Extract error:', error);
    return NextResponse.json({ error: 'Extraction failed' }, { status: 500 });
  }
}
