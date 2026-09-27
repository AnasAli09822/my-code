import { NextRequest, NextResponse } from 'next/server';
import { simulateRequestSchema } from '@/lib/dsl';
import { simulate } from '@/lib/engine';
import { requireSession } from '@/lib/session';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    const sessionId = requireSession(request);
    const parsed = simulateRequestSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid constrained action plan.', issues: parsed.error.issues }, { status: 400 });
    return NextResponse.json(await simulate(sessionId, parsed.data.plan));
  } catch (error) {
    console.error('simulate failed', error);
    return NextResponse.json({ error: 'Simulation failed safely. No business data was committed.' }, { status: 500 });
  }
}
