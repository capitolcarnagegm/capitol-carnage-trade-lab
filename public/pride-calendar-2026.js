export const PRIDE_CALENDAR_2026 = [
  { date: "2026-01-16", time: null, category: "Offseason", title: "Offseason begins", details: "Franchise and transition tag amounts are posted; Stage 1 and Stage 2 holdouts are named; five-player IR slots are deactivated; player drops are allowed." },
  { date: "2026-01-18", time: "12:00 p.m. CT", at: "2026-01-18T18:00:00Z", category: "Trading", title: "Trading resumes", details: "Trading reopens at noon Central Time." },
  { date: "2026-02-28", time: "11:00 p.m. CT", at: "2026-03-01T05:00:00Z", category: "League administration", title: "2026 league dues deadline", details: "League dues must be paid by 11:00 p.m. Central Time." },
  { date: "2026-02-28", time: "11:59 p.m. CT", at: "2026-03-01T05:59:00Z", category: "Contracts", title: "Tag and holdout decisions due", details: "Franchise tag, transition tag, and holdout decisions must be submitted." },
  { date: "2026-03-01", time: null, category: "League year", title: "2026 Pride league year begins", details: "The official team cap-hit file is posted. Contract years decrease by one; expired contracts become unrestricted free agents; the league cap increases 5%; active salaries increase 20%." },
  { date: "2026-03-01", time: "12:00 p.m. CT", at: "2026-03-01T18:00:00Z", category: "Rules", title: "Rule-change submissions open", details: "Owners may begin submitting proposed rule changes." },
  { date: "2026-03-07", time: "12:00 p.m. CT", at: "2026-03-07T18:00:00Z", category: "Rules", title: "Rule-change submissions close", details: "The submission window ends." },
  { date: "2026-03-07", time: "12:05 p.m. CT", at: "2026-03-07T18:05:00Z", category: "Rules", title: "Rule-change voting opens", details: "Voting begins on submitted proposals." },
  { date: "2026-03-14", time: "12:00 p.m. CT", at: "2026-03-14T17:00:00Z", category: "Rules", title: "Rule-change voting closes", details: "Voting ends on proposed changes." },
  { date: "2026-03-14", time: "12:00 p.m. CT", category: "Franchise tags", title: "Franchise-tag bidding opens", details: "Open bidding begins at noon Central Time." },
  { date: "2026-03-21", time: "12:00 p.m. CT", at: "2026-03-21T17:00:00Z", category: "Franchise tags", title: "Franchise-tag bidding closes", details: "Open bidding ends." },
  { date: "2026-03-21", time: "12:05 p.m. CT", at: "2026-03-21T17:05:00Z", category: "Franchise tags", title: "Tag match/decline window opens", details: "Franchises may begin matching or declining tag offers." },
  { date: "2026-03-28", time: "12:00 p.m. CT", at: "2026-03-28T17:00:00Z", category: "Franchise tags", title: "Tag match/decline deadline", details: "The franchise tag decision window closes." },
  { date: "2026-04-23", time: null, category: "Draft", title: "2028 rookie picks added", details: "2028 rookie draft picks are placed on team rosters." },
  { date: "2026-05-02", time: "12:00 p.m. CT", at: "2026-05-02T17:00:00Z", category: "Draft", title: "Rookie Draft begins", details: "The 2026 Pride Rookie Draft starts." },
  { date: "2026-07-25", time: "12:00 p.m. CT", at: "2026-07-25T17:00:00Z", category: "Free agency", title: "Free agency begins", details: "The annual free-agent period opens." },
  { date: "2026-08-01", time: "12:00 p.m. CT", at: "2026-08-01T17:00:00Z", category: "Free agency", title: "Free-agent nominations close", details: "The nomination period ends at noon Central Time." },
  { date: "2026-08-03", time: null, category: "Roster", title: "Five IR slots activate", details: "The regular five-player injured-reserve allotment becomes available." },
  { date: "2026-08-09", time: "11:59 p.m. CT", at: "2026-08-10T04:59:00Z", category: "Contracts", title: "Free-agent contract years due", details: "Contract years must be posted for acquired free agents; unspecified players receive one-year contracts." },
  { date: "2026-08-15", time: "12:00 p.m. CT", at: "2026-08-15T17:00:00Z", category: "Waivers", title: "Claims become available", details: "Teams may begin submitting claims." },
  { date: "2026-08-16", time: "11:59 p.m. CT", at: "2026-08-17T04:59:00Z", category: "Contracts", title: "Last-year extension deadline", details: "Deadline to extend players who are in the final year of their contracts." },
  { date: "2026-09-10", time: null, category: "Regular season", title: "NFL season begins", details: "The regular-season phase begins." },
  { date: "2026-10-08", time: "7:00 p.m. CT", at: "2026-10-09T00:00:00Z", category: "Contracts", title: "Non-final-year extension deadline begins", details: "Calendar milestone for extensions involving players who are not in the final year of their contracts." },
  { date: "2026-11-04", time: "10:59 p.m. CT", at: "2026-11-05T04:59:00Z", category: "Trading", title: "Pride trade deadline", details: "Trading closes for the regular season." }
];

const PHASES = [
  { start: "2026-01-01", end: "2026-01-15", name: "Season closeout", action: "Prepare for the offseason opening, tag values, holdout decisions, and IR deactivation." },
  { start: "2026-01-16", end: "2026-02-28", name: "Offseason compliance", action: "Resolve tags and holdouts, manage cuts and trades, pay dues, and prepare to meet the March 1 cap." },
  { start: "2026-03-01", end: "2026-03-28", name: "New league year and tag market", action: "Audit rolled contracts and salaries, confirm the cap-hit file, vote on rules, and manage franchise-tag bidding." },
  { start: "2026-03-29", end: "2026-05-01", name: "Rookie Draft preparation", action: "Audit draft capital, roster capacity, and cap room before the rookie draft." },
  { start: "2026-05-02", end: "2026-07-24", name: "Post-draft roster building", action: "Evaluate rookie outcomes, trades, extensions, and free-agent needs." },
  { start: "2026-07-25", end: "2026-08-01", name: "Free agency", action: "Manage nominations and bids while preserving cap and roster flexibility." },
  { start: "2026-08-02", end: "2026-09-09", name: "Roster and contract administration", action: "Activate eligible IR players, finalize free-agent contract years, prepare claims, and complete eligible extensions." },
  { start: "2026-09-10", end: "2026-11-04", name: "Regular season and trade window", action: "Set legal lineups, manage waivers and extensions, and evaluate trades before the deadline." },
  { start: "2026-11-05", end: "2026-12-31", name: "Post-deadline season management", action: "Focus on legal lineups, waivers, playoff positioning, and next-year planning." }
];

function centralDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Indiana/Indianapolis", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return [values.year, values.month, values.day].join("-");
}

function dateValue(key) {
  return Date.parse(key + "T12:00:00Z");
}

export function currentCalendarStatus(now = new Date()) {
  const today = centralDateKey(now);
  const phase = PHASES.find(item => today >= item.start && today <= item.end) || { name: "Calendar unavailable", action: "Review the official league calendar." };
  const todayEvents = PRIDE_CALENDAR_2026.filter(event => event.date === today);
  const upcoming = PRIDE_CALENDAR_2026.filter(event => event.date > today).slice(0, 6);
  const recent = PRIDE_CALENDAR_2026.filter(event => event.date < today).slice(-3).reverse();
  const next = upcoming[0] || null;
  const daysUntilNext = next ? Math.max(0, Math.round((dateValue(next.date) - dateValue(today)) / 86400000)) : null;
  return { today, phase, todayEvents, upcoming, recent, next, daysUntilNext, source: "2026 Pride League Calendar.xlsx", officialTimezone: "America/Chicago", timezone: "America/Indiana/Indianapolis" };
}
