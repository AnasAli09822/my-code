import { NextRequest, NextResponse } from 'next/server';
import { getSessionState } from '@/lib/engine';
import { requireSession } from '@/lib/session';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try { return NextResponse.json(await getSessionState(requireSession(request))); }
  catch (error) {
    console.error('state failed', error);
    return NextResponse.json({ error: 'Database state is unavailable.' }, { status: 500 });
  }
}
