import { NextRequest, NextResponse } from 'next/server';
import { executionRequestSchema } from '@/lib/dsl';
import { executeSimulation } from '@/lib/engine';
import { requireSession } from '@/lib/session';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    const sessionId = requireSession(request);
    const parsed = executionRequestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid simulation id.' }, { status: 400 });
    const result = await executeSimulation(sessionId, parsed.data.simulationId);
    return NextResponse.json(result, { status: result.status === 'stale' ? 409 : result.status === 'blocked' ? 422 : 200 });
  } catch (error) {
    console.error('execute failed', error);
    return NextResponse.json({ error: 'Execution failed safely. The transaction was not committed.' }, { status: 500 });
  }
}
