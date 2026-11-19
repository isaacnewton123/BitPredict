#!/usr/bin/env node
/**
 * design-sync.js
 * Zero-dependency Design System compiler & UI auditor for DESIGN.md.
 *
 * Commands:
 *   node .agents/skills/design-system-sync/scripts/design-sync.js build [designMdPath] [outDir]
 *     -> Compiles DESIGN.md frontmatter into:
 *        - <outDir>/design-tokens.css
 *        - <outDir>/tailwind.design-preset.js
 *        - <outDir>/design-tokens.json
 *
 *   node .agents/skills/design-system-sync/scripts/design-sync.js audit [targetDir] [designMdPath] [--strict]
 *     -> Audits UI files (.css, .scss, .tsx, .jsx, .ts, .js, .vue, .html) against DESIGN.md rules.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 1. Minimal YAML Frontmatter Parser (supports nested indentation)
// ---------------------------------------------------------------------------

function parseScalar(raw) {
  let val = raw.trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  return val;
}

function parseDesignFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    throw new Error('YAML frontmatter (--- ... ---) not found in DESIGN.md');
  }

  const lines = match[1].split(/\r?\n/);
  const root = {};
  const stack = [{ indent: -1, obj: root }];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.match(/^(\s*)/)[1].length;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawVal = trimmed.slice(colonIdx + 1).trim();

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    if (rawVal === '') {
      parent[key] = {};
      stack.push({ indent, obj: parent[key] });
    } else {
      parent[key] = parseScalar(rawVal);
    }
  }

  return root;
}

function resolveValue(val, tokens) {
  if (typeof val !== 'string') return val;

  // Exact object reference, e.g. "{typography.body}"
  if (val.startsWith('{') && val.endsWith('}')) {
    const inner = val.slice(1, -1);
    const parts = inner.split('.');
    if (parts.length === 2 && !inner.includes('{') && !inner.includes('}')) {
      const section = parts[0];
      const key = parts[1];
      if (tokens[section] && tokens[section][key] !== undefined) {
        return tokens[section][key];
      }
    }
  }

  // Inline token interpolation, e.g. "{spacing.sm} {spacing.md}"
  return val.replace(/\{([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\}/g, function (full, section, key) {
    const found = tokens[section] && tokens[section][key];
    return typeof found === 'string' || typeof found === 'number' ? String(found) : full;
  });
}

function resolveAllComponents(tokens) {
  const resolved = {};
  const components = tokens.components || {};

  for (const [compName, props] of Object.entries(components)) {
    resolved[compName] = {};
    for (const [propKey, propVal] of Object.entries(props)) {
      resolved[compName][propKey] = resolveValue(propVal, tokens);
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// 2. Output Generators (CSS, Tailwind Preset, JSON)
// ---------------------------------------------------------------------------

function generateCSS(tokens, resolvedComponents) {
  const lines = [];
  const colors = tokens.colors || {};
  const typography = tokens.typography || {};
  const rounded = tokens.rounded || {};
  const spacing = tokens.spacing || {};

  const primaryFont = (typography.body && typography.body.fontFamily) || 'Inter';
  const weights = [
    ...new Set(
      Object.values(typography)
        .map(function (t) {
          return String(t.fontWeight);
        })
        .filter(Boolean)
    )
  ].sort();

  lines.push(
    '/* AUTO-GENERATED FROM DESIGN.md (' + (tokens.name || 'Design System') + ') - DO NOT EDIT MANUALLY */'
  );
  lines.push(
    "@import url('https://fonts.googleapis.com/css2?family=" +
      encodeURIComponent(primaryFont) +
      ':wght@' +
      weights.join(';') +
      "&display=swap');"
  );
  lines.push('');
  lines.push(':root {');

  lines.push('  /* Colors */');
  for (const [k, v] of Object.entries(colors)) {
    lines.push('  --color-' + k + ': ' + v + ';');
  }

  lines.push('');
  lines.push('  /* Typography */');
  lines.push("  --font-sans: '" + primaryFont + "', -apple-system, BlinkMacSystemFont, sans-serif;");
  for (const [k, t] of Object.entries(typography)) {
    lines.push('  --text-' + k + '-size: ' + t.fontSize + ';');
    lines.push('  --text-' + k + '-weight: ' + t.fontWeight + ';');
    lines.push('  --text-' + k + '-lh: ' + t.lineHeight + ';');
    lines.push('  --text-' + k + '-ls: ' + t.letterSpacing + ';');
  }

  lines.push('');
  lines.push('  /* Border Radius */');
  for (const [k, v] of Object.entries(rounded)) {
    lines.push('  --radius-' + k + ': ' + v + ';');
  }

  lines.push('');
  lines.push('  /* Spacing */');
  for (const [k, v] of Object.entries(spacing)) {
    lines.push('  --space-' + k + ': ' + v + ';');
  }

  lines.push('');
  lines.push('  /* Elevation */');
  lines.push('  --shadow-floating: 0 12px 32px rgba(0, 0, 0, 0.4);');
  lines.push('}');
  lines.push('');

  // Base Canvas Reset
  lines.push('/* Base Surface & Typography Defaults */');
  lines.push('html, body {');
  lines.push('  background-color: var(--color-canvas);');
  lines.push('  color: var(--color-ink);');
  lines.push('  font-family: var(--font-sans);');
  lines.push('  font-size: var(--text-body-size);');
  lines.push('  font-weight: var(--text-body-weight);');
  lines.push('  line-height: var(--text-body-lh);');
  lines.push('  -webkit-font-smoothing: antialiased;');
  lines.push('}');
  lines.push('');

  // Typography Utility Classes
  lines.push('/* Typography Scale */');
  for (const [k] of Object.entries(typography)) {
    lines.push('.ds-text-' + k + ' {');
    lines.push('  font-family: var(--font-sans);');
    lines.push('  font-size: var(--text-' + k + '-size);');
    lines.push('  font-weight: var(--text-' + k + '-weight);');
    lines.push('  line-height: var(--text-' + k + '-lh);');
    lines.push('  letter-spacing: var(--text-' + k + '-ls);');
    lines.push('}');
  }
  lines.push('');

  // Component Primitive Classes (excluding illustrative ex-* surfaces)
  lines.push('/* Core Component Primitives */');
  for (const [compName, props] of Object.entries(resolvedComponents)) {
    if (compName.startsWith('ex-')) continue;

    lines.push('.ds-' + compName + ' {');
    if (props.backgroundColor) lines.push('  background-color: ' + props.backgroundColor + ';');
    if (props.textColor) lines.push('  color: ' + props.textColor + ';');
    if (props.borderColor) lines.push('  border: 1px solid ' + props.borderColor + ';');
    if (props.rounded) lines.push('  border-radius: ' + props.rounded + ';');
    if (props.padding) lines.push('  padding: ' + props.padding + ';');

    if (props.typography && typeof props.typography === 'object') {
      lines.push("  font-family: '" + props.typography.fontFamily + "', sans-serif;");
      lines.push('  font-size: ' + props.typography.fontSize + ';');
      lines.push('  font-weight: ' + props.typography.fontWeight + ';');
      lines.push('  line-height: ' + props.typography.lineHeight + ';');
      lines.push('  letter-spacing: ' + props.typography.letterSpacing + ';');
    }

    if (compName === 'feature-card' || compName === 'text-input' || compName === 'pill-outline') {
      lines.push('  border: 1px solid var(--color-hairline);');
    }
    if (compName === 'feature-card-elevated') {
      lines.push('  box-shadow: var(--shadow-floating);');
    }
    if (compName === 'game-tile') {
      lines.push('  overflow: hidden;');
      lines.push('  padding: 0;');
    }
    if (compName.startsWith('button-') || compName === 'bet-odds-button') {
      lines.push('  display: inline-flex;');
      lines.push('  align-items: center;');
      lines.push('  justify-content: center;');
      lines.push('  cursor: pointer;');
      lines.push('  border: none;');
    }
    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}

function generateTailwindPreset(tokens) {
  const typography = tokens.typography || {};
  const primaryFont = (typography.body && typography.body.fontFamily) || 'Inter';

  const fontSize = {};
  for (const [k, t] of Object.entries(typography)) {
    fontSize['ds-' + k] = [
      t.fontSize,
      {
        lineHeight: String(t.lineHeight),
        fontWeight: String(t.fontWeight),
        letterSpacing: String(t.letterSpacing)
      }
    ];
  }

  const presetObj = {
    theme: {
      extend: {
        colors: tokens.colors || {},
        fontFamily: {
          sans: [primaryFont, 'sans-serif']
        },
        fontSize: fontSize,
        borderRadius: tokens.rounded || {},
        spacing: tokens.spacing || {},
        boxShadow: {
          floating: '0 12px 32px rgba(0, 0, 0, 0.4)'
        }
      }
    }
  };

  return (
    '// AUTO-GENERATED FROM DESIGN.md (' +
    (tokens.name || 'Design System') +
    ') - DO NOT EDIT MANUALLY\nmodule.exports = ' +
    JSON.stringify(presetObj, null, 2) +
    ';\n'
  );
}

function handleBuild(designMdPath, outDir) {
  const mdPath = designMdPath || 'DESIGN.md';
  const targetOutDir = outDir || 'src/styles';
  const resolvedMd = path.resolve(process.cwd(), mdPath);

  if (!fs.existsSync(resolvedMd)) {
    console.error('Error: ' + resolvedMd + ' not found.');
    process.exit(1);
  }

  const markdown = fs.readFileSync(resolvedMd, 'utf8');
  const tokens = parseDesignFrontmatter(markdown);
  const resolvedComponents = resolveAllComponents(tokens);

  const resolvedOutDir = path.resolve(process.cwd(), targetOutDir);
  fs.mkdirSync(resolvedOutDir, { recursive: true });

  const cssPath = path.join(resolvedOutDir, 'design-tokens.css');
  const twPath = path.join(resolvedOutDir, 'tailwind.design-preset.js');
  const jsonPath = path.join(resolvedOutDir, 'design-tokens.json');

  fs.writeFileSync(cssPath, generateCSS(tokens, resolvedComponents), 'utf8');
  fs.writeFileSync(twPath, generateTailwindPreset(tokens), 'utf8');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(Object.assign({}, tokens, { components: resolvedComponents }), null, 2),
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        status: 'built',
        source: mdPath,
        outputs: [
          path.relative(process.cwd(), cssPath),
          path.relative(process.cwd(), twPath),
          path.relative(process.cwd(), jsonPath)
        ]
      },
      null,
      2
    )
  );
}

// ---------------------------------------------------------------------------
// 3. UI Codebase Auditor
// ---------------------------------------------------------------------------

function normalizeHex(hex) {
  const h = hex.toLowerCase();
  if (h.length === 4) {
    return '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  return h;
}

function walkFiles(dir, collected) {
  const list = collected || [];
  const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.agents']);
  const allowedExts = new Set(['.css', '.scss', '.tsx', '.jsx', '.ts', '.js', '.vue', '.html']);

  if (!fs.existsSync(dir)) return list;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoreDirs.has(entry.name)) walkFiles(full, list);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (
        allowedExts.has(ext) &&
        !entry.name.startsWith('design-tokens.') &&
        entry.name !== 'tailwind.design-preset.js'
      ) {
        list.push(full);
      }
    }
  }
  return list;
}

function handleAudit(targetDir, designMdPath, strict) {
  const dirToScan = targetDir || 'src';
  const mdPath = designMdPath || 'DESIGN.md';
  const resolvedMd = path.resolve(process.cwd(), mdPath);

  if (!fs.existsSync(resolvedMd)) {
    console.error('Error: ' + resolvedMd + ' not found.');
    process.exit(1);
  }

  const tokens = parseDesignFrontmatter(fs.readFileSync(resolvedMd, 'utf8'));
  const allowedColors = new Set(
    Object.values(tokens.colors || {}).map(function (c) {
      return normalizeHex(String(c));
    })
  );
  const allowedWeights = new Set(
    Object.values(tokens.typography || {}).map(function (t) {
      return Number(t.fontWeight);
    })
  );
  const minWeight = Math.min.apply(null, Array.from(allowedWeights));

  const files = walkFiles(path.resolve(process.cwd(), dirToScan));
  const violations = [];

  for (const file of files) {
    const relFile = path.relative(process.cwd(), file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

    lines.forEach(function (line, idx) {
      const lineNum = idx + 1;
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;

      // Rule 1: Unauthorized hex colors outside DESIGN.md palette
      const hexMatches = line.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g);
      for (const m of hexMatches) {
        const normalized = normalizeHex(m[0]);
        if (!allowedColors.has(normalized)) {
          violations.push({
            file: relFile,
            line: lineNum,
            rule: 'unauthorized-color',
            found: m[0],
            message: 'Color ' + m[0] + ' is not in DESIGN.md palette. Use CSS vars or palette tokens only.'
          });
        }
      }

      // Rule 2: Forbidden light/regular font weights (< minWeight, e.g. 400)
      const cssWeightMatch = line.match(/font-weight\s*:\s*(\d{3})/);
      if (cssWeightMatch && Number(cssWeightMatch[1]) < minWeight) {
        violations.push({
          file: relFile,
          line: lineNum,
          rule: 'forbidden-font-weight',
          found: cssWeightMatch[1],
          message:
            'Font weight ' +
            cssWeightMatch[1] +
            ' violates heavy-weight typography rule (allowed: ' +
            Array.from(allowedWeights).join(', ') +
            ').'
        });
      }

      const twWeightMatch = line.match(/\bfont-(thin|extralight|light|normal|medium)\b/);
      if (twWeightMatch) {
        violations.push({
          file: relFile,
          line: lineNum,
          rule: 'forbidden-font-weight',
          found: twWeightMatch[0],
          message:
            'Class "' +
            twWeightMatch[0] +
            '" is disallowed. Use font-semibold (600) or font-extrabold (800).'
        });
      }

      // Rule 3: Heavy drop shadows instead of flat surface ladder
      const heavyShadowMatch = line.match(/\bshadow-(lg|xl|2xl)\b/);
      if (heavyShadowMatch) {
        violations.push({
          file: relFile,
          line: lineNum,
          rule: 'heavy-shadow-warning',
          found: heavyShadowMatch[0],
          message:
            'Avoid heavy drop shadows (' +
            heavyShadowMatch[0] +
            '). Build depth with canvas -> surface + hairline border.'
        });
      }
    });
  }

  const report = {
    status: violations.length === 0 ? 'pass' : 'violations_found',
    scannedFiles: files.length,
    totalViolations: violations.length,
    violations: violations
  };

  console.log(JSON.stringify(report, null, 2));
  if (strict && violations.length > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI Entrypoint
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0] || 'build';
const strictFlag = args.includes('--strict');
const positional = args.slice(1).filter(function (a) {
  return !a.startsWith('--');
});

if (command === 'audit') {
  handleAudit(positional[0] || 'src', positional[1] || 'DESIGN.md', strictFlag);
} else {
  handleBuild(positional[0] || 'DESIGN.md', positional[1] || 'src/styles');
}