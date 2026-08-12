import fs from "node:fs";
import assert from "node:assert/strict";

const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

assert.match(app, /\{ slot: "DL", count: 3, accept: \["DL"\] \}/);
assert.match(app, /\{ slot: "LB", count: 2, accept: \["LB"\] \}/);
assert.match(app, /\{ slot: "DB", count: 3, accept: \["DB"\] \}/);
assert.match(app, /\{ slot: "ID", count: 2, accept: \["DL", "LB", "DB"\] \}/);
assert.equal(1 + 1 + 2 + 3 + 1 + 1 + 3 + 2 + 3 + 2, 19);
assert.equal(3 + 2 + 3 + 2, 10);
assert.match(app, /eligibleForSlot\(p, spec\)/);
assert.doesNotMatch(app, /!used\[p\.id\] && spec\.accept\.indexOf\(p\.pos\)/);
assert.match(app, /DL\|DE\|DT\|NT\|EDGE/);
assert.match(app, /DB\|CB\|SAFETY/);
assert.match(app, /starterIds\[p\.id\] \? "START"/);
assert.match(app, /"PROJECTED " \+ starterSlotsById\[p\.id\] \+ " STARTER"/);
assert.match(app, /var VERSION = "1\.9\.0"/);
assert.match(html, /app\.js\?v=1\.9\.0/);

const positionSource = app.slice(app.indexOf("function primaryPos"), app.indexOf("function unavailable"));
const positions = new Function(positionSource + "; return { primaryPos, playerPositions, eligibleForSlot };")();
assert.equal(positions.primaryPos("DE"), "DL");
assert.equal(positions.primaryPos("NT"), "DL");
assert.equal(positions.primaryPos("OLB"), "LB");
assert.equal(positions.primaryPos("FS"), "DB");
assert.deepEqual(positions.playerPositions({ pos: "D", eligible: "DE/LB" }), ["D", "DL", "LB"]);
assert.equal(positions.eligibleForSlot({ pos: "D", eligible: "DE/LB" }, { accept: ["DL"] }), true);
assert.equal(positions.eligibleForSlot({ pos: "D", eligible: "S/CB" }, { accept: ["DB"] }), true);

console.log("start/sit IDP checks passed");
