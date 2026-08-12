import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync(new URL("../cloudflare-worker.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("league refresh keeps core rosters when optional Fantrax feeds fail", () => {
  assert.match(worker, /const rosters = await fantrax\("getTeamRosters", leagueId\)/);
  assert.match(worker, /async function optional\(label, request, fallback\)/);
  assert.match(worker, /partial: warnings\.length > 0, warnings/);
  assert.doesNotMatch(worker, /const \[rosters, players, standings, picks, matchups, leagueInfo\] = await Promise\.all/);
});

test("team detail requests are throttled and partial status is visible", () => {
  assert.match(worker, /index \+= 3/);
  assert.match(app, /Core rosters refreshed/);
  assert.match(app, /Partial refresh:/);
  assert.match(app, /VERSION = "1\.11\.1"/);
  assert.match(html, /app\.js\?v=1\.11\.1/);
});
