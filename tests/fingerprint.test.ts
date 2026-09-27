import { describe, expect, it } from 'vitest';
import { buildFingerprint } from '@/lib/fingerprint';
import { defaultPlan } from '@/lib/dsl';
import type { TargetCustomer } from '@/lib/types';
const row:TargetCustomer={id:'cust-0001',name:'Northstar Systems',email:'a@example.test',status:'active',segment:'Enterprise',last_active_at:'2025-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z',chaos_case:false,active_subscription_count:1,active_mrr:2400,open_ticket_count:0,note_count:2};
describe('state fingerprint',()=>{it('is deterministic',()=>expect(buildFingerprint('00000000-0000-4000-8000-000000000001',defaultPlan(),[row])).toBe(buildFingerprint('00000000-0000-4000-8000-000000000001',defaultPlan(),[row])));it('changes with relevant state',()=>expect(buildFingerprint('00000000-0000-4000-8000-000000000001',defaultPlan(),[row])).not.toBe(buildFingerprint('00000000-0000-4000-8000-000000000001',defaultPlan(),[{...row,active_mrr:0}])))});
