const SEV_ICON = { error: "error", warn: " warn", advisory: " adv " };
const GH_LEVEL = { error: "error", warn: "warning", advisory: "notice" };

function clientsLabel(clients) {
  const entries = Object.entries(clients || {});
  if (!entries.length) return "older/pinned clients";
  return entries.map(([c, v]) => `${c} ${v}`).join(", ");
}

export function textReport({ findings, advisories, toolsChecked, corpusVersion }, label, version, color = true) {
  const c = (code, s) => (color ? `[${code}m${s}[0m` : s);
  const counts = { error: 0, warn: 0, advisory: 0 };
  for (const f of findings) counts[f.severity]++;
  const line = "═".repeat(64);
  const out = [];
  out.push(`${c("1;34", `canimcp ${version}`)} · corpus ${corpusVersion} · ${label}`);
  out.push(c("2", line));
  if (!findings.length) {
    out.push(c("1;32", `CLEAN - no known client quirks detected`));
    out.push(c("2", `${toolsChecked} tools checked`));
  } else {
    out.push(c("1", `${findings.length} finding${findings.length === 1 ? "" : "s"} · ${counts.error} error${counts.error === 1 ? "" : "s"} · ${counts.warn} warning${counts.warn === 1 ? "" : "s"} · ${counts.advisory} advisor${counts.advisory === 1 ? "y" : "ies"} · ${toolsChecked} tools checked`));
    let lastTool = Symbol();
    for (const f of findings) {
      const scope = f.tool ?? "server";
      if (scope !== lastTool) {
        out.push("");
        out.push(c("1;36", scope === "server" ? "server" : `tool: ${scope}`));
        lastTool = scope;
      }
      const sevColor = f.severity === "error" ? "1;31" : f.severity === "warn" ? "1;33" : "1;35";
      out.push(`  ${c(sevColor, `[${SEV_ICON[f.severity]}]`)} ${c("1", f.rule)} ${c("2", `· ${clientsLabel(f.clients)}`)}`);
      out.push(c("2", `    ${f.detail} (${f.path})`));
      out.push(`    ${f.message}`);
      out.push(c("2", `    fix: ${f.fix}`));
      out.push(c("2", `    src: ${f.source} · evidence: ${f.evidence}`));
    }
  }
  if (advisories.length) {
    out.push("");
    out.push(c("2", `${advisories.length} runtime quirk${advisories.length === 1 ? "" : "s"} not statically checkable - canimcp --advisories`));
  }
  out.push(c("2", "evidence: measured = harness run on pinned clients · probe = direct binary probe · historical = cleared at tested versions"));
  return out.join("\n");
}

export function advisoriesReport(advisories, corpusVersion, color = true) {
  const c = (code, s) => (color ? `[${code}m${s}[0m` : s);
  const out = [c("1;34", `canimcp runtime advisories`) + c("2", ` · corpus ${corpusVersion}`)];
  for (const a of advisories) {
    out.push("");
    out.push(c("1;35", `[${a.id}]`) + " " + c("2", clientsLabel(a.clients)));
    out.push(`  ${a.message}`);
    out.push(c("2", `  fix: ${a.fix}`));
    out.push(c("2", `  src: ${a.source} · evidence: ${a.evidence}`));
  }
  return out.join("\n");
}

export function jsonReport(result, label, version) {
  return JSON.stringify({ tool: "canimcp", version, corpus: result.corpusVersion, input: label, toolsChecked: result.toolsChecked, findings: result.findings, advisories: result.advisories }, null, 2);
}

export function githubReport({ findings }, file = "tools-list.json") {
  return findings
    .map((f) => {
      const scope = f.tool ? `tool "${f.tool}" ${f.path}` : "server";
      const msg = `[${f.rule}] ${scope}: ${f.detail} - ${f.message} Fix: ${f.fix} (${clientsLabel(f.clients)}, evidence: ${f.evidence})`;
      return `::${GH_LEVEL[f.severity]} file=${file}::${msg.replace(/[\r\n]+/g, " ")}`;
    })
    .join("\n");
}
