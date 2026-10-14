// Historical floor-3 fixtures intentionally preserve the authored narrative/buyer regressions.
const assert = require('assert');
const S = require('../lib/scenario.js');
const { buildClosingLesson } = require('../lib/closingLesson.js');
const valid=x=>{const v=S.validateAllocation(x, S.LEGACY_THRESHOLDS);assert.equal(v.ok,true,JSON.stringify(v));return v.allocation;};
const noRoomA=valid({run:3,uptime:3,capacity:0,connect:3,features:0});
const noRoomB=valid({run:3,uptime:0,capacity:0,connect:3,features:3});
const noRoomOutcomes=S.evaluateAll(noRoomA,noRoomB);
const noRoom=buildClosingLesson(noRoomA,noRoomB,noRoomOutcomes,S.DEFAULT_THRESHOLDS);
assert.equal(noRoom.title,'What this RapidSim teaches');assert.equal(noRoom.teaches.length,4);assert.ok(noRoom.voices.length>=3);
assert.ok(noRoom.yourRun.some(x=>x.includes('$6M in Connect')));
assert.ok(noRoom.yourRun.some(x=>x.includes('$0M in Capacity')));
assert.ok(noRoom.yourRun.some(x=>x.includes('Closest counterfactual:')));
assert.ok(noRoom.yourRun.some(x=>x.includes('Corven showed strong interest')));
const strongA=valid({run:3,uptime:1,capacity:1,connect:3,features:1});
const strongB=valid({run:3,uptime:2,capacity:1,connect:2,features:1});
const strongOutcomes=S.evaluateAll(strongA,strongB);
const strong=buildClosingLesson(strongA,strongB,strongOutcomes,S.DEFAULT_THRESHOLDS);
assert.equal(strongOutcomes.year3.band,'strong');assert.ok(strong.yourRun.some(x=>x.includes('worked together')));assert.notDeepEqual(strong.yourRun,noRoom.yourRun);
const weakA=valid({run:4,uptime:2,capacity:1,connect:1,features:1});
const weakB=valid({run:4,uptime:2,capacity:1,connect:1,features:1});
const weakOutcomes=S.evaluateAll(weakA,weakB);
const weak=buildClosingLesson(weakA,weakB,weakOutcomes,S.DEFAULT_THRESHOLDS);
assert.equal(weakOutcomes.year3.band,'weak');assert.ok(weak.yourRun.some(x=>x.includes('too little usable field history')));
const overspendA=valid({run:3,uptime:3,capacity:3,connect:0,features:0});
const overspendB=valid({run:3,uptime:3,capacity:3,connect:0,features:0});
const overspend=buildClosingLesson(overspendA,overspendB,S.evaluateAll(overspendA,overspendB),S.DEFAULT_THRESHOLDS);
assert.ok(overspend.yourRun.some(x=>x.includes('Renata')&&x.includes('Sam')&&x.includes('$6M')&&x.includes('$0M')));
const floorA=S.validateAllocation({run:4,uptime:1,capacity:1,connect:2,features:1}).allocation;
const floorB=S.validateAllocation({run:4,uptime:2,capacity:1,connect:2,features:0}).allocation;
const atFloor=buildClosingLesson(floorA,floorB,S.evaluateAll(floorA,floorB),S.DEFAULT_THRESHOLDS);
assert.equal(atFloor.yourRun.join(' ').includes('above the two-year minimum'),false,'Run at the floor must not be called heavy');
for(const lesson of [noRoom,strong,weak,overspend]){
  const all=[...lesson.paragraphs,...lesson.yourRun,lesson.carryOut].join(' ');
  assert.equal((all.match(/Closest counterfactual:/g)||[]).length,1);
  for(const forbidden of ['Score:','Grade:','Rank:'])assert.equal(all.includes(forbidden),false);
}
assert.deepEqual(buildClosingLesson(noRoomA,noRoomB,noRoomOutcomes,S.DEFAULT_THRESHOLDS),buildClosingLesson(noRoomA,noRoomB,noRoomOutcomes,S.DEFAULT_THRESHOLDS));
console.log('RapidSim 03 dynamic closing lesson checks passed.');
