# Cursor + Cloudflare MCP Setup

This project uses two Cloudflare MCP servers in Cursor for managing DNS, Zero Trust Access, and consulting current Cloudflare documentation. The MCP config itself lives at `.cursor/mcp.json` and is gitignored — use this doc to recreate it on a new machine.

## Cursor + streamable HTTP (why we use `/sse`)

Cloudflare exposes two transport URLs:

- **`/mcp`** — streamable HTTP (modern MCP transport)
- **`/sse`** — Server-Sent Events (legacy; still served for older clients)

OAuth against `/mcp` can succeed, but **Cursor currently mishandles streamable HTTP for remote MCP**: after connecting it may still open an SSE stream against the same base URL. Cloudflare’s streamable endpoint returns **404 for SSE**, Cursor retries, then “tombstones” the transport. This is a Cursor-side issue, not a misconfiguration on your machine. Discussion: [Cursor fails to fall back from streamable HTTP to SSE for remote MCP servers](https://forum.cursor.com/t/cursor-fails-to-fall-back-from-streamable-http-to-sse-transport-for-remote-mcp-servers/154390).

**Workaround:** point both servers at **`/sse`** until Cursor’s transport handling is fixed; then switch back to `/mcp` if you prefer the non-deprecated transport.

**Note:** SSE is deprecated in MCP and by Cloudflare for the long term; it works today for compatibility. If either side removes `/sse`, revisit this doc.

## Setup steps

1. Install the Cloudflare Skills rule in Cursor: Settings → Rules → Add Rule → Remote Rule → `cloudflare/skills`
2. Create `.cursor/mcp.json` in the repo root with this content:

```json
   {
     "mcpServers": {
       "cloudflare-api": {
         "url": "https://mcp.cloudflare.com/sse"
       },
       "cloudflare-docs": {
         "url": "https://docs.mcp.cloudflare.com/sse"
       }
     }
   }
```

3. Fully exit Cursor (**File → Exit**), reopen this workspace, then test in a fresh chat (e.g. list DNS for your zone).
4. The first time the agent calls a Cloudflare tool, an OAuth flow will prompt for permissions. Grant scoped access — this project only needs DNS and Zero Trust write; everything else can be read-only. **Changing the server URL counts as a different endpoint — you may need to authorize again.**

## What the servers do

- **cloudflare-api** — Account-level operations against the Cloudflare API (DNS, WAF, Zero Trust, R2, Workers, etc.). Used to manage DNS records and Access applications without leaving the editor.
- **cloudflare-docs** — Fetches current Cloudflare documentation at runtime so the agent doesn't rely on stale knowledge.

## Servers intentionally omitted

- `cloudflare-bindings` — only relevant for Workers projects with `wrangler.jsonc`. Not used here.
- `cloudflare-builds` — Workers build pipelines. Not used here.
- `cloudflare-observability` — Workers logs and traces. Not used here.

Add any of these back to `.cursor/mcp.json` if the project ever uses Workers.
