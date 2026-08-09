# GM's Locker Multi-AI Gateway

Cloudflare Worker gateway for OpenAI, Anthropic Claude, and xAI Grok.

Default production models:

- OpenAI: `gpt-5.6-terra`
- Anthropic: `claude-sonnet-5`
- xAI: `grok-4.5`

## Modes

POST `/gm-chat` with `provider`:

- `auto` - routes by task
- `openai` - OpenAI only
- `claude` - Claude only
- `grok` - Grok only
- `consensus` - asks all three in parallel, then uses OpenAI as the final GM judge when available

## Required secrets

From the `multi-ai-worker` directory:

```bash
npm install
npx wrangler d1 create gms-locker-db
# Put the returned database_id in wrangler.toml, then:
npx wrangler d1 migrations apply gms-locker-db --remote
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put XAI_API_KEY
npx wrangler deploy
```

Never put provider keys in the browser or GitHub source.

## Request

```json
{
  "provider": "consensus",
  "conversationId": "capitol-carnage",
  "messages": [
    {"role":"user","content":"Should we trade Garrett for this package?"}
  ],
  "context": {
    "league": {},
    "myTeam": {},
    "opponent": {},
    "freeAgents": [],
    "currentNFL": []
  },
  "memory": {
    "verifiedFacts": [],
    "userTheses": [],
    "pastDecisions": []
  }
}
```

The browser should send only relevant database context rather than the entire league database on every message.

## Response

Single-provider mode returns `answer` with provider/model/text/usage.
Consensus mode additionally returns `panel`, preserving the individual model opinions for a three-scout view.

## Memory

The D1 schema for shared franchise memory, council reports, decisions, evidence, and audit history lives in `migrations/0001_init.sql`. The current gateway accepts memory in requests but does not yet write that memory to D1. The next application step is to connect the council workflow to these tables so all three providers share the same franchise brain. Store verified facts separately from user theses and model inference.
