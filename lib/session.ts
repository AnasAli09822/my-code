import { NextRequest } from 'next/server';
import { z } from 'zod';

const sessionSchema = z.string().uuid();

export function requireSession(request: NextRequest): string {
  const raw = request.headers.get('x-foresee-session');
  const parsed = sessionSchema.safeParse(raw);
  if (!parsed.success) throw new Error('A valid x-foresee-session UUID is required.');
  return parsed.data;
}
