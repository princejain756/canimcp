// Regenerates demo.html + social.html from a REAL canimcp run. Never hand-edit.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (args) => {
  try {
    return execFileSync("node", [join(root, "bin/canimcp.js"), ...args, "--no-color"], { encoding: "utf8" });
  } catch (e) {
    return e.stdout;
  }
};

const quirky = run(["fixtures/quirky-tools.json", "--client", "codex", "--fail-on", "never"]);
const clean = run(["fixtures/clean-tools.json", "--fail-on", "never"]);

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const paint = (text) =>
  esc(text)
    .replace(/^canimcp ([\d.]+)/m, '<span class="big">canimcp $1</span>')
    .replace(/^CLEAN.*$/m, '<span class="ok">$&</span>')
    .replace(/^(\d+ findings?|.*tools checked.*)$/gm, '<span class="big">$1</span>')
    .replace(/\[error\]/g, '<span class="err">[error]</span>')
    .replace(/\[ warn\]/g, '<span class="wrn">[ warn]</span>')
    .replace(/\[ adv \]/g, '<span class="adv">[ adv ]</span>')
    .replace(/^(\s+)(fix:|src:)(.*)$/gm, '$1<span class="dim">$2$3</span>')
    .replace(/^(  (?!fix:|src:).*detail.*|    \S.*\(inputSchema.*\)|    .*normalize.*|    \d+(\.\d+)? KB.*|    no root.*|    \d+ chars.*|    declares.*|    uses.*|    argument.*|    integer.*)$/gm, '<span class="path">$1</span>')
    .replace(/^tool: (.+)$/gm, '<span class="tool">tool: $1</span>')
    .replace(/^server$/gm, '<span class="tool">server</span>')
    .replace(/═+/g, '<span class="dim">$&</span>')
    .replace(/^(\s*\d+ runtime quirks.*|evidence:.*)$/gm, '<span class="dim">$1</span>');

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; background: #0b0e14; display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: "SF Mono", Menlo, monospace; }
  .term { width: 1060px; margin: 40px; border-radius: 12px; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,.6); background: #0d1117; border: 1px solid #21262d; }
  .bar { display: flex; gap: 8px; padding: 14px 16px; background: #161b22; border-bottom: 1px solid #21262d; align-items: center; }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .r { background: #ff5f57; } .y { background: #febc2e; } .g { background: #28c840; }
  .title { margin-left: 12px; color: #7d8590; font-size: 13px; }
  pre { margin: 0; padding: 26px 32px 32px; font-size: 15px; line-height: 1.55; color: #c9d1d9; white-space: pre-wrap; }
  .p { color: #79c0ff; } .dim { color: #7d8590; } .path { color: #8b949e; }
  .big { color: #79c0ff; font-weight: 700; }
  .ok { color: #3fb950; font-weight: 700; }
  .err { color: #f85149; font-weight: 700; }
  .wrn { color: #d29922; font-weight: 700; }
  .adv { color: #bc8cff; font-weight: 700; }
  .tool { color: #56d4dd; font-weight: 700; }
</style>
</head>
<body>
<div class="term">
  <div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="title">zsh</span></div>
<pre><span class="p">$</span> npx canimcp fixtures/quirky-tools.json --client codex
${paint(quirky)}
<span class="p">$</span> npx canimcp fixtures/clean-tools.json
${paint(clean)}<span class="dim">  exit 0 - would pass a CI gate</span>
<span class="p">$</span> <span class="dim">|</span></pre>
</div>
</body>
</html>
`;
writeFileSync(join(root, "demo.html"), html);

// social card: 1280x640 - name + pitch left, real finding lines right
const findings = quirky.split("\n").filter((l) => /^\s{2}\[(error| warn| adv )\]/.test(l)).slice(0, 7);
const social = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; width: 1280px; height: 640px; background: #0b0e14; display: flex; font-family: "SF Mono", Menlo, monospace; overflow: hidden; }
  .left { width: 44%; padding: 56px 44px; border-right: 1px solid #21262d; background: #0d1117; display: flex; flex-direction: column; justify-content: center; }
  .name { color: #79c0ff; font-size: 52px; font-weight: 700; margin-bottom: 22px; }
  .tag { color: #7d8590; font-size: 24px; line-height: 1.55; margin-bottom: 40px; }
  .cmd { color: #3fb950; font-size: 19px; }
  .right { width: 56%; padding: 56px 40px; display: flex; flex-direction: column; justify-content: center; }
  .f { color: #c9d1d9; font-size: 20px; line-height: 2.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .f b { font-weight: 700; margin-right: 12px; }
  .e { color: #f85149; } .w { color: #d29922; } .a { color: #bc8cff; }
  .foot { color: #7d8590; font-size: 16px; margin-top: 26px; }
</style></head><body>
<div class="left">
  <div class="name">canimcp</div>
  <div class="tag">Which clients silently break your MCP server's tools.<br><br>caniuse, for MCP.</div>
  <div class="cmd">$ npx canimcp --cmd "node server.js"</div>
</div>
<div class="right">
  ${findings.map((l) => {
    const sev = l.includes("error") ? "e" : l.includes("warn") ? "w" : "a";
    const [badge, ...rest] = l.trim().split(/\] /);
    return `<div class="f"><b class="${sev}">${esc(badge)}]</b>${esc(rest.join("] "))}</div>`;
  }).join("\n  ")}
  <div class="foot">findings scoped to client version + evidence grade</div>
</div>
</body></html>`;
writeFileSync(join(root, "social.html"), social);
console.log("demo.html + social.html regenerated from live runs");
