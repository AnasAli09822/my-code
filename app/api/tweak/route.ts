import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { planSchema } from '@/lib/dsl';
import { audit, ensureSchema, withClient } from '@/lib/db';
import { simulate } from '@/lib/engine';
import { requireSession } from '@/lib/session';
const schema = z.object({ simulationId: z.string().uuid(), plan: planSchema }).strict();
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    const sessionId = requireSession(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid tweak.' }, { status: 400 });
    const exists = await withClient(async client => {
      await ensureSchema(client);
      const check = await client.query(`SELECT 1 FROM foresee_simulation_runs WHERE id=$1 AND session_id=$2`, [parsed.data.simulationId, sessionId]);
      if (check.rowCount) await audit(client, sessionId, 'ACTION_TWEAKED', { fromSimulationId: parsed.data.simulationId, plan: parsed.data.plan });
      return Boolean(check.rowCount);
    });
    if (!exists) return NextResponse.json({ error: 'Original simulation not found.' }, { status: 404 });
    return NextResponse.json(await simulate(sessionId, parsed.data.plan));
  } catch (error) {
    console.error('tweak failed', error);
    return NextResponse.json({ error: 'Tweak could not be simulated safely.' }, { status: 500 });
  }
}
