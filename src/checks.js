// Detector families interpreted from corpus.json `detect` descriptors.
// The corpus is the product: rules carry provenance, checks only evaluate them.
import corpus from "./corpus.json" with { type: "json" };

const SEV_ORDER = { error: 3, warn: 2, advisory: 1 };

export function loadCorpus() {
  return corpus;
}

// Resolve local #/$defs and #/definitions refs inside one schema document.
// Cycles are left untouched; external refs are left untouched.
export function resolveRefs(schema) {
  const root = schema && typeof schema === "object" ? schema : {};
  const seen = new WeakSet();
  const walk = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return node;
    seen.add(node);
    if (typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
      const target = node.$ref.slice(2).split("/").reduce((o, k) => o?.[k], root);
      if (target && target !== node) return walk({ ...target, ...Object.fromEntries(Object.entries(node).filter(([k]) => k !== "$ref")) });
    }
    const out = Array.isArray(node) ? [] : {};
    for (const [k, v] of Object.entries(node)) out[k] = walk(v);
    return out;
  };
  return walk(schema);
}

// Yield {path, node} for every property in a schema tree.
function* walkProps(node, path = "") {
  if (!node || typeof node !== "object") return;
  if (node.properties && typeof node.properties === "object") {
    for (const [name, sub] of Object.entries(node.properties)) {
      const p = path ? `${path}.${name}` : name;
      yield { path: p, name, node: sub };
      yield* walkProps(sub, p);
    }
  }
  for (const key of ["items", "additionalProperties", "contains"]) {
    if (node[key] && typeof node[key] === "object") yield* walkProps(node[key], `${path}${key === "items" ? "[]" : `(${key})`}`);
  }
  for (const key of ["prefixItems", "allOf", "anyOf", "oneOf"]) {
    const v = node[key];
    if (Array.isArray(v)) for (const sub of v) yield* walkProps(sub, path);
  }
}

// Deep search: does any descendant object hold `keyword`?
function hasKeyword(node, keyword, inside = false) {
  if (!node || typeof node !== "object") return false;
  if (!Array.isArray(node) && keyword in node) return true;
  for (const v of Object.values(node)) {
    if (v && typeof v === "object" && hasKeyword(v, keyword, inside)) return true;
  }
  return false;
}

// Does `enum` appear inside an anyOf/oneOf subtree anywhere?
function enumInComposition(node) {
  if (!node || typeof node !== "object") return false;
  for (const comp of ["anyOf", "oneOf"]) {
    const v = node[comp];
    if (Array.isArray(v) && v.some((sub) => hasKeyword(sub, "enum"))) return true;
  }
  for (const v of Object.values(node)) {
    if (v && typeof v === "object" && enumInComposition(v)) return true;
  }
  return false;
}

const normalizeName = (n) => String(n).toLowerCase().replace(/[^a-z0-9]/g, "");

const families = {
  "arg-name-pattern"(tools, rule) {
    const re = new RegExp(rule.detect.pattern);
    const out = [];
    for (const t of tools) {
      const schema = resolveRefs(t.inputSchema);
      for (const { path, name } of walkProps(schema)) {
        if (re.test(name)) out.push({ tool: t.name, path: `inputSchema.properties.${path}`, detail: `argument "${name}"` });
      }
    }
    return out;
  },

  "tool-count"(tools, rule) {
    return tools.length > rule.detect.max ? [{ tool: null, path: "tools", detail: `${tools.length} tools on this server` }] : [];
  },

  "schema-bytes"(tools, rule) {
    const out = [];
    for (const t of tools) {
      const bytes = Buffer.byteLength(JSON.stringify(t.inputSchema || {}));
      if (bytes > rule.detect.bytes) out.push({ tool: t.name, path: "inputSchema", detail: `${(bytes / 1024).toFixed(1)} KB schema` });
    }
    return out;
  },

  "enum-in-composition"(tools, rule) {
    const out = [];
    for (const t of tools) {
      const schema = resolveRefs(t.inputSchema);
      const bytes = Buffer.byteLength(JSON.stringify(schema || {}));
      if (bytes > rule.detect.minSchemaBytes && enumInComposition(schema)) {
        out.push({ tool: t.name, path: "inputSchema", detail: `enum inside anyOf/oneOf, ${(bytes / 1024).toFixed(1)} KB schema` });
      }
    }
    return out;
  },

  "structure-has"(tools, rule) {
    const out = [];
    for (const t of tools) {
      const schema = resolveRefs(t.inputSchema);
      if (hasKeyword(schema, rule.detect.keyword)) out.push({ tool: t.name, path: "inputSchema", detail: `uses ${rule.detect.keyword}` });
    }
    return out;
  },

  "int64-arg"(tools, rule) {
    const SAFE = Number.MAX_SAFE_INTEGER;
    const out = [];
    for (const t of tools) {
      const schema = resolveRefs(t.inputSchema);
      for (const { path, name, node } of walkProps(schema)) {
        if (!node || node.type !== "integer") continue;
        const fmt = typeof node.format === "string" && /u?int64/.test(node.format);
        const wide = (typeof node.maximum === "number" && Math.abs(node.maximum) > SAFE)
          || (typeof node.minimum === "number" && Math.abs(node.minimum) > SAFE)
          || (typeof node.exclusiveMaximum === "number" && Math.abs(node.exclusiveMaximum) > SAFE)
          || (typeof node.exclusiveMinimum === "number" && Math.abs(node.exclusiveMinimum) > SAFE);
        if (fmt || wide) out.push({ tool: t.name, path: `inputSchema.properties.${path}`, detail: fmt ? `integer "${name}" format ${node.format}` : `integer "${name}" allows values beyond 2^53` });
      }
    }
    return out;
  },

  "name-collision"(tools, rule) {
    const byNorm = new Map();
    for (const t of tools) {
      const n = normalizeName(t.name);
      if (!byNorm.has(n)) byNorm.set(n, []);
      byNorm.get(n).push(t.name);
    }
    const out = [];
    for (const names of byNorm.values()) {
      if (names.length > 1) out.push({ tool: names[0], path: "tools", detail: `${names.map((n) => `"${n}"`).join(" and ")} normalize the same` });
    }
    return out;
  },

  "missing-root-type"(tools, rule) {
    return tools.filter((t) => t.inputSchema && typeof t.inputSchema === "object" && t.inputSchema.type === undefined)
      .map((t) => ({ tool: t.name, path: "inputSchema", detail: "no root \"type\"" }));
  },

  "root-composition"(tools, rule) {
    const out = [];
    for (const t of tools) {
      const s = resolveRefs(t.inputSchema);
      if (!s || typeof s !== "object") continue;
      const comp = (Array.isArray(s.oneOf) && "oneOf") || (Array.isArray(s.anyOf) && "anyOf");
      if (comp && s.properties && typeof s.properties === "object") {
        out.push({ tool: t.name, path: "inputSchema", detail: `root ${comp} sits next to "properties"` });
      }
    }
    return out;
  },

  "outputschema-present"(tools, rule) {
    return tools.filter((t) => t.outputSchema && typeof t.outputSchema === "object")
      .map((t) => ({ tool: t.name, path: "outputSchema", detail: "declares outputSchema" }));
  },

  "name-charset"(tools, rule) {
    const re = new RegExp(rule.detect.pattern);
    const out = [];
    for (const t of tools) {
      const name = String(t.name || "");
      if (name.length > rule.detect.maxLen) out.push({ tool: t.name, path: "name", detail: `${name.length} chars` });
      else if (!re.test(name)) out.push({ tool: t.name, path: "name", detail: "non [A-Za-z0-9_-] characters" });
    }
    return out;
  },
};

function clientMatches(rule, client) {
  if (!client) return true;
  return Object.keys(rule.clients || {}).includes(client) || Object.keys(rule.clients || {}).length === 0;
}

// tools: [{name, inputSchema, outputSchema?}]  opts: {client}
// returns {findings, advisories, rulesRun}
export function runChecks(tools, opts = {}) {
  const findings = [];
  for (const rule of corpus.rules) {
    if (rule.detect && !families[rule.detect.family]) continue;
    if (!clientMatches(rule, opts.client)) continue;
    if (!rule.detect) continue;
    for (const hit of families[rule.detect.family](tools, rule)) {
      findings.push({
        rule: rule.id,
        title: rule.title,
        severity: rule.severity,
        clients: rule.clients,
        evidence: rule.evidence,
        source: rule.source,
        tool: hit.tool,
        path: hit.path,
        detail: hit.detail,
        message: rule.message,
        fix: rule.fix,
      });
    }
  }
  findings.sort((a, b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity] || String(a.tool).localeCompare(String(b.tool)));
  const advisories = corpus.advisories.filter((a) => clientMatches(a, opts.client));
  return { findings, advisories, toolsChecked: tools.length, corpusVersion: corpus.version };
}
