# Cursor + Cloudflare MCP Setup

This project uses two Cloudflare MCP servers in Cursor for managing DNS, Zero Trust Access, and consulting current Cloudflare documentation. The MCP config itself lives at `.cursor/mcp.json` and is gitignored — use this doc to recreate it on a new machine.

## Use `/mcp` only — `/sse` is not served on Cloudflare’s hosts

Cloudflare’s docs still mention a deprecated **`/sse`** transport for some setups. On the **hosted** URLs below, **`/sse` returns HTTP 404** (verified with live requests). Cursor will log streamable HTTP errors and then SSE fallback errors if the config points at `/sse`.

Always use:

- `https://mcp.cloudflare.com/mcp`
- `https://docs.mcp.cloudflare.com/mcp`

Official overview (URLs and OAuth): [Cloudflare’s own MCP servers](https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/).

## Cursor and streamable HTTP

Cursor may log something like: streamable HTTP POST fails, then fallback to SSE fails. That behavior is discussed in [this Cursor forum thread](https://forum.cursor.com/t/cursor-fails-to-fall-back-from-streamable-http-to-sse-transport-for-remote-mcp-servers/154390). With the correct **`/mcp`** URL, OAuth and tool calls should align with what Cloudflare actually exposes; keep Cursor updated. If a client still cannot speak streamable HTTP reliably, Cloudflare documents using a local **[mcp-remote](https://www.npmjs.com/package/mcp-remote)** proxy for clients that expect a different transport — see [Test a Remote MCP Server](https://developers.cloudflare.com/agents/guides/test-remote-mcp-server/).

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

3. Fully exit Cursor (**File → Exit**), reopen this workspace, then test in a fresh chat.
4. The first time the agent calls a Cloudflare tool, an OAuth flow will prompt for permissions. Grant scoped access — this project only needs DNS and Zero Trust write; everything else can be read-only.

## What the servers do

- **cloudflare-api** — Account-level operations against the Cloudflare API (DNS, WAF, Zero Trust, R2, Workers, etc.). Used to manage DNS records and Access applications without leaving the editor. The server exposes Codemode-style tools (`search`, `execute`) over the API — ask the agent to list DNS for a zone / domain in natural language after OAuth succeeds.
- **cloudflare-docs** — Fetches current Cloudflare documentation at runtime so the agent doesn't rely on stale knowledge.

## Servers intentionally omitted

- `cloudflare-bindings` — only relevant for Workers projects with `wrangler.jsonc`. Not used here.
- `cloudflare-builds` — Workers build pipelines. Not used here.
- `cloudflare-observability` — Workers logs and traces. Not used here.

Add any of these back to `.cursor/mcp.json` if the project ever uses Workers.
