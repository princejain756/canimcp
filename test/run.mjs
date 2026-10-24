// canimcp self-check. Run: npm test. Asserts real CLI behavior, no framework.
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(root, "bin/canimcp.js");
const run = (args, opts = {}) => {
  try {
    return { code: 0, out: execFileSync("node", [bin, ...args], { encoding: "utf8", ...opts }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || "") + (e.stderr || "") };
  }
};

let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}`); }
};

console.log("canimcp self-check\n");

// 1. quirky fixture: expected rule ids fire
const quirky = run(["fixtures/quirky-tools.json", "--json"], { cwd: root });
ok(quirky.code === 1, "quirky fixture exits 1 (error findings)");
const qj = JSON.parse(quirky.out);
const ids = new Set(qj.findings.map((f) => f.rule));
for (const expected of ["arg-name-brackets", "root-composition-adjacent", "missing-root-type", "large-input-schema", "enum-in-composition", "prefixitems-tuple", "int64-arg", "similar-tool-names", "outputschema-fidelity", "long-tool-name"]) {
  ok(ids.has(expected), `rule fires: ${expected}`);
}
ok(qj.toolsChecked === 10, "counts 10 tools");

// 2. clean fixture
const clean = run(["fixtures/clean-tools.json", "--json"], { cwd: root });
ok(clean.code === 0, "clean fixture exits 0");
ok(JSON.parse(clean.out).findings.length === 0, "clean fixture has zero findings");

// 3. --client filter
const cc = run(["fixtures/quirky-tools.json", "--client", "claude-code", "--json"], { cwd: root });
const ccj = JSON.parse(cc.out);
ok(ccj.findings.every((f) => Object.keys(f.clients).length === 0 || "claude-code" in f.clients), "--client claude-code drops codex-only findings");
ok(!ccj.findings.some((f) => f.rule === "root-composition-adjacent"), "codex-only rule filtered out");

// 4. stdin
const stdinRun = run(["--json"], { cwd: root, input: JSON.stringify({ tools: [{ name: "t", inputSchema: { properties: { "a[]": { type: "string" } } } }] }) });
ok(stdinRun.code === 1 && JSON.parse(stdinRun.out).findings.some((f) => f.rule === "arg-name-brackets"), "stdin tools/list works");

// 5. bare array input
const bare = run(["--json"], { cwd: root, input: JSON.stringify([{ name: "x", inputSchema: { type: "object" } }]) });
ok(bare.code === 0 && JSON.parse(bare.out).toolsChecked === 1, "bare tools array accepted");

// 6. --cmd stdio spawn
const spawned = run(["--cmd", "node fixtures/fake-server.mjs", "--json"], { cwd: root });
ok(spawned.code === 1, "--cmd run exits 1 on quirky server");
ok(JSON.parse(spawned.out).findings.some((f) => f.tool === "lookup_sku"), "--cmd collected live tools/list");

// 7. malformed input
const bad = run(["--json"], { cwd: root, input: "not json at all" });
ok(bad.code === 2 && bad.out.includes("not valid JSON"), "malformed input exits 2 with message");
const noTools = run(["--json"], { cwd: root, input: JSON.stringify({ hello: 1 }) });
ok(noTools.code === 2 && noTools.out.includes("tools array"), "JSON without tools array exits 2");

// 8. github format + fail-on
const gh = run(["fixtures/quirky-tools.json", "--format", "github"], { cwd: root });
ok(gh.out.includes("::error file=") && gh.out.includes("::warning file=") && gh.out.includes("::notice file="), "github annotations for all severities");
const never = run(["fixtures/quirky-tools.json", "--fail-on", "never"], { cwd: root });
ok(never.code === 0, "--fail-on never exits 0 despite errors");
const strict = run(["fixtures/clean-tools.json", "--fail-on", "warn"], { cwd: root });
ok(strict.code === 0, "clean fixture passes --fail-on warn");

// 9. tool-count rule: generated 2049-tool list
const many = { tools: Array.from({ length: 2049 }, (_, i) => ({ name: `t_${i}`, inputSchema: { type: "object" } })) };
const manyRun = run(["--json"], { cwd: root, input: JSON.stringify(many) });
ok(JSON.parse(manyRun.out).findings.some((f) => f.rule === "tool-count-overflow"), "tool-count-overflow fires at 2049 tools");

// 10. advisories + corpus flags
const adv = run(["--advisories"], { cwd: root });
ok(adv.out.includes("tools-list-stale") && adv.code === 0, "--advisories lists runtime quirks");
const cor = run(["--corpus"], { cwd: root });
ok(cor.out.includes("m3-quirks-2026-10") && cor.out.includes("measured"), "--corpus prints evidence sources");

// 11. --format sarif, --format json, --flag=value, and invalid --format
const sarif = run(["fixtures/quirky-tools.json", "--format", "sarif"], { cwd: root });
const sarifJson = JSON.parse(sarif.out);
ok(sarif.code === 1 && sarifJson.version === "2.1.0" && sarifJson.runs?.[0]?.results?.length === qj.findings.length, "--format sarif produces valid SARIF 2.1.0 report");
ok(sarifJson.runs[0].tool.driver.rules.length > 0 && sarifJson.runs[0].results.every((r) => r.ruleId && r.level), "SARIF rules and result levels populated");

const fmtJson = run(["fixtures/clean-tools.json", "--format=json"], { cwd: root });
ok(fmtJson.code === 0 && JSON.parse(fmtJson.out).tool === "canimcp", "--format=json works via = syntax");

const badFmt = run(["fixtures/clean-tools.json", "--format", "xml"], { cwd: root });
ok(badFmt.code === 2 && badFmt.out.includes("--format must be one of"), "unknown --format exits 2");

const ghEscape = run(["--cmd=node fixtures/fake-server.mjs", "--format=github"], { cwd: root });
ok(ghEscape.out.includes("::error file=node fixtures/fake-server.mjs::"), "--cmd=... with --format=github works");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
