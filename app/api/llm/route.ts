// Single server entry point for every LLM-backed engine call. Keeps
// ANTHROPIC_API_KEY off the client; grows one case per phase.
import { NextResponse } from 'next/server';
import { MAX_INGEST_CHARS } from '@/lib/chunker';
import { processRawContent } from '@/lib/ingestion';
import { initialState } from '@/lib/interrogation_graph';
import { llmAvailable } from '@/lib/llm';
import { evaluateUnderstanding, processUserExplanation } from '@/lib/tutor';
import type { GraphNode } from '@/lib/types';

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
        if (text.length > MAX_INGEST_CHARS) {
          return NextResponse.json(
            {
              error: `material is ${text.length.toLocaleString()} characters; the limit is ${MAX_INGEST_CHARS.toLocaleString()}. Ingest it a section at a time — smaller batches also produce better-connected concepts.`,
            },
            { status: 413 },
          );
        }
        const category = typeof body.category === 'string' && body.category.trim()
          ? body.category.trim()
          : 'general';
        return NextResponse.json(await processRawContent(text, category));
      }
      case 'socratic': {
        const concept = body.concept as GraphNode | undefined;
        const input = typeof body.input === 'string' ? body.input : '';
        if (!concept?.id || !input.trim()) {
          return NextResponse.json({ error: 'concept and input are required' }, { status: 400 });
        }
        const state = (body.state as Parameters<typeof processUserExplanation>[2]) ?? initialState();
        const history = Array.isArray(body.history)
          ? (body.history as { role: 'tutor' | 'learner'; text: string }[])
          : [];
        return NextResponse.json(await processUserExplanation(input, concept, state, history));
      }
      case 'assess': {
        const concept = body.concept as GraphNode | undefined;
        const input = typeof body.input === 'string' ? body.input : '';
        if (!concept?.id || !input.trim()) {
          return NextResponse.json({ error: 'concept and input are required' }, { status: 400 });
        }
        const state = (body.state as Parameters<typeof evaluateUnderstanding>[2]) ?? initialState();
        return NextResponse.json(await evaluateUnderstanding(input, concept, state));
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
