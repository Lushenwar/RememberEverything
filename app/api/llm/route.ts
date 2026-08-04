// Single server entry point for every LLM-backed engine call. Keeps
// ANTHROPIC_API_KEY off the client; grows one case per phase.
import { NextResponse } from 'next/server';
import { processRawContent } from '@/lib/ingestion';
import { llmAvailable } from '@/lib/llm';

export async function POST(req: Request) {
  let body: { task?: string; [k: string]: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  try {
    switch (body.task) {
      case 'ingest': {
        const text = typeof body.text === 'string' ? body.text : '';
        if (!text.trim()) return NextResponse.json({ error: 'text is required' }, { status: 400 });
        const category = typeof body.category === 'string' && body.category.trim()
          ? body.category.trim()
          : 'general';
        return NextResponse.json(await processRawContent(text, category));
      }
      default:
        return NextResponse.json({ error: `unknown task: ${body.task}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[llm route]', err);
    return NextResponse.json({ error: 'engine failure' }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ llm: llmAvailable() });
}
