import { NextRequest, NextResponse } from 'next/server';
import { rollbackRequestSchema } from '@/lib/dsl';
import { rollbackExecution } from '@/lib/engine';
import { requireSession } from '@/lib/session';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    const sessionId = requireSession(request);
    const parsed = rollbackRequestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid execution id.' }, { status: 400 });
    return NextResponse.json(await rollbackExecution(sessionId, parsed.data.executionId));
  } catch (error) {
    console.error('rollback failed', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Rollback failed safely.' }, { status: 400 });
  }
}
