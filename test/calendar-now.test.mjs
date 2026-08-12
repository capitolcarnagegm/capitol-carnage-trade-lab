import assert from "node:assert/strict";
import test from "node:test";
import { PRIDE_CALENDAR_2026, currentCalendarStatus } from "../public/pride-calendar-2026.js";

test("calendar milestones match the supplied 2026 Pride workbook", () => {
  const byTitle = new Map(PRIDE_CALENDAR_2026.map(event => [event.title, event]));
  assert.equal(byTitle.get("2026 league dues deadline").date, "2026-02-28");
  assert.equal(byTitle.get("2026 Pride league year begins").date, "2026-03-01");
  assert.equal(byTitle.get("Rookie Draft begins").date, "2026-05-02");
  assert.equal(byTitle.get("Free agency begins").date, "2026-07-25");
  assert.equal(byTitle.get("Free-agent contract years due").date, "2026-08-09");
  assert.equal(byTitle.get("Claims become available").date, "2026-08-15");
  assert.equal(byTitle.get("Last-year extension deadline").date, "2026-08-16");
  assert.equal(byTitle.get("Pride trade deadline").date, "2026-11-04");
});

test("August 12 command-center status identifies the current phase and next deadlines", () => {
  const status = currentCalendarStatus(new Date("2026-08-12T16:00:00Z"));
  assert.equal(status.today, "2026-08-12");
  assert.equal(status.phase.name, "Roster and contract administration");
  assert.equal(status.next.title, "Claims become available");
  assert.equal(status.daysUntilNext, 3);
  assert.equal(status.upcoming[1].title, "Last-year extension deadline");
});

test("calendar status uses Central Time around midnight", () => {
  const status = currentCalendarStatus(new Date("2026-08-16T04:30:00Z"));
  assert.equal(status.today, "2026-08-15");
  assert.equal(status.todayEvents[0].title, "Claims become available");
});
