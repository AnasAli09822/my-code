import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { audit, ensureSchema, withClient } from '@/lib/db';
import { requireSession } from '@/lib/session';
const schema = z.object({ simulationId: z.string().uuid() }).strict();
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: NextRequest) {
  try {
    const sessionId = requireSession(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid simulation id.' }, { status: 400 });
    const ok = await withClient(async client => {
      await ensureSchema(client);
      const check = await client.query(`SELECT 1 FROM foresee_simulation_runs WHERE id=$1 AND session_id=$2`, [parsed.data.simulationId, sessionId]);
      if (!check.rowCount) return false;
      await audit(client, sessionId, 'ACTION_REJECTED', { simulationId: parsed.data.simulationId });
      return true;
    });
    if (!ok) return NextResponse.json({ error: 'Simulation not found.' }, { status: 404 });
    return NextResponse.json({ status: 'rejected' });
  } catch (error) {
    console.error('reject failed', error);
    return NextResponse.json({ error: 'Reject could not be recorded.' }, { status: 500 });
  }
}
