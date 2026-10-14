// Run with Playwright available: node platform/tools/faculty-roster-layout-check.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const pub = path.resolve(__dirname, '../public');
const html = fs.readFileSync(path.join(pub, 'faculty.html'), 'utf8');
const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'))
  .replace(/\(async \(\) => \{[\s\S]*?\}\)\(\);\s*$/, '');
(async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {});
  try {
    const page = await browser.newPage();
    await page.setContent(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, ''));
    await page.addStyleTag({path:path.join(pub, 'app.css')});
    await page.addScriptTag({path:path.join(pub, 'sim-identity.js')});
    await page.addScriptTag({content:js + `
      F.me={role:'faculty',name:'Test Faculty'};
      F.data={courses:[],catalogue:[]}; F.view='course';
      F.course={course:{id:'c1',title:'Course',join_code:'ABC123'},sims:[],catalogue:[],enrolUrl:'https://example.com/join?c=ABC123',
        roster:[0,1,2].map(i=>({enrolment_id:'e'+i,student_id:'s'+i,
          name:'Student'+ 'LongName'.repeat(12),email:'long'.repeat(30)+'@example.com',
          paid_note:'Note'.repeat(70),paid:i===1,dropped:i===2,created_at:'2026-10-01',started:123,finished:100}))};
      render();
    `});
    for (const width of [1920,1440,1280,1101,1100,1024,821,820,768,390,320]) {
      await page.setViewportSize({width,height:1000});
      const result = await page.locator('.faculty-roster').evaluate(panel => {
        const wrap=panel.querySelector('.tablewrap');
        const bounds=wrap.getBoundingClientRect();
        const elements=[...panel.querySelectorAll('tbody td,tbody button,tbody input,.nm,.sub,.faculty-run-activity')];
        return {overflow:wrap.scrollWidth-wrap.clientWidth,
          clipped:elements.filter(el=>{const b=el.getBoundingClientRect();return b.left<bounds.left-1||b.right>bounds.right+1||el.scrollWidth>el.clientWidth+1;}).map(el=>el.outerHTML),
          buttons:[...panel.querySelectorAll('tbody button')].map(el=>el.textContent.trim()),
          checks:panel.querySelectorAll('input[type=checkbox]').length};
      });
      assert.ok(result.overflow<=1,`${width}: roster overflows`);
      assert.deepEqual(result.clipped,[],`${width}: clipped contents`);
      assert.deepEqual(result.buttons,['Results','Give access','Remove','Results','Take access','Remove','Results','Put back']);
      assert.equal(result.checks,2);
      console.log(`PASS roster details and actions fit at ${width}px`);
    }
    await page.locator('[data-en="e0"]').check();
    assert.equal(await page.locator('[data-en="e0"]').isChecked(),true);
    await page.evaluate(()=>{F.course.roster=[];render();});
    assert.match(await page.locator('.faculty-roster').innerText(),/Nobody has joined yet/);
    console.log('PASS selection and empty roster');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
