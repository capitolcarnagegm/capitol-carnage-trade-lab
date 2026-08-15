import assert from "node:assert/strict";
import test from "node:test";
import { GMSAnalysisEngine } from "../src/engine.js";

function player(id, position, weeklyProjection, extra = {}) {
  return { id, name: "Player " + id, position, weeklyProjection, ...extra };
}

test("optimalLineup fills all 19 Pride slots (Superflex + 10 IDP) when enough players exist", () => {
  const engine = new GMSAnalysisEngine({ now: new Date("2026-08-15") });
  const players = [
    player("qb1", "QB", 22), player("qb2", "QB", 18),
    player("rb1", "RB", 20), player("rb2", "RB", 17), player("rb3", "RB", 12),
    player("wr1", "WR", 19), player("wr2", "WR", 16), player("wr3", "WR", 14), player("wr4", "WR", 10),
    player("te1", "TE", 13),
    player("dl1", "DL", 11), player("dl2", "DL", 10), player("dl3", "DL", 9), player("dl4", "DL", 6),
    player("lb1", "LB", 12), player("lb2", "LB", 11), player("lb3", "LB", 5),
    player("db1", "DB", 10), player("db2", "DB", 9), player("db3", "DB", 8), player("db4", "DB", 4), player("db5", "DB", 3)
  ];
  const opt = engine.optimalLineup(players);
  assert.equal(opt.lineup.length, 19);
  assert.equal(opt.filled, 19);
  assert.equal(opt.open, 0);
});

test("lineupReport gives every starter a slot+reason and every bench player a real reason", () => {
  const engine = new GMSAnalysisEngine({ now: new Date("2026-08-15") });
  const team = {
    id: "t1", name: "Capitol Carnage",
    players: [
      player("qb1", "QB", 24),
      player("qb2", "QB", 15),
      player("rb1", "RB", 20),
      player("rb2", "RB", 9),
      player("hurt1", "WR", 25, { status: "OUT" }),
      player("noproj", "TE", null)
    ]
  };
  const report = engine.lineupReport(team);
  const starterIds = report.starters.filter((r) => r.player).map((r) => r.player.id);
  assert.ok(starterIds.includes("qb1"));
  report.starters.forEach((row) => assert.ok(row.reason && row.reason.length > 0));

  const benchById = Object.fromEntries(report.bench.map((row) => [row.player.id, row]));
  assert.match(benchById["hurt1"].reason, /OUT|unavailable/i);
  assert.match(benchById["noproj"].reason, /projection|PPG/i);
});
