import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert.match(html, /data-view="leagues">Leagues/);
assert.match(html, /data-view="addleague">Add New League/);
assert.match(app, /function leagueRatingProfile\(\)/);
assert.match(app, /leagueRatingProfile: leagueRatingProfile\(\)/);
assert.match(app, /Analyze team/);
assert.match(app, /selectWarTeam/);
assert.match(app, /hiddenGems\(teamName\)/);
assert.match(app, /teamNeeds\(teamName\)/);
assert.match(app, /teamPicks\(teamName\)/);
assert.match(app, /capProjection\(teamName, \[\]\)/);
assert.match(app, /No generic roster template is substituted/);
assert.match(app, /var VERSION = "1\.10\.2"/);
assert.match(html, /app\.js\?v=1\.10\.2/);

console.log("multi-league War Room checks passed");
