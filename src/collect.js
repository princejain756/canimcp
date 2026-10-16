// Acquire a server's tool list: normalize pasted JSON, or spawn a stdio MCP
// server command and ask it over JSON-RPC.
import { spawn } from "node:child_process";

// Accepts: {"result":{"tools":[...]}}, {"tools":[...]}, or a bare [...]
export function normalizeToolsList(json) {
  const tools = json?.result?.tools ?? json?.tools ?? (Array.isArray(json) ? json : null);
  if (!Array.isArray(tools)) {
    throw new Error("could not find a tools array - pass a tools/list response, an object with \"tools\", or a bare array");
  }
  for (const [i, t] of tools.entries()) {
    if (!t || typeof t !== "object" || typeof t.name !== "string") {
      throw new Error(`tools[${i}] is not an MCP tool object (needs at least a string "name")`);
    }
  }
  return tools;
}

export function parseToolsJson(text, label = "input") {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  return normalizeToolsList(json);
}

// Spawn `cmd` (shell string), do initialize -> notifications/initialized ->
// tools/list over newline-delimited JSON-RPC on stdio, then kill it.
export function collectViaStdio(cmd, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { shell: true, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let done = false;
    let nextId = 1;
    const pending = new Map();

    const finish = (err, tools) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      err ? reject(err) : resolve(tools);
    };

    const timer = setTimeout(() => finish(new Error(`server did not answer tools/list within ${timeoutMs / 1000}s (${cmd})`)), timeoutMs);
    child.on("error", (e) => finish(new Error(`cannot start '${cmd}': ${e.message}`)));
    child.on("exit", (code) => finish(new Error(`'${cmd}' exited with code ${code} before answering tools/list`)));

    const send = (method, params) => {
      const id = nextId++;
      pending.set(id, { method });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    };

    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        // Framed MCP (Content-Length headers) is not spoken by stdio servers
        // per the spec - but tolerate a header line if one sneaks in.
        if (/^content-length:/i.test(line)) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; } // tolerate log lines on stdout
        if (msg.id !== undefined && pending.has(msg.id)) {
          const { method } = pending.get(msg.id);
          pending.delete(msg.id);
          if (method === "initialize") {
            child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
            send("tools/list", {});
          } else if (method === "tools/list") {
            try { finish(null, normalizeToolsList(msg.result ?? msg)); }
            catch (e) { finish(e); }
          }
        }
      }
    });

    send("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "canimcp", version: "0.1.0" },
    });
  });
}
