import { NextRequest, NextResponse } from 'next/server';
import { ensureSchema, resetSession, withClient } from '@/lib/db';
import { requireSession } from '@/lib/session';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    const sessionId = requireSession(request);
    await withClient(async client => { await ensureSchema(client); await resetSession(client, sessionId); });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('reset failed', error);
    return NextResponse.json({ error: 'Could not reset this isolated demo session.' }, { status: 500 });
  }
}
