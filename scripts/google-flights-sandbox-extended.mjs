// Read-only reproducibility test; sandbox branch only. No auth, booking, or Supabase access.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const home = process.env.RUNNER_TEMP;
if (!home || process.env.JCS_PRODUCTION_DISPATCH !== "false" ||
    process.env.JCS_SUPABASE_WRITE_ENABLED !== "false") {
  throw new Error("Read-only sandbox environment guard refused execution");
}
const cli = join(home, "api-anything", "dist", "cli.js");
const LIMIT = 40_000;
const assert = (v, m) => { if (!v) throw new Error(m); };
const samples = [
  {from:"MCI", to:"DEN", date:"2026-11-19"},
  {from:"IAH", to:"LAX", date:"2026-12-08"},
  {from:"MCI", to:"LAS", date:"2026-11-03"}
];
const outcomes = [];

function call(op, params, expectReject=false) {
  const argv = [cli, "call", "google-flights", op, ...Object.entries(params).map(([k,v])=>k+"="+v), "--max-tier", "1"];
  const t0=performance.now();
  const proc=spawnSync(process.execPath, argv, {cwd:join(home,"api-anything"),
    encoding:"utf8", timeout:LIMIT, maxBuffer:16_000_000});
  let payload;
  try { payload = JSON.parse(proc.stdout); } catch { payload = null; }
  const ok = proc.status===0 && payload?.ok===true && Array.isArray(payload.data);
  const status = {op, from:params.origin, to:params.destination, date:params.date??null,
    elapsedMs:Math.round(performance.now()-t0), items:payload?.data?.length??null,
    ok, class:payload?.class??null, exitCode:proc.status, expectedReject:expectReject};
  if(expectReject) {
    assert(!ok, "Invalid request unexpectedly accepted: "+JSON.stringify(params));
    assert(proc.status!==0 || payload?.ok===false, "Invalid input did not fail closed");
    console.log("EXPECTED_REJECTION", JSON.stringify(status));
  } else {
    assert(ok && payload.data.length>0,
      "Valid flight call failed: "+JSON.stringify(status)+" stderr="+proc.stderr.slice(0,200));
    console.log("API_RESULT",JSON.stringify(status));
  }
  outcomes.push(status);
  return payload?.data || [];
}
function extractBrowserPage(html) {
  const m=/key:\s*'ds:1',\s*hash:\s*'\d+',\s*data:\s*(\[)/.exec(html);
  assert(m,"Independent browser flight result data absent");
  const start=m.index+m[0].lastIndexOf("[");
  let depth=0, quoted=false, escaped=false, end=-1;
  for(let i=start;i<html.length;i++){
    const c=html[i];
    if(quoted){ if(escaped){escaped=false;continue;} if(c==="\\"){escaped=true;continue;} if(c==='"'){quoted=false;} continue; }
    if(c==='"'){quoted=true;continue;}
    if(c==='[')depth++;
    if(c===']' && --depth===0){end=i;break;}
  }
  assert(end>start,"Browser result data truncated");
  const root=JSON.parse(html.slice(start,end+1));
  const normalize=group=>(group||[]).map(item=>({
    airline:item?.[0]?.[1], price:item?.[1]?.[0]?.[1],
    from:item?.[0]?.[3],to:item?.[0]?.[6],
    departureTime:item?.[0]?.[5],durationMinutes:item?.[0]?.[9]
  }));
  return {top:normalize(root?.[2]?.[0]), search:normalize(root?.[3]?.[0])};
}
function signature(x){ return JSON.stringify([x.airline,x.price,x.from,x.to,x.departureTime,x.durationMinutes]);}
function browserCompare(input, top, search) {
  const browser="google-chrome";
  const target="https://www.google.com/travel/flights?q="+encodeURIComponent(
      "Flights from "+input.from+" to "+input.to+" on "+input.date+" one way")+"&hl=en-US&gl=US&curr=USD";
  const proc=spawnSync(browser,["--headless","--no-sandbox","--disable-gpu","--no-first-run",
      "--user-data-dir="+join(home,"chrome-extra-"+input.from+"-"+input.to+"-"+input.date),
      "--dump-dom",target], {encoding:"utf8",timeout:45_000,maxBuffer:16_000_000});
  assert(proc.status===0 && proc.stdout.includes("Google Flights"),
    "Browser comparator failed for "+JSON.stringify(input)+": "+proc.stderr.slice(0,200));
  const page=extractBrowserPage(proc.stdout);
  let passed=true;
  for(const [name,api] of [["search",search],["top",top]]) {
    const browserItems=page[name].map(signature).sort();
    const apiItems=api.map(signature).sort();
    const same=JSON.stringify(browserItems)===JSON.stringify(apiItems);
    console.log("INDEPENDENT_PARITY",JSON.stringify({from:input.from,to:input.to,date:input.date,
      group:name,apiCount:apiItems.length,browserCount:browserItems.length,exactMatch:same}));
    if(!same)passed=false;
  }
  assert(passed,"Browser and API flight records disagreed for "+JSON.stringify(input));
}
const flightResults=new Map();
for(const s of samples){
  const params={origin:s.from,destination:s.to,date:s.date};
  const search=call("search",params);
  const top=call("top",params);
  flightResults.set(s.from+"-"+s.to+"-"+s.date,[...search,...top]);
  browserCompare(s,top,search);
}
function validateCalendar(from,to,start,end,datesToCheck) {
  const d=call("priceCalendar",{origin:from,destination:to,start,end});
  const parsed=new Map();
  for(const p of d) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(p.date),"Invalid calendar day");
    assert(p.date>=start&&p.date<=end,"Calendar outside requested range");
    assert(!parsed.has(p.date),"Calendar date duplicated");
    if(p.price!==undefined&&p.price!==null)assert(Number.isFinite(p.price)&&p.price>=0,"Calendar price invalid");
    parsed.set(p.date,p.price);
  }
  for(const date of datesToCheck) {
    assert(parsed.has(date),"Calendar missing requested comparison date "+date);
    const flights=flightResults.get(from+"-"+to+"-"+date);
    if(!flights)continue;
    const lowest=Math.min(...flights.map(f=>f.price).filter(x=>typeof x==="number"));
    const calendar=parsed.get(date);
    const exact=(calendar===lowest);
    console.log("CALENDAR_SEARCH_CROSSCHECK",JSON.stringify({from,to,date,calendarPrice:calendar,
      lowestDisplayedFlight:lowest,exactMatch:exact}));
    outcomes.push({calendarCrossCheck:true,from,to,date,exact,calendar,lowest});
  }
  return d.length;
}
validateCalendar("MCI","LAS","2026-11-01","2026-11-30",["2026-11-03","2026-11-12"]);
validateCalendar("IAH","LAX","2026-12-01","2026-12-15",["2026-12-08"]);
validateCalendar("MCI","DEN","2026-11-17","2026-11-21",["2026-11-19"]);
call("search",{origin:"MCI",destination:"LAS",date:"INVALID"},true);
call("priceCalendar",{origin:"NYC",destination:"LAS",start:"2026-11-01",end:"2026-11-15"},true);
console.log("EXPANDED_TEST_SUMMARY",JSON.stringify({
  routes:3,validCalls:9,browserComparisons:6,expectedRejections:2,
  calendarCrossChecks:outcomes.filter(x=>x.calendarCrossCheck).length,
  calendarMatches:outcomes.filter(x=>x.calendarCrossCheck&&x.exact).length,
  allValidCallsPassed:outcomes.filter(x=>!x.expectedReject&&!x.calendarCrossCheck).every(x=>x.ok),
  noSupabaseAccess:true, noBooking:true, noSecrets:true
}));
