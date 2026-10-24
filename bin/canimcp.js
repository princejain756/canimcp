#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { runChecks, loadCorpus } from "../src/checks.js";
import { parseToolsJson, collectViaStdio } from "../src/collect.js";
import { textReport, advisoriesReport, jsonReport, githubReport, sarifReport } from "../src/report.js";

const VERSION = "0.1.0";

const HELP = `canimcp ${VERSION} - caniuse for MCP servers: which clients silently break your tools

usage:
  canimcp tools.json                check a saved tools/list response (or bare tools array)
  canimcp --cmd "node server.js"    spawn a stdio MCP server and check its live tools/list
  some-dump | canimcp               check JSON on stdin

flags:
  --client <name>     only report rules affecting this client (claude-code, codex)
  --json              machine-readable report (shorthand for --format json)
  --format <fmt>      output format: text (default), json, github, sarif
  --fail-on <sev>     exit 1 at this severity or worse: error (default), warn, advisory, never
  --advisories        list runtime quirks the corpus knows but a schema cannot reveal
  --corpus            print corpus version and evidence sources
  --no-color          plain output
  -h, --help          this help
  -v, --version       version

the corpus is the point: every rule cites its source, the client versions it was
measured on, and whether the evidence is measured, probe, or historical. PR a
rule with a reproduction and versions - see README.
`;

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) { console.log(HELP); process.exit(0); }
if (args.includes("-v") || args.includes("--version")) { console.log(VERSION); process.exit(0); }

const idx = (n) => args.indexOf(n);
const val = (n) => {
  const eq = args.find((a) => a.startsWith(`${n}=`));
  if (eq !== undefined) return eq.slice(n.length + 1);
  return idx(n) !== -1 ? args[idx(n) + 1] : undefined;
};
const VALID_FORMATS = new Set(["text", "json", "github", "sarif"]);
const rawFormat = val("--format") ?? (args.includes("--json") ? "json" : "text");
if (!VALID_FORMATS.has(rawFormat)) {
  console.error(`canimcp: --format must be one of ${Array.from(VALID_FORMATS).join(", ")}`);
  process.exit(2);
}
const color = !args.includes("--no-color") && process.stdout.isTTY !== false;

const corpus = loadCorpus();

if (args.includes("--corpus")) {
  console.log(`corpus ${corpus.version}`);
  console.log(`clients: ${Object.entries(corpus.clients).map(([k, v]) => `${v.label} (${v.tested.join(", ")})`).join("; ")}`);
  for (const s of corpus.sources) console.log(`  [${s.kind}] ${s.id}: ${s.url}\n    ${s.note}`);
  process.exit(0);
}

if (args.includes("--advisories")) {
  const { advisories } = runChecks([], { client: val("--client") });
  console.log(advisoriesReport(advisories, corpus.version, color));
  process.exit(0);
}

const FAIL_ORD = { error: 3, warn: 2, advisory: 1, never: 0 };
const failOn = val("--fail-on") ?? "error";
if (!(failOn in FAIL_ORD)) {
  console.error(`canimcp: --fail-on must be one of ${Object.keys(FAIL_ORD).join(", ")}`);
  process.exit(2);
}

const client = val("--client");
if (client && !corpus.clients[client]) {
  console.error(`canimcp: unknown client '${client}' - corpus knows: ${Object.keys(corpus.clients).join(", ")}`);
  process.exit(2);
}

const consumed = new Set();
for (const f of ["--client", "--format", "--fail-on", "--cmd"]) {
  const i = idx(f);
  if (i !== -1) { consumed.add(i); consumed.add(i + 1); }
}
const target = args.find((a, i) => !a.startsWith("-") && !consumed.has(i));

let tools;
let label;
try {
  if (val("--cmd")) {
    label = val("--cmd");
    tools = await collectViaStdio(label);
  } else if (target) {
    label = target;
    tools = parseToolsJson(readFileSync(target, "utf8"), target);
  } else if (!process.stdin.isTTY) {
    label = "stdin";
    // async read: readFileSync(0) EAGAINs on large piped input
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    tools = parseToolsJson(Buffer.concat(chunks).toString("utf8"), "stdin");
  } else {
    console.error(HELP);
    process.exit(2);
  }
} catch (e) {
  console.error(`canimcp: ${e.message}`);
  process.exit(2);
}

const result = runChecks(tools, { client });
const out =
  rawFormat === "github"
    ? githubReport(result, label)
    : rawFormat === "sarif"
      ? sarifReport(result, label, VERSION)
      : rawFormat === "json"
        ? jsonReport(result, label, VERSION)
        : textReport(result, label, VERSION, color);
console.log(out);
const worst = result.findings.reduce((m, f) => Math.max(m, FAIL_ORD[f.severity]), 0);
process.exit(FAIL_ORD[failOn] > 0 && worst >= FAIL_ORD[failOn] ? 1 : 0);
