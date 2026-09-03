#!/usr/bin/env node
/* Real REST concurrency test. It creates an isolated share and prints its code
 * so CI/cleanup can remove it afterwards. No production calendar is touched. */
const URL='https://llxmsbnqtdlqypnwapzz.supabase.co';
const KEY=process.env.SUPABASE_ANON_KEY||'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxseG1zYm5xdGRscXlwbndhcHp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc4MjA5MjEsImV4cCI6MjA1MzM5NjkyMX0.EkqepILQU0KgOTW1ZaXpe54ERpZbSRodf24r5022VKs';
const clients=Number(process.env.LOAD_CLIENTS||25),perClient=Number(process.env.LOAD_EVENTS||8);
const crypto=require('crypto'),latencies=[];
// A void-returning function (calendar_share_purge_load_test) comes back with
// an empty body, and r.json() throws "Unexpected end of JSON input" on that —
// read as text first and only parse when there's actually something there.
const rpc=async(fn,body)=>{const t=Date.now(),r=await fetch(`${URL}/rest/v1/rpc/${fn}`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});latencies.push(Date.now()-t);if(!r.ok)throw Error(`${fn} ${r.status} ${await r.text()}`);const text=await r.text();return text?JSON.parse(text):null};
const identity=i=>({id:crypto.randomBytes(16).toString('hex'),secret:crypto.randomBytes(32).toString('hex'),name:`Load ${i}`,emoji:'🧪',color:'#007AFF',updatedAt:new Date().toISOString()});
const percentile=p=>latencies.sort((a,b)=>a-b)[Math.min(latencies.length-1,Math.floor(latencies.length*p))];
(async()=>{const code=await rpc('calendar_share_create',{p_name:`Load ${Date.now()}`,p_color:'#007AFF',p_emoji:'🧪'});console.log(`LOAD_TEST_CODE=${code}`);
try{
const people=Array.from({length:clients},(_,i)=>identity(i));await Promise.all(people.map(m=>rpc('calendar_share_pull',{p_code:code,p_since:'-infinity',p_member:m})));
await Promise.all(people.map(async(m,i)=>{const events=Array.from({length:perClient},(_,j)=>({id:`load-${i}-${j}-${Date.now()}`,title:`C${i} E${j}`,startDate:'2035-01-01',endDate:'2035-01-01',allDay:true,startTime:null,endTime:null,memo:null,creatorId:m.id,updatedAt:new Date().toISOString(),deleted:false}));await rpc('calendar_share_push',{p_code:code,p_calendar:null,p_events:events,p_member:m});await rpc('calendar_share_event_action',{p_code:code,p_event_id:events[0].id,p_member_id:m.id,p_secret:m.secret,p_action:'comment',p_payload:{body:`hello from ${i}`}})}));
const result=await rpc('calendar_share_pull',{p_code:code,p_since:'-infinity',p_member:people[0]});const expected=clients*perClient;if(result.events.length!==expected)throw Error(`lost events: ${result.events.length}/${expected}`);if(result.members.length!==clients)throw Error(`lost members: ${result.members.length}/${clients}`);console.log(JSON.stringify({clients,events:result.events.length,members:result.members.length,requests:latencies.length,latencyMs:{p50:percentile(.5),p95:percentile(.95),max:Math.max(...latencies)}}));
}finally{
// calendar_share_purge_load_test only accepts rows named 'Load %' (see
// 20260827_shared_calendar_management.sql) — every prior run of this script
// left its share permanently in the shared prod project because nothing
// ever removed it. Runs in `finally` so a failed assertion above still
// cleans up instead of leaking another row.
await rpc('calendar_share_purge_load_test',{p_code:code}).catch(e=>console.error('cleanup failed, remove manually:',code,e));
}
})().catch(e=>{console.error(e);process.exit(1)});
