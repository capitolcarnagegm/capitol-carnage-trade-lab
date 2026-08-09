# GM's Locker Multi-AI Gateway

Cloudflare Worker gateway for OpenAI, Anthropic Claude, and xAI Grok.

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

This gateway accepts memory but does not yet persist it. The v7 database layer should own persistent memory so all three providers share the exact same franchise brain. Store verified facts separately from user theses and model inference.
