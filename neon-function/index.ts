import { defaultPlan, failurePlan, executionRequestSchema, rollbackRequestSchema, simulateRequestSchema, planSchema } from '../lib/dsl';
import { executeSimulation, getSessionState, rollbackExecution, simulate } from '../lib/engine';
import { audit, ensureSchema, resetSession, withClient } from '../lib/db';
import { z } from 'zod';

const tweakSchema = z.object({ simulationId: z.string().uuid(), plan: planSchema }).strict();
const rejectSchema = z.object({ simulationId: z.string().uuid() }).strict();
const sessionSchema = z.string().uuid();

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
function sessionId(request: Request) {
  const parsed = sessionSchema.safeParse(request.headers.get('x-foresee-session'));
  if (!parsed.success) throw new Error('valid_session_required');
  return parsed.data;
}
async function body(request: Request) { return request.json(); }

async function api(request: Request, path: string) {
  const sid = sessionId(request);
  if (path === '/api/state' && request.method === 'GET') return json(await getSessionState(sid));
  if (path === '/api/action' && request.method === 'POST') {
    const input = await body(request) as { intent?: unknown; scenario?: unknown };
    if (input.scenario === 'failure') return json({ intent: 'Delete the chaos canary customer.', plan: failurePlan(), parser: 'deterministic-fallback' });
    if (typeof input.intent !== 'string' || input.intent.trim().length < 5) return json({ error: 'Enter a concrete destructive intent.' }, 400);
    const normalized = input.intent.toLowerCase();
    if (!normalized.includes('delete') || !normalized.includes('inactive')) return json({ error: 'This demo only permits the constrained inactive-customer deletion action.' }, 422);
    return json({ intent: input.intent.trim(), plan: defaultPlan(), parser: 'deterministic-fallback' });
  }
  if (path === '/api/simulate' && request.method === 'POST') {
    const parsed = simulateRequestSchema.safeParse(await body(request));
    if (!parsed.success) return json({ error: 'Invalid constrained action plan.' }, 400);
    return json(await simulate(sid, parsed.data.plan));
  }
  if (path === '/api/tweak' && request.method === 'POST') {
    const parsed = tweakSchema.safeParse(await body(request));
    if (!parsed.success) return json({ error: 'Invalid tweak.' }, 400);
    const exists = await withClient(async client => {
      await ensureSchema(client);
      const check = await client.query(`SELECT 1 FROM foresee_simulation_runs WHERE id=$1 AND session_id=$2`, [parsed.data.simulationId, sid]);
      if (check.rowCount) await audit(client, sid, 'ACTION_TWEAKED', { fromSimulationId: parsed.data.simulationId, plan: parsed.data.plan });
      return Boolean(check.rowCount);
    });
    if (!exists) return json({ error: 'Original simulation not found.' }, 404);
    return json(await simulate(sid, parsed.data.plan));
  }
  if (path === '/api/execute' && request.method === 'POST') {
    const parsed = executionRequestSchema.safeParse(await body(request));
    if (!parsed.success) return json({ error: 'Invalid simulation id.' }, 400);
    const result = await executeSimulation(sid, parsed.data.simulationId);
    return json(result, result.status === 'stale' ? 409 : result.status === 'blocked' ? 422 : 200);
  }
  if (path === '/api/rollback' && request.method === 'POST') {
    const parsed = rollbackRequestSchema.safeParse(await body(request));
    if (!parsed.success) return json({ error: 'Invalid execution id.' }, 400);
    return json(await rollbackExecution(sid, parsed.data.executionId));
  }
  if (path === '/api/reset' && request.method === 'POST') {
    await withClient(async client => { await ensureSchema(client); await resetSession(client, sid); });
    return json({ ok: true });
  }
  if (path === '/api/reject' && request.method === 'POST') {
    const parsed = rejectSchema.safeParse(await body(request));
    if (!parsed.success) return json({ error: 'Invalid simulation id.' }, 400);
    const ok = await withClient(async client => {
      await ensureSchema(client);
      const check = await client.query(`SELECT 1 FROM foresee_simulation_runs WHERE id=$1 AND session_id=$2`, [parsed.data.simulationId, sid]);
      if (!check.rowCount) return false;
      await audit(client, sid, 'ACTION_REJECTED', { simulationId: parsed.data.simulationId });
      return true;
    });
    return ok ? json({ status: 'rejected' }) : json({ error: 'Simulation not found.' }, 404);
  }
  return json({ error: 'Not found.' }, 404);
}

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Foresee — Simulate Before You Act</title>
<style>
:root{--bg:#090b0d;--p:#111418;--line:#252b32;--t:#f2f4f7;--m:#8f99a6;--g:#65d39d;--r:#ff7b7b;--a:#e9b95d}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input{font:inherit}button{cursor:pointer}button:disabled{opacity:.4;cursor:not-allowed}.shell{width:min(1440px,calc(100% - 34px));margin:auto;padding:24px 0 60px}.top{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:20px}.brand{display:flex;gap:12px;align-items:center}.logo{width:38px;height:38px;border-radius:9px;background:#f2f4f7;color:#080a0c;display:grid;place-items:center;font-weight:900}.brand div:last-child{display:grid;gap:2px}.brand span,.muted{color:var(--m);font-size:12px}.actions{display:flex;gap:9px;align-items:center}.pill{padding:7px 10px;border:1px solid var(--line);border-radius:999px;color:#b9c1ca;font-size:11px}.pill i{display:inline-block;width:7px;height:7px;background:var(--g);border-radius:50%;margin-right:6px}.btn{border:1px solid #343b43;background:#15191e;color:var(--t);border-radius:8px;padding:10px 13px;font-weight:700;font-size:12px}.btn.primary,.btn.approve{background:#eef2f5;color:#090b0d;border-color:#eef2f5}.btn.reject{color:#ffb0b0;background:#1b1114;border-color:#563138}.btn.warn{color:#efd399;background:#19150e;border-color:#504127}.btn.danger{color:#ffb0b0;background:#1b1114;border-color:#563138}.pipe{display:flex;justify-content:center;gap:16px;padding:15px 0;color:#697480;font-size:11px}.pipe b{color:#313840}.panel{background:var(--p);border:1px solid var(--line);border-radius:14px;padding:19px;margin-bottom:16px}.k{font-size:9px;letter-spacing:.14em;color:#71808c;font-weight:900;margin-bottom:7px}.action{display:grid;grid-template-columns:minmax(360px,1.8fr) repeat(3,.55fr) auto;gap:12px;align-items:end}.field{display:grid;gap:7px}.field label,.meta span{font-size:10px;color:var(--m)}input{width:100%;background:#0b0e11;border:1px solid #303740;color:var(--t);border-radius:8px;padding:11px}.meta{display:grid;gap:6px}.meta strong{font-size:11px}.grid2{display:grid;grid-template-columns:1.55fr .85fr;gap:16px}.head{display:flex;justify-content:space-between;gap:12px}.head h2,.panel h2{margin:0;font-size:17px}.risk{font-weight:900;font-size:11px;padding:7px 9px;border-radius:7px}.HIGH{color:#ffb0b0;background:rgba(255,123,123,.1)}.LOW{color:#a9e8c6;background:rgba(101,211,157,.1)}.metrics,.diffs{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-top:17px}.metric,.diff{background:#0d1013;padding:13px}.metric span,.diff span{color:var(--m);font-size:9px;display:block}.metric strong{font-size:17px;display:block;margin-top:4px}.reasons{margin-top:16px;padding-left:14px;border-left:2px solid #414a54}.reasons strong{font-size:11px}.reasons ul{color:var(--m);font-size:11px;line-height:1.55;padding-left:16px}.coverage{height:5px;background:#242a31;border-radius:99px;overflow:hidden;margin:13px 0}.coverage i{display:block;background:#8faaf7;height:100%}.signal{display:flex;gap:8px;padding:9px 0;border-bottom:1px solid #20252a}.signal i{width:7px;height:7px;border-radius:50%;margin-top:4px}.signal b{font-size:10px;display:block}.signal small{color:var(--m);font-size:9px}.diffs{gap:9px;background:transparent;border:0;overflow:visible}.diff{border:1px solid #252c33;border-radius:9px}.diff div{display:flex;gap:7px;align-items:center;margin-top:8px}.diff em{display:block;margin-top:7px;font-size:10px;font-style:normal}.neg{color:#ff9696}.ok{color:#92d4b1}.records{display:grid;grid-template-columns:1.65fr .55fr;gap:16px}.table{overflow:auto;border:1px solid #22282e;border-radius:9px;margin-top:13px}table{width:100%;border-collapse:collapse;min-width:720px}th{font-size:8px;color:#74808c;text-align:left;padding:9px;background:#0c0f12}td{font-size:10px;color:#cbd1d8;padding:9px;border-top:1px solid #1f242a}td small{display:block;color:#65717c}.delete{color:#ff9797;font-weight:900}.restore{list-style:none;padding:0;margin:13px 0}.restore li{display:flex;justify-content:space-between;border-bottom:1px solid #20252a;padding:8px 0;font-size:10px}.restore span{color:var(--m)}.chips{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.chips button{border:1px solid #353e47;background:#0d1013;color:#c8cfd7;border-radius:99px;padding:8px 10px;font-size:10px}.decision{display:flex;justify-content:space-between;align-items:center;position:sticky;bottom:10px;z-index:4;box-shadow:0 18px 55px #0008}.decision .actions{display:flex}.result.auto_rolled_back{border-color:#603840}.result.committed{border-color:#315544}.diverge{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.diverge div{background:#0c0f12;padding:10px;border-radius:7px;border:1px solid #34282b}.diverge span{font-size:8px;color:var(--m);display:block}.diverge b{font-size:10px;color:#ffb4b4}.bottom{display:grid;grid-template-columns:1fr 1fr;gap:16px}.timeline{max-height:260px;overflow:auto}.event{display:flex;justify-content:space-between;border-bottom:1px solid #20252a;padding:8px 0;font-size:9px}.event span{color:var(--m)}.arch{display:flex;align-items:center;gap:6px;overflow:auto;margin-top:13px}.arch span{white-space:nowrap;border:1px solid #303841;background:#0c0f12;border-radius:7px;padding:9px 10px;font-size:9px}.arch b{color:#4b555f}.empty{text-align:center;padding:54px}.empty h1{font-size:26px;margin:5px}.empty p{max-width:740px;margin:10px auto;color:var(--m);font-size:12px;line-height:1.6}.error{padding:11px;border:1px solid #58343b;background:#1a1114;color:#ffc0c0;border-radius:8px;margin-bottom:13px;font-size:11px}.hidden{display:none!important}footer{display:flex;justify-content:space-between;color:#727d88;font-size:10px;padding:7px 1px}@media(max-width:1050px){.action{grid-template-columns:1fr 1fr}.field{grid-column:1/-1}.grid2,.records,.bottom{grid-template-columns:1fr}.metrics,.diffs{grid-template-columns:1fr 1fr}}@media(max-width:650px){.shell{width:calc(100% - 18px)}.pill{display:none}.pipe{justify-content:flex-start;overflow:auto}.action{grid-template-columns:1fr}.metrics,.diffs{grid-template-columns:1fr 1fr}.decision{position:static;display:block}.decision .actions{margin-top:12px}.diverge{grid-template-columns:1fr}}
</style></head><body><main class="shell">
<header class="top"><div class="brand"><div class="logo">F</div><div><strong>Foresee</strong><span>See the consequences before your agent acts.</span></div></div><div class="actions"><span class="pill"><i></i>Live Neon / PostgreSQL</span><button class="btn" id="reset">Reset Demo</button></div></header>
<div class="pipe"><span>1 Intent</span><b>→</b><span>2 Simulate</span><b>→</b><span>3 Review</span><b>→</b><span>4 Execute</span><b>→</b><span>5 Verify</span></div>
<div id="error" class="error hidden"></div>
<section class="panel"><div class="k">REQUESTED ACTION</div><div class="action"><div class="field"><label>Agent intent</label><input id="intent" value="Delete customers who have been inactive for more than 12 months."></div><div class="meta"><span>Target</span><strong>Neon / PostgreSQL</strong></div><div class="meta"><span>Write class</span><strong>Destructive DELETE</strong></div><div class="meta"><span>Status</span><strong id="status">Not simulated</strong></div><button class="btn primary" id="simulate">Simulate before acting</button></div></section>
<div id="empty" class="panel empty"><div class="k">REAL DATABASE AS WORLD MODEL</div><h1>Execute the mutation without committing it.</h1><p>Foresee runs the candidate DELETE against real database state inside an isolated transaction, measures the projected state transition, and rolls it back before a human grants authority.</p></div>
<div id="review" class="hidden">
<div class="grid2"><section class="panel"><div class="head"><div><div class="k">SIMULATION RESULT</div><h2 id="title"></h2></div><span id="risk" class="risk"></span></div><div id="metrics" class="metrics"></div><div class="reasons"><strong id="why"></strong><ul id="reasons"></ul></div></section><section class="panel"><div class="k">UNCERTAINTY</div><h2>Coverage, not fake certainty</h2><div class="coverage"><i id="coverage"></i></div><div id="signals"></div></section></div>
<section class="panel"><div class="head"><div><div class="k">BEFORE → AFTER</div><h2>Projected state transition</h2></div><span class="pill">sandbox transaction rolled back</span></div><div id="diffs" class="diffs"></div></section>
<div class="records"><section class="panel"><div class="head"><div><div class="k">AFFECTED RECORDS</div><h2>Real rows in the blast radius</h2></div><span id="rowcount" class="muted"></span></div><div class="table"><table><thead><tr><th>Customer</th><th>Segment</th><th>Last active</th><th>Subscription</th><th>MRR</th><th>Decision</th></tr></thead><tbody id="rows"></tbody></table></div></section><aside class="panel"><div class="k">ROLLBACK PLAN</div><h2>Restore bundle</h2><ul id="restore" class="restore"></ul><p class="muted">Known rows are serialized before destructive execution and restored in dependency order.</p></aside></div>
<section class="panel"><div class="k">TWEAK</div><h2>Change the decision, then re-simulate</h2><div class="chips"><button id="excludeSubs">Exclude active subscriptions</button><button id="excludeEnt">Exclude Enterprise accounts</button><button id="threshold">Require 540 days inactivity</button><button id="limit">Limit to 10 records</button></div></section>
<section class="panel decision"><div><div class="k">HUMAN DECISION</div><strong id="decisionText"></strong></div><div class="actions"><button class="btn reject" id="reject">Reject</button><button class="btn warn" id="tweak">Tweak</button><button class="btn approve" id="approve">Approve exact plan</button></div></section></div>
<section id="result" class="panel result hidden"></section>
<div class="bottom"><section class="panel"><div class="head"><div><div class="k">AUDIT TRAIL</div><h2>Every authority transition is recorded</h2></div><button class="btn" id="refresh">Refresh</button></div><div id="timeline" class="timeline"></div></section><section class="panel"><div class="k">FAILURE TEST</div><h2>The world model is allowed to be wrong safely.</h2><p class="muted">A hidden PostgreSQL trigger mutates <code>account_summary</code>. Simulation intentionally excludes that dependency; the broader runtime verifier catches the divergence before commit.</p><button class="btn danger" id="failure">Run deterministic failure test</button></section></div>
<section class="panel"><div class="k">ARCHITECTURE SNAPSHOT</div><h2>Intent → simulation → authority → verification → recovery</h2><div class="arch"><span>User / Agent</span><b>→</b><span>Validated DSL</span><b>→</b><span>Real DB Simulation</span><b>→</b><span>Human Review</span><b>→</b><span>Fingerprint Gateway</span><b>→</b><span>Runtime Verifier</span><b>→</b><span>Commit / Rollback</span></div></section>
<footer><strong>Foresee</strong><span>Simulation predicts. Runtime verification makes prediction safe.</span></footer></main>
<script>
const S={sid:localStorage.getItem('foresee-session')||crypto.randomUUID(),report:null,mode:'golden',execution:null};localStorage.setItem('foresee-session',S.sid);
const $=id=>document.getElementById(id), money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(Number(n||0));
async function call(path,opt={}){const r=await fetch(path,{...opt,headers:{'content-type':'application/json','x-foresee-session':S.sid,...(opt.headers||{})}});const d=await r.json();if(!r.ok)throw new Error(d.error||d.message||'Request failed');return d}
function busy(v){['simulate','reset','failure','approve','reject','excludeSubs','excludeEnt','threshold','limit','tweak'].forEach(id=>{const e=$(id);if(e)e.disabled=v})}
function err(e){$('error').textContent=e?.message||String(e);$('error').classList.remove('hidden')}
function clearErr(){$('error').classList.add('hidden')}
function metric(label,value){return '<div class="metric"><span>'+label+'</span><strong>'+value+'</strong></div>'}
function diff(label,b,a,d){const neg=String(d).startsWith('-');return '<div class="diff"><span>'+label+'</span><div><strong>'+b+'</strong><b>→</b><strong>'+a+'</strong></div><em class="'+(neg?'neg':'ok')+'">'+d+'</em></div>'}
function render(){const r=S.report;if(!r)return;$('empty').classList.add('hidden');$('review').classList.remove('hidden');$('title').textContent=S.mode==='failure'?'Hidden-side-effect test':'Delete customers inactive > '+r.plan.filters.inactive_days+' days';$('risk').textContent=r.risk;$('risk').className='risk '+r.risk;$('status').textContent=r.risk+' risk';$('metrics').innerHTML=metric('Confidence',r.confidence+'%')+metric('Customers',r.impact.customersDeleted)+metric('MRR at risk',money(r.impact.mrrAtRisk))+metric('Open tickets',r.impact.openTicketsAffected);$('why').textContent=r.risk==='HIGH'?'Why this is unsafe':'Why this is inside policy';$('reasons').innerHTML=r.riskReasons.map(x=>'<li>'+x+'</li>').join('');$('coverage').style.width=r.confidence+'%';$('signals').innerHTML=r.confidenceSignals.map(x=>'<div class="signal"><i style="background:'+(x.covered?'var(--g)':'var(--a)')+'"></i><div><b>'+x.label+'</b><small>'+x.detail+'</small></div></div>').join('');const d={c:r.projected.customers-r.before.customers,e:r.projected.enterpriseCustomers-r.before.enterpriseCustomers,s:r.projected.activeSubscriptions-r.before.activeSubscriptions,m:r.projected.mrr-r.before.mrr};$('diffs').innerHTML=diff('Customers',r.before.customers,r.projected.customers,(d.c>0?'+':'')+d.c)+diff('Enterprise customers',r.before.enterpriseCustomers,r.projected.enterpriseCustomers,(d.e>0?'+':'')+d.e)+diff('Active subscriptions',r.before.activeSubscriptions,r.projected.activeSubscriptions,(d.s>0?'+':'')+d.s)+diff('MRR',money(r.before.mrr),money(r.projected.mrr),money(d.m));$('rowcount').textContent=r.targets.length+' rows';$('rows').innerHTML=r.targets.slice(0,20).map(x=>'<tr><td><strong>'+x.name+'</strong><small>'+x.id+'</small></td><td>'+x.segment+'</td><td>'+new Date(x.last_active_at).toLocaleDateString()+'</td><td>'+(x.active_subscription_count?x.active_subscription_count+' active':'None')+'</td><td>'+money(x.active_mrr)+'</td><td class="delete">DELETE</td></tr>').join('');$('restore').innerHTML=[['Customer records',r.rollbackPlan.customers],['Subscriptions',r.rollbackPlan.subscriptions],['Tickets',r.rollbackPlan.tickets],['Notes',r.rollbackPlan.notes],['Restore operations',r.rollbackPlan.estimatedRestoreOperations]].map(x=>'<li><span>'+x[0]+'</span><strong>'+x[1]+'</strong></li>').join('');$('decisionText').textContent=r.policy.allowed?'Plan is inside the approved impact envelope.':'Policy requires a safer simulation before execution.';$('approve').disabled=!r.policy.allowed;$('excludeSubs').disabled=!!r.plan.filters.exclude_active_subscriptions||S.mode==='failure';$('excludeEnt').disabled=!!r.plan.filters.exclude_enterprise||S.mode==='failure';$('threshold').disabled=r.plan.filters.inactive_days===540||S.mode==='failure';$('limit').disabled=r.plan.filters.limit===10||S.mode==='failure';$('tweak').disabled=S.mode==='failure'}
async function refresh(){try{const s=await call('/api/state');$('timeline').innerHTML=s.audit.length?s.audit.map(x=>'<div class="event"><strong>'+x.event_type+'</strong><span>'+new Date(x.created_at).toLocaleTimeString()+'</span></div>').join(''):'<p class="muted">No events yet.</p>'}catch(e){err(e)}}
async function simulate(failure=false){busy(true);clearErr();try{S.mode=failure?'failure':'golden';S.execution=null;$('result').classList.add('hidden');const a=await call('/api/action',{method:'POST',body:JSON.stringify(failure?{scenario:'failure'}:{intent:$('intent').value})});S.report=await call('/api/simulate',{method:'POST',body:JSON.stringify({plan:a.plan})});render();await refresh()}catch(e){err(e)}finally{busy(false);render()}}
async function tweak(kind){if(!S.report)return;const p=structuredClone(S.report.plan);if(kind==='subs')p.filters.exclude_active_subscriptions=true;if(kind==='enterprise')p.filters.exclude_enterprise=true;if(kind==='threshold')p.filters.inactive_days=540;if(kind==='limit')p.filters.limit=10;busy(true);clearErr();try{S.report=await call('/api/tweak',{method:'POST',body:JSON.stringify({simulationId:S.report.id,plan:p})});render();await refresh()}catch(e){err(e)}finally{busy(false);render()}}
async function approve(){if(!S.report)return;busy(true);clearErr();try{const x=await call('/api/execute',{method:'POST',body:JSON.stringify({simulationId:S.report.id})});S.execution=x;const el=$('result');el.className='panel result '+x.status;el.classList.remove('hidden');if(x.status==='committed')el.innerHTML='<div class="k">RUNTIME VERIFICATION</div><h2>EXECUTION COMMITTED</h2><p class="muted">Observed reality matched the approved simulation and impact envelope.</p><button class="btn" id="rollbackNow">Rollback Execution</button>';else if(x.status==='auto_rolled_back')el.innerHTML='<div class="k">RUNTIME VERIFICATION</div><h2>EXECUTION BLOCKED</h2><p class="muted">Simulation divergence detected. Transaction rolled back automatically before commit.</p><div class="diverge"><div><span>Unexpected side effect</span><b>'+x.unexpected.join(', ')+'</b></div><div><span>Safety response</span><b>'+x.safetyResponse+'</b></div><div><span>Persistent state</span><b>'+x.finalPersistentState+'</b></div></div>';else el.innerHTML='<h2>RE-SIMULATION REQUIRED</h2><p>'+x.message+'</p>';const rb=$('rollbackNow');if(rb)rb.onclick=rollback;await refresh()}catch(e){err(e)}finally{busy(false);render()}}
async function rollback(){if(!S.execution?.executionId)return;busy(true);try{await call('/api/rollback',{method:'POST',body:JSON.stringify({executionId:S.execution.executionId})});$('result').innerHTML='<div class="k">RECOVERY</div><h2>ROLLBACK COMPLETE</h2><p class="muted">Deleted rows and known dependencies were restored.</p>';await refresh()}catch(e){err(e)}finally{busy(false);render()}}
$('simulate').onclick=()=>simulate(false);$('failure').onclick=()=>simulate(true);$('excludeSubs').onclick=()=>tweak('subs');$('tweak').onclick=()=>tweak('subs');$('excludeEnt').onclick=()=>tweak('enterprise');$('threshold').onclick=()=>tweak('threshold');$('limit').onclick=()=>tweak('limit');$('approve').onclick=approve;$('reject').onclick=async()=>{if(!S.report)return;busy(true);try{await call('/api/reject',{method:'POST',body:JSON.stringify({simulationId:S.report.id})});$('result').className='panel result';$('result').innerHTML='<h2>NO WRITE EXECUTED</h2><p class="muted">Action rejected by human reviewer.</p>';await refresh()}catch(e){err(e)}finally{busy(false);render()}};$('reset').onclick=async()=>{busy(true);clearErr();try{await call('/api/reset',{method:'POST',body:'{}'});S.report=null;S.execution=null;S.mode='golden';$('review').classList.add('hidden');$('result').classList.add('hidden');$('empty').classList.remove('hidden');$('status').textContent='Not simulated';await refresh()}catch(e){err(e)}finally{busy(false)}};$('refresh').onclick=refresh;refresh();
</script></body></html>`;

export default {
  async fetch(request: Request) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      if (request.method === 'GET' && path === '/') return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
      if (path.startsWith('/api/')) return await api(request, path);
      if (request.method === 'GET' && path === '/health') return json({ ok: true, service: 'foresee', database: 'neon-postgresql' });
      return new Response('Not found', { status: 404 });
    } catch (error) {
      console.error('foresee function error', error);
      return json({ error: 'Request failed safely. No unverified write was committed.' }, 500);
    }
  }
};
