// Sync endpoint. Holds the shared graph and resolves incoming writes with the
// same LWW rule the client uses, so both sides converge on the same state.
//
// ponytail: the store is a JSON file on the server's disk. Correct for one
// instance, which is what a single-user memory engine needs; swap the two
// read/write helpers for Vercel Blob or Postgres if it ever runs multi-region.
import { timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { NextResponse } from 'next/server';
import { mergeByLWW } from '@/lib/sync';
import type { GraphNode } from '@/lib/types';

const STORE = join(process.cwd(), '.data', 'sync.json');

/**
 * This endpoint reads and overwrites the entire graph, so it fails closed: with
 * no SYNC_SECRET configured, sync is off rather than open to anyone who finds
 * the URL. The secret is never shipped to the browser — the learner types the
 * passphrase once and it is kept in their own IndexedDB.
 */
function authorize(req: Request): NextResponse | null {
  const secret = process.env.SYNC_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'sync is disabled: set SYNC_SECRET on the server to enable it' },
      { status: 503 },
    );
  }

  const given = Buffer.from(req.headers.get('x-sync-key') ?? '');
  const expected = Buffer.from(secret);
  // timingSafeEqual throws on a length mismatch, so check that first.
  const ok = given.length === expected.length && timingSafeEqual(given, expected);
  return ok ? null : NextResponse.json({ error: 'invalid sync key' }, { status: 401 });
}

async function read(): Promise<GraphNode[]> {
  try {
    return JSON.parse(await readFile(STORE, 'utf8')) as GraphNode[];
  } catch {
    return []; // no store yet
  }
}

// ponytail: single in-process lock. Enough for one user on one instance;
// needs a real transaction if this ever serves concurrent writers.
let writing: Promise<void> = Promise.resolve();

async function write(nodes: GraphNode[]): Promise<void> {
  const next = writing.then(async () => {
    await mkdir(dirname(STORE), { recursive: true });
    await writeFile(STORE, JSON.stringify(nodes), 'utf8');
  });
  writing = next.catch(() => undefined);
  return next;
}

export async function GET(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;

  const nodes = await read();
  return NextResponse.json({ nodes, syncedAt: Date.now() });
}

export async function POST(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;

  let body: { nodes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.nodes)) {
    return NextResponse.json({ error: 'nodes[] is required' }, { status: 400 });
  }

  const incoming = body.nodes as GraphNode[];
  const { merged, conflicts } = mergeByLWW(await read(), incoming);
  await write(merged);

  // Return the whole merged graph: the pushing device may be behind on
  // concepts another device reviewed while it was offline.
  return NextResponse.json({ nodes: merged, conflicts, syncedAt: Date.now() });
}
