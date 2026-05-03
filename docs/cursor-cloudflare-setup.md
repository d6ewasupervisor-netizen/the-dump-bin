# Cursor + Cloudflare MCP (tabled)

We attempted three connection patterns against Cloudflare’s hosted MCP endpoints—**streamable HTTP**, **SSE**, and an **`mcp-remote` bridge**—and none worked reliably with Cursor’s current MCP client implementation.

For now this project uses the **Cloudflare dashboard** directly for DNS and Access changes, and the **Railway CLI** for Railway changes.

This approach can be revisited when Cursor’s MCP transport handling matures.
