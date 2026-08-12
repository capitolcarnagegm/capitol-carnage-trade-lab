import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const appPath = new URL('../app.js', import.meta.url);
const enginePath = new URL('../src/engine.js', import.meta.url);
const publicAppPath = new URL('../public/app.js', import.meta.url);
const indexPath = new URL('../index.html', import.meta.url);

test('cap accounting excludes IR salary but keeps cut-player dead cap', async () => {
  const app = await readFile(appPath, 'utf8');
  assert.match(app, /function ir\(p\)/);
  assert.match(app, /function capSalary\(p\) \{ return ir\(p\) \? 0/);
  assert.match(app, /rosterSalary = players\.reduce\(function \(sum, p\) \{ return sum \+ capSalary\(p\); \}, 0\)/);
  assert.match(app, /currentUsed: rosterSalary \+ currentDead/);
  assert.match(app, /currentRoom: cap - rosterSalary - currentDead/);
  assert.match(app, /Existing cut-player dead cap of/);
});

test('trade analysis treats cap as legality and explains dynasty roster impact', async () => {
  const app = await readFile(appPath, 'utf8');
  assert.match(app, /postTradeRoom = cap\.currentRoom - capChange/);
  assert.match(app, /Best legal lineup:/);
  assert.match(app, /usable depth/);
  assert.match(app, /Average player age:/);
  assert.match(app, /Average contract control:/);
  assert.match(app, /Competitive window:/);
  assert.match(app, /Cap space is a legality constraint, not a reason by itself to make the trade/);
  assert.match(app, /Illegal under current cap/);
});

test('cut simulator applies the five-season Pride bylaw schedule', async () => {
  const app = await readFile(appPath, 'utf8');
  assert.match(app, /fiveYearCutOutcome/);
  assert.match(app, /\[0, 1, 2, 3, 4\]/);
  assert.match(app, /BYLAWS\.dead\[remaining\]/);
  assert.match(app, /irRoomRemaining/);
  assert.match(app, /Math\.min\(salary, irRoomRemaining\)/);
  assert.match(app, /There is no cut penalty in the third season or later/);
  assert.match(app, /Five-season combined projection/);
});

test('every team cap is recalculated from Pride rules and team-specific charges', async () => {
  const app = await readFile(appPath, 'utf8');
  assert.match(app, /prideCapForYear/);
  assert.match(app, /rosterSalary = players\.reduce\(function \(sum, p\) \{ return sum \+ capSalary\(p\); \}, 0\)/);
  assert.match(app, /currentDead = penalties/);
  assert.match(app, /League-wide cap audit/);
  assert.doesNotMatch(app, /team && team\.salaryCap != null \? team\.salaryCap/);
});

test('Pride finance rules persist and roll on March 1', async () => {
  const [engine, publicApp, index] = await Promise.all([
    readFile(enginePath, 'utf8'),
    readFile(publicAppPath, 'utf8'),
    readFile(indexPath, 'utf8'),
  ]);
  assert.match(engine, /PRIDE_CAP_ANCHOR = 1403\.90/);
  assert.match(engine, /PRIDE_CAP_ANCHOR_YEAR = 2026/);
  assert.match(engine, /PRIDE_CAP_ANNUAL_INCREASE = 0\.05/);
  assert.match(engine, /PRIDE_CONTRACT_ANNUAL_INCREASE = 0\.20/);
  assert.match(engine, /marchOnePassed/);
  assert.match(engine, /financialProjection\(team,5\)/);
  assert.match(publicApp, /gms_active_workspace_v1/);
  assert.match(publicApp, /localStorage\.setItem\(ACTIVE_WORKSPACE_KEY,state\.workspace\.id\)/);
  assert.match(publicApp, /The 2026 cap is \$1,403\.90/);
  assert.match(index, /public\/app\.js\?v=1\.11\.4/);

  const cap = year => Math.round(1403.90 * (1.05 ** Math.max(0, year - 2026)) * 100) / 100;
  assert.equal(cap(2026), 1403.90);
  assert.equal(cap(2027), 1474.10);
  assert.equal(cap(2028), 1547.81);
  assert.equal(Math.round(100 * (1.20 ** 4) * 100) / 100, 207.36);
});
