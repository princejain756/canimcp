// Minimal stdio MCP server for `canimcp --cmd` demos and tests.
// Speaks newline-delimited JSON-RPC: initialize, notifications/initialized,
// tools/list. Everything else gets method-not-found.
const tools = [
  {
    name: "lookup_sku",
    description: "Look up a SKU",
    inputSchema: {
      type: "object",
      properties: {
        "sku[]": { type: "array", items: { type: "string" } },
      },
      required: ["sku[]"],
    },
  },
  {
    name: "ping",
    description: "Health check",
    inputSchema: { type: "object", properties: {} },
  },
];

let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === "notifications/initialized") continue;
    if (msg.id === undefined) continue;
    const respond = (result) =>
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n");
    const fail = (code, message) =>
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code, message } }) + "\n");
    if (msg.method === "initialize") {
      respond({
        protocolVersion: msg.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "canimcp-fixture", version: "0.0.0" },
      });
    } else if (msg.method === "tools/list") {
      respond({ tools });
    } else {
      fail(-32601, "method not found");
    }
  }
});
