# Legacy MFL bridge

This optional, deprecated Worker remains only for older MFL sync and screenshot-reader compatibility. Fantrax is the current league source.

All league-specific settings are Worker secrets or variables; no league identifier belongs in this repository. Data and image routes also require a bearer token.

Required configuration:

- `MFL_LEAGUE_ID`
- `MFL_SEASON`
- `MFL_HOST`
- `BRIDGE_ACCESS_TOKEN` (secret)

The public health route reports only whether the bridge is configured. It never returns the league identifier.
