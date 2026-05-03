# Cursor + Cloudflare MCP Setup

This project uses two Cloudflare MCP servers in Cursor for managing DNS, Zero Trust Access, and consulting current Cloudflare documentation. The MCP config itself lives at `.cursor/mcp.json` and is gitignored — use this doc to recreate it on a new machine.

## Setup steps

1. Install the Cloudflare Skills rule in Cursor: Settings → Rules → Add Rule → Remote Rule → `cloudflare/skills`
2. Create `.cursor/mcp.json` in the repo root with this content:

```json
   {
     "mcpServers": {
       "cloudflare-api": {
         "url": "https://mcp.cloudflare.com/mcp"
       },
       "cloudflare-docs": {
         "url": "https://docs.mcp.cloudflare.com/mcp"
       }
     }
   }
```

3. Restart Cursor.
4. The first time the agent calls a Cloudflare tool, an OAuth flow will prompt for permissions. Grant scoped access — this project only needs DNS and Zero Trust write; everything else can be read-only.

## What the servers do

- **cloudflare-api** — Account-level operations against the Cloudflare API (DNS, WAF, Zero Trust, R2, Workers, etc.). Used to manage DNS records and Access applications without leaving the editor.
- **cloudflare-docs** — Fetches current Cloudflare documentation at runtime so the agent doesn't rely on stale knowledge.

## Servers intentionally omitted

- `cloudflare-bindings` — only relevant for Workers projects with `wrangler.jsonc`. Not used here.
- `cloudflare-builds` — Workers build pipelines. Not used here.
- `cloudflare-observability` — Workers logs and traces. Not used here.

Add any of these back to `.cursor/mcp.json` if the project ever uses Workers.
