import { NextRequest, NextResponse } from 'next/server';
import { defaultPlan, failurePlan } from '@/lib/dsl';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { intent?: unknown; scenario?: unknown };
    if (body.scenario === 'failure') return NextResponse.json({ intent: 'Delete the chaos canary customer.', plan: failurePlan(), parser: 'deterministic-fallback' });
    if (typeof body.intent !== 'string' || body.intent.trim().length < 5) return NextResponse.json({ error: 'Enter a concrete destructive intent.' }, { status: 400 });
    const normalized = body.intent.toLowerCase();
    if (!normalized.includes('delete') || !normalized.includes('inactive')) return NextResponse.json({ error: 'This demo only permits the constrained inactive-customer deletion action.' }, { status: 422 });
    return NextResponse.json({ intent: body.intent.trim(), plan: defaultPlan(), parser: 'deterministic-fallback' });
  } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
}
