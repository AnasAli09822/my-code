import { describe, expect, it } from 'vitest';
import { defaultPlan, planSchema } from '@/lib/dsl';
describe('constrained action DSL',()=>{it('accepts golden path',()=>expect(planSchema.parse(defaultPlan()).action).toBe('delete_customers'));it('rejects arbitrary action names',()=>expect(()=>planSchema.parse({action:'raw_sql',filters:{}})).toThrow());it('rejects unsafe unbounded limits',()=>expect(()=>planSchema.parse({...defaultPlan(),filters:{...defaultPlan().filters,limit:5000}})).toThrow())});
