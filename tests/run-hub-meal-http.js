// Real Electron + loopback HTTP + renderer persistence, isolated from formal data.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-meal-http-'));
let child;
let output = '';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function request(port, method, endpoint, body, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname:'127.0.0.1',port,path:endpoint,method,
      timeout:3000,headers:{'Content-Type':'application/json',
        ...(token ? {'x-life-meal-token':token} : {})}}, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', data => raw += data);
      res.on('end', () => {
        try { resolve({status:res.statusCode,body:JSON.parse(raw)}); }
        catch (error) { reject(error); }
      });
    });
    req.once('error', reject);
    req.once('timeout', () => req.destroy(new Error('HTTP timeout')));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function start(port) {
  child = spawn(require('electron'), [path.join(root, 'main.js')], {
    env:{...process.env,FACE_RESHAPE_PROFILE:profile,FACE_HUB_PORT:String(port)},
    stdio:['ignore','pipe','pipe']
  });
  child.stdout.on('data', chunk => output += String(chunk));
  child.stderr.on('data', chunk => output += String(chunk));
  const deadline = Date.now() + 18000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Electron exited before health check: ' + output.slice(-1000));
    try {
      const response = await request(port,'GET','/hub/health');
      if (response.status === 200 && response.body.ok) return;
    } catch { /* server still starting */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('isolated Electron health timeout: ' + output.slice(-1000));
}

async function stop() {
  if (!child || child.exitCode !== null) return;
  const running = child;
  running.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => running.once('exit', resolve)),
    new Promise((_,reject) => setTimeout(() => reject(new Error('Electron did not exit on SIGTERM')),8000))
  ]);
  child = undefined;
}

async function waitForReady(port, token, meal) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const reply = await request(port,'POST','/hub/meal',meal,token);
    if (reply.status === 200) return reply;
    if (reply.status !== 503) throw new Error(JSON.stringify(reply));
    await new Promise(resolve => setTimeout(resolve,150));
  }
  throw new Error('renderer did not become ready');
}

async function main() {
  const port = await freePort();
  const date = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'})
    .format(new Date(Date.now()-86400000));
  const meal = {sourceKey:'e'.repeat(64),revision:1,local:`${date}T12:20`,
    at:`${date}T12:20:00+08:00`,timeKind:'started',state:'active',foodText:'鸡蛋和米饭',photoCount:1};
  await start(port);
  const tokenPath = path.join(profile,'hub-meal-token');
  const token = fs.readFileSync(tokenPath,'ascii').trim();
  if(process.platform!=='win32')assert.equal(fs.statSync(tokenPath).mode & 0o777,0o600);
  assert.equal((await request(port,'POST','/hub/meal',meal,'f'.repeat(64))).status,403);
  assert.equal((await waitForReady(port,token,meal)).status,200);
  const dataPath = path.join(profile,'face-reshape-data.json');
  assert.equal(JSON.parse(fs.readFileSync(dataPath)).rhythm.meals.filter(m=>m.sourceKey===meal.sourceKey).length,1);
  await stop();
  await start(port);
  const replay = await waitForReady(port,token,meal);
  assert.equal(replay.body.alreadyDone,true);
  assert.equal(JSON.parse(fs.readFileSync(dataPath)).rhythm.meals.filter(m=>m.sourceKey===meal.sourceKey).length,1);
  const cancelled = {...meal,revision:2,state:'cancelled'};
  assert.equal((await request(port,'POST','/hub/meal',cancelled,token)).status,200);
  assert.equal(JSON.parse(fs.readFileSync(dataPath)).rhythm.meals.filter(m=>m.sourceKey===meal.sourceKey).length,0);
  const stale = await request(port,'POST','/hub/meal',meal,token);
  assert.equal(stale.body.stale,true);
  console.log('PASS isolated HTTP meal: unauthorized 403 → saved 1 → restart replay 1 → cancelled 0 → stale blocked; formal profile untouched');
}

main().catch(error => { console.error(error); process.exitCode=1; })
  .finally(async () => {
    try { await stop(); } catch (error) { console.error(error); process.exitCode=1; }
    if (!child || child.exitCode !== null) fs.rmSync(profile,{recursive:true,force:true});
  });
