import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const appPath = new URL('../app.js', import.meta.url);

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
