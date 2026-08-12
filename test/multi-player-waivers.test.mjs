import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");

assert.match(app, /selectedWaiverIds: \[\]/);
assert.match(app, /Multi-Player Waiver Analyzer/);
assert.match(app, /toggleWaiverPlayer/);
assert.match(app, /analyzeWaiverPlayers/);
assert.match(app, /Owners most likely to bid/);
assert.match(app, /function bidLikelihood\(interest\)/);
assert.match(app, /available cap/);
assert.match(app, /positional needs/);
assert.match(app, /Recommended max bid/);
assert.match(app, /row\.room/);
assert.match(app, /row\.need/);
assert.match(app, /row\.estimatedBid/);

console.log("multi-player waiver checks passed");
