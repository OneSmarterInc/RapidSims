'use strict';

// Student-specific closing interpretation. It only explains outcomes already
// resolved by the scenario engine; it does not add thresholds, scores or bands.
const ORDER = ['run', 'uptime', 'capacity', 'connect', 'features'];
const LABELS = { run:'Run', uptime:'Uptime', capacity:'Capacity', connect:'Connect', features:'Features' };
const PEOPLE = { run:'Dale', uptime:'Renata', connect:'Sam', features:'Tom' };

function amount(v){ const n=Number(v); return Number.isFinite(n)?n:0; }
function cumulative(y1,y2){ const out={}; for(const k of ORDER) out[k]=amount(y1&&y1[k])+amount(y2&&y2[k]); return out; }
function largestLine(c){ let key=ORDER[0]; for(const k of ORDER.slice(1)) if(c[k]>c[key]) key=k; return {key,label:LABELS[key],amount:c[key]}; }
function dollars(n){ return `$${Math.max(0,Number(n)||0)}M`; }

function year3Sentence(c,band){
  if(band==='strong') return `By Year 3, your $${c.connect}M in Connect and $${c.capacity}M in Capacity worked together: Midland had both field history and room to turn predictive service into something it could actually sell.`;
  if(band==='data_no_room') return `By Year 3, your $${c.connect}M in Connect had created the field history, but $${c.capacity}M in Capacity left too little room to run the model reliably at scale.`;
  if(band==='pilot') return `By Year 3, your $${c.connect}M in Connect and $${c.capacity}M in Capacity got Midland to a promising pilot, but not yet to a predictive-service business.`;
  if(band==='weak') return `By Year 3, your $${c.connect}M in Connect had built too little usable field history for prediction to become a real capability.`;
  return '';
}
function heatSentence(c,band){
  if(band==='strong') return `Your $${c.uptime}M in Uptime meant dispatch held when the heat wave tested it.`;
  if(band==='middle') return `Your $${c.uptime}M in Uptime kept the heat wave from becoming a full breakdown, but the service operation still fell back to manual work.`;
  if(band==='weak') return `Your $${c.uptime}M in Uptime left the service operation exposed when the heat wave arrived.`;
  return '';
}
function competitorSentence(c,band){
  if(band==='strong') return `The same $${c.connect}M Connect investment let Midland answer the competitor from a position of strength.`;
  if(band==='middle') return `The same $${c.connect}M Connect investment got Midland only as far as a limited pilot against the competitor.`;
  if(band==='weak') return `The same $${c.connect}M Connect investment was not enough to answer the competitor quickly.`;
  return '';
}
function buyerSentence(buyers){
  const ridge=buyers&&buyers.ridge_hollow&&buyers.ridge_hollow.interest;
  const corven=buyers&&buyers.corven&&buyers.corven.interest;
  if(!ridge||!corven)return '';
  if(ridge===corven)return `Ridge Hollow and Corven both showed ${({high:'strong',qualified:'some',low:'low'})[ridge]||ridge} interest, but for different reasons: Ridge Hollow was asking Dale’s question about the spending base while Corven was asking Sam’s question about the connected-data asset.`;
  return `Ridge Hollow showed ${({high:'strong',qualified:'some',low:'low'})[ridge]||ridge} interest while Corven showed ${({high:'strong',qualified:'some',low:'low'})[corven]||corven} interest. Ridge Hollow was asking Dale’s question about the cost base; Corven was asking Sam’s question about the connected-data asset. The budget was the same for both; what each buyer valued was different.`;
}

function primaryNearMiss(c,y3,heat,competitor,t){
  if(!t)return '';
  const ys=Number(t.year3ConnectStrong), cap=Number(t.year3CapacityStrong), yp=Number(t.year3ConnectPilotMin), hs=Number(t.heatUptimeStrong), hm=Number(t.heatUptimeMiddle), cs=Number(t.competitorConnectStrong), cp=Number(t.competitorConnectPilotMin);
  if(![ys,cap,yp,hs,hm,cs,cp].every(Number.isFinite))return '';
  if(y3==='data_no_room') return `${dollars(cap-c.capacity)} more in Capacity would have turned the working demo into a capability Midland could run at scale.`;
  if(y3==='weak') return `${dollars(Math.max(0,yp-c.connect))} more in Connect would have reached the Year 3 pilot.`;
  if(y3==='pilot') return `${dollars(Math.max(0,ys-c.connect))} more in Connect would have moved Midland out of the pilot; with Capacity at ${dollars(c.capacity)}, the next outcome would have been ${c.capacity>=cap?'the full predictive-service capability':'data without room to run it'}.`;
  if(competitor==='weak') return `${dollars(Math.max(0,cp-c.connect))} more in Connect would have given Midland a credible competitor pilot.`;
  if(competitor==='middle') return `${dollars(Math.max(0,cs-c.connect))} more in Connect would have let Midland match the competitor outright.`;
  if(heat==='weak') return `${dollars(Math.max(0,hm-c.uptime))} more in Uptime would have avoided the four-day dispatch outage.`;
  if(heat==='middle') return `${dollars(Math.max(0,hs-c.uptime))} more in Uptime would have kept dispatch fully online.`;
  const candidates=[
    {n:c.capacity-cap+1,text:`${dollars(c.capacity-cap+1)} less in Capacity would have left the same field history without enough room to run reliably.`},
    {n:c.connect-cs+1,text:`${dollars(c.connect-cs+1)} less in Connect would have reduced Midland’s competitor response to a pilot.`},
    {n:c.uptime-hs+1,text:`${dollars(c.uptime-hs+1)} less in Uptime would have pushed the heat wave into the degraded-dispatch outcome.`}
  ].filter(x=>Number.isFinite(x.n)&&x.n>0).sort((a,b)=>a.n-b.n);
  return candidates[0]?.text||'';
}

function tradeSentence(c,t){
  if(!t)return '';
  const hs=Number(t.heatUptimeStrong), cp=Number(t.competitorConnectPilotMin), ys=Number(t.year3ConnectStrong), cap=Number(t.year3CapacityStrong);
  if(Number.isFinite(hs)&&Number.isFinite(cp)&&c.uptime>=2*hs&&c.connect<cp){
    return `Renata’s Uptime line received $${c.uptime}M — at least twice the level that held dispatch in the heat wave — while Sam’s Connect line received $${c.connect}M. The extra resilience came with less field visibility.`;
  }
  if(Number.isFinite(ys)&&Number.isFinite(cap)&&c.connect>=ys&&c.capacity<cap){
    return `Sam’s Connect line received $${c.connect}M while Capacity received $${c.capacity}M. Midland bought the field history and not enough room to use it at scale.`;
  }
  if(c.features>=4&&c.connect<=2){
    return `Tom’s Features line received $${c.features}M while Sam’s Connect line received $${c.connect}M. Midland bought more that people could point at and less of the field visibility needed to respond later.`;
  }
  const runFloor2=2*Number(t.runFloor ?? 4);
  if(Number.isFinite(runFloor2)&&c.run>runFloor2){
    return `Dale’s Run line received $${c.run}M, which is $${c.run-runFloor2}M above the two-year minimum of $${runFloor2}M. That extra money kept today’s systems comfortable, and the capabilities that paid off in later years had that much less to work with.`;
  }
  const FOUR=['uptime','capacity','connect','features'];
  const hi=FOUR.reduce((a,k)=>c[k]>c[a]?k:a,FOUR[0]);
  const lo=FOUR.reduce((a,k)=>c[k]<c[a]?k:a,FOUR[0]);
  if(c[hi]-c[lo]>=3){
    const hip=PEOPLE[hi]?`${PEOPLE[hi]}’s ${LABELS[hi]} line`:`${LABELS[hi]}`;
    const lop=PEOPLE[lo]?`${PEOPLE[lo]}’s ${LABELS[lo]} line`:`${LABELS[lo]}, the line only you spoke for,`;
    return `${hip} received $${c[hi]}M while ${lop} received $${c[lo]}M. That gap shows which of the four arguments your budget favoured.`;
  }
  return 'Your two-year budget stayed balanced across the four lines. That kept several options open and gave each argument a share of the money.';
}

function voiceLines(c,y3,heat,competitor,t){
  const floor2=2*Number((t&&t.runFloor)??4);
  const dale=c.run<=floor2
    ? 'You held Run at the minimum both years and freed money for the rest of the company.'
    : `You kept $${c.run-floor2}M more in Run than the minimum. The current systems were safe, and that money went to keeping them that way.`;
  const renata={strong:'Dispatch held through the heat wave. My technicians kept moving.',
    middle:'Dispatch went down for six hours on the worst day. We got through it on paper.',
    weak:'Dispatch was down for four days in the hottest week. That is the week my customers remember.'}[heat]||'';
  const tom={strong:'I took a real service to the board, one customers can buy.',
    pilot:'I showed the board a pilot. Next year it needs to become a business.',
    data_no_room:'I had three years of data and a demo that ran some mornings.',
    weak:'I went to the board with little to show customers.'}[y3]||'';
  const sam=c.connect>=5?'The machines finally have somewhere to send what they know.'
    : c.connect>=3?'We can hear part of the fleet now. The rest is still a drive away.'
    : 'My technicians are still driving out to ask the machines what is wrong.';
  return [{name:'Dale Brenner',role:'Chief Financial Officer',line:dale},{name:'Renata Oyelaran',role:'VP, Service',line:renata},
    {name:'Tom Vasquez',role:'Chief Executive',line:tom},{name:'Sam Achterberg',role:'Field technician',line:sam}].filter(v=>v.line);
}
function largestNonRun(c){ let key='uptime'; for(const k of ['capacity','connect','features']) if(c[k]>c[key]) key=k; return {key,label:LABELS[key],amount:c[key]}; }
function buildClosingLesson(y1,y2,outcomes,thresholds){
  const c=cumulative(y1,y2), top=largestNonRun(c);
  const y3=outcomes&&outcomes.year3&&outcomes.year3.band;
  const heat=outcomes&&outcomes.year2&&outcomes.year2.heat&&outcomes.year2.heat.band;
  const competitor=outcomes&&outcomes.year2&&outcomes.year2.competitor&&outcomes.year2.competitor.band;
  const buyers=outcomes&&outcomes.buyers;
  const near=primaryNearMiss(c,y3,heat,competitor,thresholds);
  const trade=tradeSentence(c,thresholds);
  const yourRun=[
    [year3Sentence(c,y3), near?`Closest counterfactual: ${near}`:''].filter(Boolean).join(' '),
    [`Outside Run, your largest two-year commitment was ${top.label} at $${top.amount}M.`,trade].filter(Boolean).join(' '),
    [heatSentence(c,heat),competitorSentence(c,competitor)].filter(Boolean).join(' '),
    buyerSentence(buyers)
  ].filter(Boolean);
  return {
    title:'What this RapidSim teaches',
    teaches:[
      {head:'Technology spending takes time to pay off.',text:'What you fund this year decides what the company can do two or three years from now.'},
      {head:'Some capabilities take years to build.',text:`The $${Number((thresholds&&thresholds.perLineCap)??3)}M yearly limit on each line stands for that time. Money arriving later buys less of it.`},
      {head:'Each executive is right about one part of the company.',text:'The technology leader’s job is to fund the whole company.'},
      {head:'The quietest line can matter most.',text:'Capacity had only you to speak for it, and in Year 3 it decided whether the data could become a service.'}
    ],
    paragraphs:[
      'You made two years of choices before you knew which tests would come. Good technology planning works that way: you decide which capabilities Midland will already have when the future arrives.',
      'Every million you put into one line was a million that went to no other line. Dale was right that Run uses money without producing something new. Renata was right that her technicians were stretched. Tom was right that the board needed something real. Sam was right that the machines already knew more than Midland could hear. Your job was to see the whole company while each of them defended one part of it.',
      'Features gave Midland something visible, and in this sim it mattered to one buyer: Ridge Hollow read Run and Features together as cost. Tom’s board win came from Connect.',
      'The three buyers showed that value depends on who is looking. Your budget decided how many of them found something worth buying.'
    ],
    yourRun,
    voices:voiceLines(c,y3,heat,competitor,thresholds),
    carryOut:'Your budget decided what Midland was ready for when the future arrived.'
  };
}
module.exports={buildClosingLesson};
