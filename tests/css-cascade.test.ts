import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A rule inside `@container` / `@media` loses to a LATER rule outside it with the same selector — the at-rule adds no
 * specificity. That silently disabled container queries three times (the line strip's narrow labels, the
 * stage chart button, the short-stage hand label). This test parses every stylesheet and fails when a later
 * top-level rule with an identical selector re-sets a property the conditional rule declares.
 */

interface Rule {
  selectors: string[];
  decls: Map<string, { value: string; important: boolean }>;
  /** Enclosing at-rule preludes, outermost first. */
  at: string[];
  line: number;
}

const DIR = join(__dirname, '..', 'src', 'styles');

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Index of the `}` matching the `{` at `open`, skipping quoted strings. */
function matchBrace(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const end = css.indexOf(ch, i + 1);
      i = end < 0 ? css.length : end;
    } else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return css.length;
}

function lineAt(css: string, i: number): number {
  return css.slice(0, i).split('\n').length;
}

function parseDecls(body: string): Rule['decls'] {
  const out: Rule['decls'] = new Map();
  for (const part of body.split(/;(?![^(]*\))/)) {
    const c = part.indexOf(':');
    if (c < 0) continue;
    const prop = part.slice(0, c).trim().toLowerCase();
    let value = part.slice(c + 1).trim();
    if (!prop || prop.startsWith('--')) continue;
    const important = /!important\s*$/i.test(value);
    value = value.replace(/!important\s*$/i, '').trim();
    out.set(prop, { value, important });
  }
  return out;
}

function parse(css: string, from: number, to: number, at: string[], src: string, out: Rule[]): void {
  let i = from;
  while (i < to) {
    const open = css.indexOf('{', i);
    const semi = css.indexOf(';', i);
    if (open < 0 || open >= to) break;
    // A statement at-rule (`@import …;`) before the next block.
    if (semi >= 0 && semi < open && css.slice(i, semi).trim().startsWith('@')) {
      i = semi + 1;
      continue;
    }
    const prelude = css.slice(i, open).trim();
    const close = matchBrace(css, open);
    if (prelude.startsWith('@')) {
      if (/^@(container|media|supports|layer)\b/.test(prelude)) parse(css, open + 1, close, [...at, prelude], src, out);
      // @keyframes / @font-face: no selectors to compare.
    } else if (prelude) {
      out.push({
        selectors: prelude.split(/,(?![^(]*\))/).map((s) => s.trim().replace(/\s+/g, ' ')),
        decls: parseDecls(css.slice(open + 1, close)),
        at,
        line: lineAt(src, open),
      });
    }
    i = close + 1;
  }
}

function rulesIn(src: string): Rule[] {
  const css = stripComments(src);
  const out: Rule[] = [];
  parse(css, 0, css.length, [], src, out);
  return out;
}
function rulesOf(file: string): Rule[] {
  return rulesIn(readFileSync(join(DIR, file), 'utf8'));
}

/** Longhands a later shorthand would reset. */
const SHORTHAND: Record<string, string[]> = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding-inline', 'padding-block'],
  'padding-inline': ['padding-left', 'padding-right'],
  'padding-block': ['padding-top', 'padding-bottom'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'margin-inline', 'margin-block'],
  'margin-inline': ['margin-left', 'margin-right'],
  'margin-block': ['margin-top', 'margin-bottom'],
  inset: ['top', 'right', 'bottom', 'left'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  gap: ['row-gap', 'column-gap'],
  background: ['background-color', 'background-image'],
  font: ['font-size', 'font-weight', 'line-height', 'font-family'],
  'grid-template': ['grid-template-columns', 'grid-template-rows', 'grid-template-areas'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'],
};

function overriddenBy(laterProps: Rule['decls'], prop: string): string | null {
  if (laterProps.has(prop) && !laterProps.get(prop)!.important) return prop;
  for (const [short, longs] of Object.entries(SHORTHAND)) {
    if (longs.includes(prop) && laterProps.has(short) && !laterProps.get(short)!.important) return short;
  }
  return null;
}

/** Conditional rules a later base rule re-sets: `file:line selector { prop }` (later rule at line N). */
export function shadowedConditionalRules(file: string): string[] {
  return shadowedIn(rulesOf(file), file);
}
function shadowedIn(rules: Rule[], file: string): string[] {
  const hits: string[] = [];
  rules.forEach((r, idx) => {
    if (!r.at.length) return;
    for (const later of rules.slice(idx + 1)) {
      if (later.at.length) continue;
      const shared = r.selectors.filter((s) => later.selectors.includes(s));
      if (!shared.length) continue;
      for (const [prop, d] of r.decls) {
        if (d.important) continue;
        const by = overriddenBy(later.decls, prop);
        if (!by) continue;
        if (by === prop && later.decls.get(prop)!.value === d.value) continue;
        hits.push(`${file}:${r.line} ${shared[0]} { ${prop} } ← overridden by ${by} at line ${later.line}`);
      }
    }
  });
  return hits;
}

/** Unconditional declarations a later unconditional rule with the same selector re-sets to another value — dead on
 *  arrival (a land CTA's padding fix sat above an older rule for the same button and never applied). */
export function deadBaseDecls(file: string): string[] {
  return deadIn(rulesOf(file), file);
}
function deadIn(rules: Rule[], file: string): string[] {
  const hits: string[] = [];
  rules.forEach((r, idx) => {
    if (r.at.length) return;
    for (const later of rules.slice(idx + 1)) {
      if (later.at.length) continue;
      const shared = r.selectors.filter((s) => later.selectors.includes(s));
      // only when the earlier rule is wholly that selector — a selector list can stay alive through its other members
      if (!shared.length || shared.length !== r.selectors.length) continue;
      for (const [prop, d] of r.decls) {
        if (d.important) continue;
        const by = overriddenBy(later.decls, prop);
        if (!by) continue;
        if (by === prop && later.decls.get(prop)!.value === d.value) continue;
        hits.push(`${file}:${r.line} ${shared[0]} { ${prop} } ← dead: re-set by ${by} at line ${later.line}`);
      }
    }
  });
  return hits;
}

describe('stylesheet cascade', () => {
  // fonts.css holds only @font-face blocks.
  const files = readdirSync(DIR).filter((f) => f.endsWith('.css') && f !== 'fonts.css');

  it('parses every stylesheet into rules', () => {
    for (const f of files) expect(rulesOf(f).length, f).toBeGreaterThan(0);
  });

  it('never lets a later base rule silently override a @container / @media rule with the same selector', () => {
    const hits = files.flatMap(shadowedConditionalRules);
    expect(hits).toEqual([]);
  });

  it('never declares a property that a later rule with the same selector re-sets', () => {
    const hits = files.flatMap(deadBaseDecls);
    expect(hits).toEqual([]);
  });

  it('catches a dead base declaration, and only that', () => {
    expect(deadIn(rulesIn('.a { padding-inline: 10px }\n.a { padding-inline: 14px }'), 't.css')).toEqual(['t.css:1 .a { padding-inline } ← dead: re-set by padding-inline at line 2']);
    expect(deadIn(rulesIn('.a { padding-inline: 10px }\n.a { padding: 0 }'), 't.css')).toHaveLength(1);
    expect(deadIn(rulesIn('.a { color: red }\n.a { color: red }'), 't.css')).toEqual([]);
    expect(deadIn(rulesIn('.a, .b { color: red }\n.a { color: blue }'), 't.css')).toEqual([]);
    expect(deadIn(rulesIn('.a { color: red }\n@media (min-width: 1px) { .a { color: blue } }'), 't.css')).toEqual([]);
  });

  it('catches the pattern it guards against', () => {
    const css = '@container x (max-width: 10px) { .a { font-size: 9px } }\n.a { font-size: 11px }';
    const rules = rulesIn(css);
    expect(rules).toHaveLength(2);
    expect(rules[0].at).toEqual(['@container x (max-width: 10px)']);
    expect(rules[1].decls.get('font-size')?.value).toBe('11px');
    expect(shadowedIn(rules, 't.css')).toEqual(['t.css:1 .a { font-size } ← overridden by font-size at line 2']);
    // a later shorthand resets the longhand too
    expect(shadowedIn(rulesIn('@media (min-width: 1px) { .b { padding-top: 4px } }\n.b { padding: 0 }'), 't.css')).toHaveLength(1);
  });

  it('lets the conditional rule stand when it comes last, or the later rule agrees, or wins with !important', () => {
    expect(shadowedIn(rulesIn('.a { font-size: 11px }\n@container x (max-width: 10px) { .a { font-size: 9px } }'), 't.css')).toEqual([]);
    expect(shadowedIn(rulesIn('@container x (max-width: 10px) { .a { font-size: 9px } }\n.a { font-size: 9px }'), 't.css')).toEqual([]);
    expect(shadowedIn(rulesIn('@container x (max-width: 10px) { .a { font-size: 9px !important } }\n.a { font-size: 11px }'), 't.css')).toEqual([]);
    // a different selector (here: higher specificity) is out of scope
    expect(shadowedIn(rulesIn('@container x (max-width: 10px) { .a { font-size: 9px } }\n.p .a { font-size: 11px }'), 't.css')).toEqual([]);
  });
});
