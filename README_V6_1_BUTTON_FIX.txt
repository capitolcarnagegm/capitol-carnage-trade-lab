GM'S LOCKER v6.1 — INTERACTION RELIABILITY FIX

ROOT FIXES
- v6 was still shipping service-worker cache name gmslocker-v5-master.
- v6.1 uses a new network-first/no-HTML-cache service worker.
- Old GM's Locker caches are removed during activation.
- Page requests an immediate service-worker update.

BUTTON / CORRECTION FIXES
- All buttons explicitly use type="button".
- Roster, FA, and Manual correction panels are no longer hidden behind JS state.
- Correction action buttons navigate directly and scroll to the controls.
- Native file inputs remain directly accessible.
- Build-health strip displays v6.1 + READY or the actual runtime JS error.

TEST ORDER
1. Confirm top strip says GM's Locker v6.1 · Interaction layer: READY.
2. Test all navigation tabs.
3. Roster Screenshot: Choose -> Process -> Review -> Apply.
4. FA Screenshot: Choose -> Process -> Review -> Apply.
5. Transactions: Process screenshot -> Review -> Apply.
6. MFL Sync.
