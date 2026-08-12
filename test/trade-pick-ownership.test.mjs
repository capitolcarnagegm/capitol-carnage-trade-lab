import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const appPath = new URL('../app.js', import.meta.url);
const indexPath = new URL('../index.html', import.meta.url);

test('Trade Lab groups picks by normalized current owner and sorts them', async () => {
  const app = await readFile(appPath, 'utf8');
  assert.match(app, /String\(pick && pick\.currentOwnerTeamId/);
  assert.match(app, /=== teamId/);
  assert.match(app, /a\.year - b\.year \|\| a\.round - b\.round/);
  assert.doesNotMatch(app, /pick\.currentOwnerTeamId === team\.id/);
});

test('Trade Lab uses a stable pick identity instead of its array position', async () => {
  const [app, index] = await Promise.all([readFile(appPath, 'utf8'), readFile(indexPath, 'utf8')]);
  assert.match(app, /id: \[pick\.year, pick\.round, originalOwnerId, currentOwnerId\]\.join/);
  assert.match(app, /var key = "D:" \+ p\.id/);
  assert.match(app, /item\.id === pickId/);
  assert.doesNotMatch(app, /var pick = picks\[Number\(bits\[3\]\)\]/);
  assert.match(index, /app\.js\?v=1\.10\.2/);
});
