#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
package_dir="$(cd -- "${script_dir}/.." && pwd)"
worker_dir="${package_dir}/worker"
public_dir="${package_dir}/public-release"
private_import="${package_dir}/private/gmslocker-private-import.sql"
repo_url="https://github.com/capitolcarnagegm/capitol-carnage-trade-lab.git"
worker_health="https://gms-locker-ai.robinharvey001.workers.dev/health"

cleanup() {
  unset CLOUDFLARE_API_TOKEN access_code gemini_key
}
trap cleanup EXIT

fail() { printf '\nERROR: %s\n' "$1" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$2"; }

printf '\nGMSLOCKER v6.7 manual publisher\n'
printf 'This deploys the private Worker/database first, verifies it, then replaces GitHub main with the sanitized release.\n\n'

need node 'Install Node.js LTS from https://nodejs.org and run this script again.'
need npm 'Install Node.js LTS from https://nodejs.org and run this script again.'
need git 'Install Apple command-line tools with: xcode-select --install'
need curl 'curl is required but was not found.'
[[ -f "${private_import}" ]] || fail 'The private database import is missing. Download/extract the complete package again.'
[[ -f "${worker_dir}/wrangler.jsonc" ]] || fail 'The Worker configuration is missing.'
[[ -f "${public_dir}/index.html" ]] || fail 'The sanitized public release is missing.'

printf 'Paste the NEW Cloudflare deployment token (input stays hidden): '
IFS= read -r -s CLOUDFLARE_API_TOKEN
printf '\n'
[[ -n "${CLOUDFLARE_API_TOKEN}" ]] || fail 'No Cloudflare token entered.'
export CLOUDFLARE_API_TOKEN

printf 'Create a GMSLOCKER login password (12+ characters; input stays hidden): '
IFS= read -r -s access_code
printf '\n'
[[ ${#access_code} -ge 12 ]] || fail 'The GMSLOCKER login password must be at least 12 characters.'

printf 'Paste a Gemini API key, or press Enter to leave Gemini disabled (input stays hidden): '
IFS= read -r -s gemini_key
printf '\n\n'

cd "${worker_dir}"
npm ci
npx wrangler whoami >/dev/null
npm test
npx wrangler deploy --dry-run >/dev/null

printf '\nApplying the private database schema...\n'
npx wrangler d1 migrations apply gms-locker-db --remote

printf '\nImporting the private league baseline...\n'
npx wrangler d1 execute gms-locker-db --remote --file="${private_import}"

printf '\nSetting private Worker secrets...\n'
printf '%s' "${access_code}" | npx wrangler secret put GMSLOCKER_ACCESS_TOKEN
printf '%s' 'astbqxhwmk4b6bg9' | npx wrangler secret put FANTRAX_LEAGUE_ID
if [[ -n "${gemini_key}" ]]; then
  printf '%s' "${gemini_key}" | npx wrangler secret put GEMINI_API_KEY
fi

printf '\nDeploying the Worker...\n'
npx wrangler deploy

printf '\nVerifying the Worker...\n'
health_json="$(curl --fail --silent --show-error "${worker_health}")"
node -e 'const h=JSON.parse(process.argv[1]); if(!h.ok||!h.privateData||!h.accessConfigured||!h.fantraxConfigured) process.exit(1)' "${health_json}" \
  || fail 'Worker health check did not confirm the database, login, and Fantrax configuration.'
printf 'Private backend verified.\n'

printf '\nGitHub sign-in is next. A browser window may open.\n'
if ! command -v gh >/dev/null 2>&1; then
  fail 'Install GitHub CLI from https://cli.github.com, then run this script again. The Cloudflare backend is already deployed.'
fi
gh auth status >/dev/null 2>&1 || gh auth login --web --git-protocol https
gh auth setup-git

cd "${public_dir}"
rm -rf -- .git
git init -b main
git config user.name "GMSLOCKER Release"
git config user.email "capitolcarnagegm@users.noreply.github.com"
git add --all
git commit -m "Publish sanitized GMSLOCKER v6.7"
git remote add origin "${repo_url}"

printf '\nThe next operation replaces the repository main history with this sanitized one-commit release.\n'
printf 'Type PUBLISH to continue: '
IFS= read -r confirmation
[[ "${confirmation}" == 'PUBLISH' ]] || fail 'GitHub publication cancelled. The Cloudflare backend remains deployed.'
git push --force origin main

printf '\nVerifying gmslocker.com...\n'
curl --fail --silent --show-error --retry 6 --retry-delay 5 https://gmslocker.com/ >/dev/null

printf '\nSUCCESS: GMSLOCKER v6.7 is deployed and gmslocker.com is responding.\n'
printf 'Revoke the Cloudflare deployment token now: https://dash.cloudflare.com/profile/api-tokens\n'

