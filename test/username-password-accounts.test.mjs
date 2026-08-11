import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const worker = await readFile(new URL("../cloudflare-worker.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/0003_username_password_accounts.sql", import.meta.url), "utf8");

test("individual accounts register and sign in with username and password", () => {
  assert.match(worker, /\/auth\/register/);
  assert.match(worker, /\/auth\/login/);
  assert.match(worker, /PBKDF2/);
  assert.match(worker, /iterations: 210000/);
  assert.match(worker, /crypto\.getRandomValues/);
  assert.match(worker, /safeEqual/);
  assert.doesNotMatch(worker, /\/auth\/request-code/);
});

test("password credentials are stored separately from user league data", () => {
  assert.match(migration, /ADD COLUMN username/);
  assert.match(migration, /ADD COLUMN password_hash/);
  assert.match(migration, /ADD COLUMN password_salt/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS idx_users_username/);
  assert.match(worker, /WHERE id=\? AND user_id=\?/);
});

test("the account screen has distinct registration and login modes", () => {
  assert.match(app, /Create your GMS Locker account/);
  assert.match(app, /autocomplete="username"/);
  assert.match(app, /autocomplete=".*password/);
  assert.match(app, /\/auth\/register/);
  assert.match(app, /\/auth\/login/);
  assert.doesNotMatch(app, /Email my one-time code/);
});

test("failed password attempts are rate limited", () => {
  assert.match(worker, /password_login_attempts/);
  assert.match(worker, /Too many sign-in attempts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS password_login_attempts/);
});
