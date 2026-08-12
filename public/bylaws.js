export const PRIDE_BYLAWS = {
  league: { teams: 14, divisionCount: 1, activeRosterMin: 30, activeRosterMax: 37, taxiMax: 6, irMax: 5, starters: 19 },
  cap: { currentAnchor: 1403.90, anchorYear: 2026, annualIncrease: 0.05, increaseDate: "March 1", irSalaryPct: 0, taxiSalaryPct: 1 },
  roster: { qbMainMax: 4, taxiAgeMax: 23 },
  lineup: ["QB x1","RB x2","WR x3","TE x1","Offensive Flex x1","Superflex x1","DL x3","LB x2","DB x3","ID Flex x2"],
  cuts: {
    currentYearPct: 1,
    irReleaseCurrentRoomFloor: 0,
    nextYearByYearsRemaining: { 1: 0, 2: 0.40, 3: 0.60, 4: 0.80, 5: 0.85 },
    thirdYearAndLaterPct: 0
  },
  contracts: { annualSalaryIncrease: 0.20, standardMaxYears: 4, draftedRookieExtensionMaxYears: 5 }
};
