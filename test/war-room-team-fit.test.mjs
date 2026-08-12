import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

assert.match(app, /function teamNeedProfile\(teamName\)/);
assert.match(app, /function positionDemand\(pos\)/);
assert.match(app, /open roster capacity is not treated as weakness/);
assert.match(app, /starter strength/);
assert.match(app, /usable .* depth/);
assert.doesNotMatch(app.slice(app.indexOf("function teamNeedProfile"), app.indexOf("function median")), /shortage \* 35|depthShortage \* 8/);
assert.match(app, /function optimizePlayers\(players\)/);
assert.match(app, /optimizePlayers\(roster\.concat\(\[candidate\]\)\)/);
assert.match(app, /function freeAgentFit\(p, teamName\)/);
assert.match(app, /lineup\/depth upgrade/);
assert.match(app, /weight: 0\.30/);
assert.match(app, /position need.*weight: 0\.25/);
assert.match(app, /next-year 20% raise/);
assert.match(app, /function scoreEvidence\(p\)/);
assert.match(app, /verified supplemental projection/);
assert.match(app, /result != null && result > 0/);
assert.match(app, /Team fit/);
assert.match(app, /Why this team:/);
assert.match(app, /needProfile: teamNeedProfile\(focusTeam\)/);
assert.match(app, /recommendedFreeAgents: hiddenGems\(focusTeam\)/);
assert.doesNotMatch(app.slice(app.indexOf("function hiddenGems"), app.indexOf("function keyNews")), /teamNeeds\(MY_TEAM\)/);

console.log("War Room team-fit checks passed");
