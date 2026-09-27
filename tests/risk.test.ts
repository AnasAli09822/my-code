import { describe, expect, it } from 'vitest';
import { calculateRisk } from '@/lib/risk';
const base={impact:{customersDeleted:17,activeSubscriptionsAffected:0,mrrAtRisk:0,enterpriseCustomersAffected:0,openTicketsAffected:4,notesAffected:35},rollbackPlan:{customers:17,subscriptions:0,tickets:4,notes:35,estimatedRestoreOperations:56}};
describe('risk engine',()=>{it('marks protected revenue HIGH',()=>{const r=calculateRisk({...base,impact:{...base.impact,activeSubscriptionsAffected:1,mrrAtRisk:2400,enterpriseCustomersAffected:1},rollbackPlan:{customers:18,subscriptions:1,tickets:4,notes:37,estimatedRestoreOperations:60}});expect(r.level).toBe('HIGH');expect(r.reasons.join(' ')).toContain('MRR')});it('marks tweaked path LOW',()=>expect(calculateRisk(base).level).toBe('LOW'))});
