const {app}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'face-membership-'));
process.env.FACE_UX20_TEST='1';app.setPath('userData',profile);app.setPath('cache',path.join(profile,'cache'));
let used=false;
app.on('browser-window-created',(_,win)=>{if(used)return;used=true;
 win.webContents.once('did-finish-load',async()=>{
 const js=async s=>{try{return await win.webContents.executeJavaScript(`(async()=>{try{${s}}catch(e){throw String(e.stack||e)}})()`,true);}catch(e){console.error("FAILED JS",s,String(e));throw e;}};
 const wait=async expr=>{for(let n=0;n<100;n++){if(await js(`return ${expr}`))return;await new Promise(r=>setTimeout(r,80));}throw Error('Timeout '+expr);};
 try{
 await wait("typeof Store!=='undefined'&&Store.db&&document.querySelector('#growth-home-open')");
 await js("document.querySelector('#growth-home-open').click()");
 assert.equal(await js('return App.currentView'),'membership');
 assert.equal(await js("return document.querySelector('#growth-start')!==null"),true);
 await js("document.querySelector('#growth-start').click()");
 assert.equal(await js('return Membership.state().started'),await js('return todayKey()'));
 assert.equal(await js("return document.querySelectorAll('[data-growth-done]:disabled').length"),6);
 await js("document.querySelector('[data-growth-done]').click();document.querySelector('#growth-pricing').open=true;document.querySelector('[data-growth-interest=monthly]').click()");
 assert.equal(await js('return Membership.state().done[0]'),true);assert.equal(await js("return Drafts.fields(document.querySelector('#view-root')).filter(x=>x.matches('[data-growth-done]')).length"),0);
 assert.equal(await js('return Membership.state().interest'),'monthly');
 assert.equal(await js('return Store.dayTraining(todayKey()).seconds'),0,'manual check never creates training');
 await js("document.querySelector('#growth-clear-interest').click()");assert.equal(await js('return Membership.state().interest'),undefined);
 fs.writeFileSync(path.join(profile,'inject-save-failure'),'1');
 await js("document.querySelector('[data-growth-interest=yearly]').click()");assert.equal(await js('return Membership.state().interest'),undefined,'failed write rolled back');
 fs.rmSync(path.join(profile,'inject-save-failure'));
 await js("document.querySelector('[data-growth-interest=monthly]').click();Store.db.logs.training[todayKey()]={seconds:180,entries:[]};Store.save(true);App.render();document.querySelector('#growth-copy').click()");
 assert.match(await js("return document.querySelector('.growth-report-text').value"),/3 分钟/);
 await js("document.querySelector('#growth-copy-close').click();Store.flushSync()");
 win.webContents.reload();await wait("typeof Store!=='undefined'&&Store.db&&document.querySelector('#growth-home-open')");
 assert.equal(await js('return Membership.state().interest'),'monthly');assert.equal(await js('return Membership.state().done[0]'),true);
 await js("App.go('membership')");
 for(const [w,h] of [[1240,820],[980,640]]){win.setSize(w,h);await new Promise(r=>setTimeout(r,150));assert.equal(await js('return document.documentElement.scrollWidth<=innerWidth'),true,'no horizontal overflow');}
 await js("Store.db.settings.growthPlan.started=addDays(todayKey(),-7);App.render()");assert.equal(await js("return document.querySelectorAll('[data-growth-done]:disabled').length"),0);
 await js("document.querySelector('#growth-target').value='5';document.querySelector('#growth-target').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#growth-goal-form').requestSubmit()");
 assert.equal(await js('return Membership.state().targetDays'),5);
 await js("document.querySelector('#growth-prev').click();document.querySelector('#growth-copy').click()");
 assert.doesNotMatch(await js("return document.querySelector('.growth-report-text').value"),/含今天/);
 await js("document.querySelector('#growth-copy-close').click();document.querySelector('#growth-current').click();document.querySelector('#growth-restart').click()");
 assert.equal(await js('return Membership.state().history.length'),1);
 assert.equal(await js('return Membership.state().history[0].done[0]'),true);
 assert.equal(await js('return Membership.state().interest'),'monthly');
 assert.equal(await js('return Membership.state().targetDays'),5);
 assert.equal(await js('return Object.keys(Membership.state().done).length'),0);
 await js("document.querySelector('[data-growth-action]').click()");assert.equal(await js("return document.querySelector('#ch-videos')!==null"),true);await js('closeModal()');
 await js("Membership.act(3)");assert.equal(await js("return document.querySelector('#rh-sleep-form')!==null"),true);await js('closeModal()');
 await js("document.querySelector('#growth-pricing').open=true");
 for(const dark of [false,true]){await js('document.documentElement.classList.toggle("dark",'+dark+')');for(const [w,h] of [[1240,820],[980,640]]){win.setSize(w,h);await new Promise(r=>setTimeout(r,180));assert.equal(await js('return document.documentElement.scrollWidth<=innerWidth'),true);const dir=path.resolve('.impeccable/review/growth-refine');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,(dark?'dark':'light')+'-'+w+'.png'),(await win.webContents.capturePage()).toPNG());}}
 await js("document.querySelector('#growth-report').scrollIntoView({block:'start'})");await new Promise(r=>setTimeout(r,300));fs.writeFileSync(path.resolve('.impeccable/review/growth-refine/report-dark.png'),(await win.webContents.capturePage()).toPNG());
 await js("document.querySelector('#growth-free').click()");assert.equal(await js('return App.currentView'),'today');
 console.log('MEMBERSHIP_UI_PASS: start, unlock, persistence/reload, failure rollback, no fake training, preferences/clear, report preview, expired plan, free exit, two window sizes');
 app.quit();
 }catch(e){console.error(String(e.stack||e));fs.rmSync(profile,{recursive:true,force:true});app.exit(1);}
 });
});
app.on('will-quit',()=>fs.rmSync(profile,{recursive:true,force:true}));
require('../main');
