/**
 * A small YAML-frontmatter reader/writer for VKF cards.
 *
 * VKF objects are markdown files with a YAML frontmatter block (see the VKF spec
 * and `templates/` in the Verifiable-Knowledge-Format repo). We *write* every card
 * ourselves, so the cards we produce only use a controlled subset of YAML —
 * scalars, block/flow lists, and nested maps. This module parses that subset and
 * emits it canonically, with no external dependency, so it can be unit-tested
 * without the pi runtime.
 *
 * For anything beyond our own cards (validation, the typed graph, freshness) we
 * defer to the real `vkf` CLI via {@link ./vkf.ts} rather than trusting this
 * parser — it is deliberately small, not a full YAML implementation.
 */

export type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };

export interface ParsedCard {
  /** Parsed frontmatter mapping. */
  data: Record<string, YamlValue>;
  /** Everything after the closing `---`, verbatim. */
  body: string;
}

const FENCE = "---";

/** Split a card into `{ data, body }`. Throws if no frontmatter fence is found. */
export function parseFrontmatter(text: string): ParsedCard {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(FENCE + "\n") && normalized.trimStart().startsWith(FENCE)) {
    // tolerate a leading blank line
  }
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== FENCE) {
    throw new Error("card has no YAML frontmatter (expected a leading '---')");
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === FENCE) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error("unterminated YAML frontmatter (no closing '---')");

  const fmLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n");
  const data = parseBlockMap(stripStructuralComments(fmLines), 0).value;
  return { data, body };
}

/** Drop blank lines and full-line comments; keep everything else verbatim. */
function stripStructuralComments(lines: string[]): string[] {
  return lines.filter((l) => {
    const t = l.trim();
    return t.length > 0 && !t.startsWith("#");
  });
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

interface Cursor<T> {
  value: T;
  /** Index of the first line not consumed by this block. */
  next: number;
}

function parseBlockMap(
  lines: string[],
  indent: number,
  start = 0,
): Cursor<Record<string, YamlValue>> {
  const map: Record<string, YamlValue> = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) throw new Error(`unexpected indentation in frontmatter: "${line}"`);

    const content = line.trim();
    const colon = findKeyColon(content);
    if (colon === -1) throw new Error(`expected "key: value" in frontmatter: "${line}"`);
    const key = content.slice(0, colon).trim();
    const rest = content.slice(colon + 1).trim();

    if (rest === "") {
      // Either a nested map/list on following deeper lines, or an empty value.
      const childIndent = i + 1 < lines.length ? indentOf(lines[i + 1]!) : indent;
      if (i + 1 < lines.length && childIndent > indent) {
        if (lines[i + 1]!.trim().startsWith("- ")) {
          const list = parseBlockList(lines, childIndent, i + 1);
          map[key] = list.value;
          i = list.next;
        } else {
          const child = parseBlockMap(lines, childIndent, i + 1);
          map[key] = child.value;
          i = child.next;
        }
      } else {
        map[key] = null;
        i += 1;
      }
    } else {
      map[key] = parseScalarOrFlow(rest);
      i += 1;
    }
  }
  return { value: map, next: i };
}

function parseBlockList(lines: string[], indent: number, start: number): Cursor<YamlValue[]> {
  const list: YamlValue[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) throw new Error(`unexpected indentation in list: "${line}"`);
    const content = line.trim();
    if (!content.startsWith("- ")) break;
    const item = content.slice(2).trim();
    const inlineColon = findKeyColon(item);
    if (inlineColon !== -1) {
      // A list of maps; the first key sits on the dash line, the rest are deeper.
      const firstKey = item.slice(0, inlineColon).trim();
      const firstVal = item.slice(inlineColon + 1).trim();
      const obj: Record<string, YamlValue> = {};
      obj[firstKey] = firstVal === "" ? null : parseScalarOrFlow(firstVal);
      // Continuation lines for this map item are indented deeper than the dash.
      const contIndent = indent + 2;
      let j = i + 1;
      const cont: string[] = [];
      while (j < lines.length && indentOf(lines[j]!) >= contIndent && !lines[j]!.trim().startsWith("- ")) {
        cont.push(lines[j]!);
        j++;
      }
      if (cont.length) {
        const sub = parseBlockMap(cont, indentOf(cont[0]!), 0);
        Object.assign(obj, sub.value);
      }
      list.push(obj);
      i = j;
    } else {
      list.push(parseScalarOrFlow(item));
      i += 1;
    }
  }
  return { value: list, next: i };
}

/** Locate the colon that separates a key from its value (ignores `://` in URLs). */
function findKeyColon(s: string): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ":" && (i + 1 >= s.length || s[i + 1] === " ")) return i;
  }
  return -1;
}

function parseScalarOrFlow(raw: string): YamlValue {
  const s = raw.trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (inner === "") return [];
    return splitFlow(inner).map(parseScalar);
  }
  return parseScalar(s);
}

function splitFlow(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseScalar(s: string): YamlValue {
  const t = s.trim();
  if (t === "" || t === "~" || t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d*\.\d+$/.test(t)) return Number(t);
  return t;
}

// ── serialization ────────────────────────────────────────────────────────────

/** Emit a value as canonical block YAML at the given indent level. */
function emit(key: string, value: YamlValue, indent: number): string[] {
  const pad = " ".repeat(indent);
  if (value === null || value === undefined) return [`${pad}${key}:`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}${key}: []`];
    const lines = [`${pad}${key}:`];
    for (const item of value) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item);
        entries.forEach(([k, v], idx) => {
          if (idx === 0) lines.push(`${pad}  - ${k}: ${scalarStr(v as YamlValue)}`);
          else lines.push(`${pad}    ${k}: ${scalarStr(v as YamlValue)}`);
        });
      } else {
        lines.push(`${pad}  - ${scalarStr(item)}`);
      }
    }
    return lines;
  }
  if (typeof value === "object") {
    const lines = [`${pad}${key}:`];
    for (const [k, v] of Object.entries(value)) lines.push(...emit(k, v, indent + 2));
    return lines;
  }
  return [`${pad}${key}: ${scalarStr(value)}`];
}

/** Render a scalar, quoting when needed to stay valid YAML. */
function scalarStr(value: YamlValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  const s = String(value);
  const needsQuote =
    s === "" ||
    /^[\s]|[\s]$/.test(s) ||
    /[:#]/.test(s) ||
    /^[-?&*!|>%@`"']/.test(s) ||
    ["true", "false", "null", "~"].includes(s);
  if (needsQuote) return JSON.stringify(s);
  return s;
}

/** Serialize a frontmatter mapping to canonical block YAML (no fences). */
export function stringifyFrontmatter(data: Record<string, YamlValue>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(data)) lines.push(...emit(k, v, 0));
  return lines.join("\n");
}

/** Assemble a complete card: `--- <frontmatter> --- <body>`. */
export function assembleCard(data: Record<string, YamlValue>, body: string): string {
  const fm = stringifyFrontmatter(data);
  const trimmedBody = body.replace(/^\n+/, "").replace(/\s+$/, "");
  return `${FENCE}\n${fm}\n${FENCE}\n\n${trimmedBody}\n`;
}
