import assert from "node:assert/strict";
import test from "node:test";
import { GMSAnalysisEngine } from "../src/engine.js";

function player(id, position, weeklyProjection, extra = {}) {
  return { id, name: "Player " + id, position, weeklyProjection, ...extra };
}

test("recommendFreeAgents gives the SAME free agent a different verdict for a needy team vs. a stacked, capped-out team", () => {
  const engine = new GMSAnalysisEngine({ now: new Date("2026-08-15"), capOverride: 1000 });
  const freeAgentWR = player("fa-wr", "WR", 16, { age: 26 });

  const needyTeam = {
    id: "needy", name: "Needy Team", deadCap: 0, picks: [],
    players: [player("qb1", "QB", 20), player("rb1", "RB", 15)]
  };
  const stackedTeam = {
    id: "stacked", name: "Stacked Team", deadCap: 500, picks: [],
    players: [
      player("wr1", "WR", 22, { salary: 130 }), player("wr2", "WR", 19, { salary: 120 }),
      player("wr3", "WR", 17, { salary: 110 }), player("wr4", "WR", 12, { salary: 90 }),
      player("qb1", "QB", 20, { salary: 60 }), player("rb1", "RB", 15, { salary: 60 })
    ]
  };

  const needyResult = engine.recommendFreeAgents(needyTeam, [freeAgentWR], 10, { leagueTeams: [needyTeam] })
    .find((r) => r.player.id === "fa-wr");
  const stackedResult = engine.recommendFreeAgents(stackedTeam, [freeAgentWR], 10, { leagueTeams: [stackedTeam] })
    .find((r) => r.player.id === "fa-wr");

  assert.ok(needyResult, "needy team should evaluate the free agent");
  assert.ok(stackedResult, "stacked team should evaluate the free agent");
  assert.ok(needyResult.needScore >= 34, `needy team's need score should clear the PICK UP bar, got ${needyResult.needScore}`);
  assert.equal(needyResult.verdict, "PICK UP");
  assert.ok(stackedResult.needScore < needyResult.needScore, "a team already stacked at the position must score lower need than a team missing starters");
  assert.notEqual(stackedResult.verdict, "PICK UP");
  assert.ok(stackedResult.fit < needyResult.fit, "the same free agent must not score identically for two very different rosters");
});

test("weeklyLogLooksReal rejects a flat/non-varying response and accepts a genuinely varying one", () => {
  const flat = [1, 2, 3, 4].map((week) => ({ week, players: { p1: { id: "p1", fpts: 10 }, p2: { id: "p2", fpts: 8 } } }));
  assert.equal(GMSAnalysisEngine.weeklyLogLooksReal(flat), false);

  const varying = [
    { week: 1, players: { p1: { id: "p1", fpts: 10 }, p2: { id: "p2", fpts: 5 }, p3: { id: "p3", fpts: 12 }, p4: { id: "p4", fpts: 3 } } },
    { week: 2, players: { p1: { id: "p1", fpts: 22 }, p2: { id: "p2", fpts: 4 }, p3: { id: "p3", fpts: 9 }, p4: { id: "p4", fpts: 14 } } },
    { week: 3, players: { p1: { id: "p1", fpts: 6 }, p2: { id: "p2", fpts: 18 }, p3: { id: "p3", fpts: 11 }, p4: { id: "p4", fpts: 2 } } },
    { week: 4, players: { p1: { id: "p1", fpts: 15 }, p2: { id: "p2", fpts: 7 }, p3: { id: "p3", fpts: 10 }, p4: { id: "p4", fpts: 20 } } }
  ];
  assert.equal(GMSAnalysisEngine.weeklyLogLooksReal(varying), true);
});

test("computeVolatilityMap labels a steady scorer 'consistent' and a wild swinger 'boom/bust'", () => {
  const weeklyLog = [
    { week: 1, players: { steady: { id: "steady", fpts: 12 }, wild: { id: "wild", fpts: 30 } } },
    { week: 2, players: { steady: { id: "steady", fpts: 13 }, wild: { id: "wild", fpts: 2 } } },
    { week: 3, players: { steady: { id: "steady", fpts: 11 }, wild: { id: "wild", fpts: 28 } } },
    { week: 4, players: { steady: { id: "steady", fpts: 12 }, wild: { id: "wild", fpts: 3 } } }
  ];
  const map = GMSAnalysisEngine.computeVolatilityMap(weeklyLog);
  assert.equal(map.steady.label, "consistent");
  assert.equal(map.wild.label, "boom/bust");
  assert.equal(map.steady.weeksObserved, 4);
});
