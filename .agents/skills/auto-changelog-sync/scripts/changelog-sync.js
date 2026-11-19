#!/usr/bin/env node
/**
 * changelog-sync.js
 * Helper script for the auto-changelog-sync skill.
 *
 * Usage:
 *   node .agents/skills/auto-changelog-sync/scripts/changelog-sync.js status
 *     -> Inspects working tree changes and audits undocumented environment variables.
 *
 *   node .agents/skills/auto-changelog-sync/scripts/changelog-sync.js range <base_ref> [head_ref]
 *     -> Extracts structured commit history between two Git tags/refs as JSON.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function runGit(args) {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return '';
  }
}

function getRepoUrl() {
  const remote = runGit('config --get remote.origin.url');
  if (!remote) return null;
  return remote
    .replace(/^git@github\.com:/, '[https://github.com/](https://github.com/)')
    .replace(/\.git$/, '');
}

function scanMissingEnvVars(modifiedFiles) {
  const envExamplePath = path.resolve(process.cwd(), '.env.example');
  const documentedKeys = new Set();

  if (fs.existsSync(envExamplePath)) {
    const content = fs.readFileSync(envExamplePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
      if (match) documentedKeys.add(match[1]);
    }
  }

  const referencedKeys = new Set();
  const envRegexes = [
    /process\.env\.([A-Z0-9_]+)/g,
    /import\.meta\.env\.([A-Z0-9_]+)/g,
    /os\.getenv\(\s*['"]([A-Z0-9_]+)['"]/g,
    /env\(\s*['"]([A-Z0-9_]+)['"]/g
  ];

  for (const file of modifiedFiles) {
    const fullPath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) continue;
    if (file.startsWith('.env') || file.endsWith('.md') || file.endsWith('.lock')) continue;

    try {
      const code = fs.readFileSync(fullPath, 'utf8');
      for (const regex of envRegexes) {
        let match;
        while ((match = regex.exec(code)) !== null) {
          referencedKeys.add(match[1]);
        }
      }
    } catch (_) {
      // Skip binary or unreadable files
    }
  }

  const missingInEnvExample = [...referencedKeys].filter((k) => !documentedKeys.has(k));
  return {
    envExampleExists: fs.existsSync(envExamplePath),
    referencedKeys: [...referencedKeys],
    missingInEnvExample
  };
}

function handleStatus() {
  const statusRaw = runGit('status --porcelain');
  const files = statusRaw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim(),
      file: line.slice(3).trim()
    }));

  const modifiedFilePaths = files.map((f) => f.file);
  const diffStat = runGit('diff HEAD --stat');
  const envAudit = scanMissingEnvVars(modifiedFilePaths);

  const output = {
    mode: 'working_tree_status',
    date: new Date().toISOString().split('T')[0],
    repoUrl: getRepoUrl(),
    hasChangelog: fs.existsSync(path.resolve(process.cwd(), 'CHANGELOG.md')),
    changedFiles: files,
    diffStat,
    envAudit
  };

  console.log(JSON.stringify(output, null, 2));
}

function handleRange(baseRef, headRef = 'HEAD') {
  if (!baseRef) {
    console.error('Usage: node changelog-sync.js range <base_ref> [head_ref]');
    process.exit(1);
  }

  const format = '%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1f%b%x1e';
  const rawLog = runGit(`log ${baseRef}..${headRef} --date=short --pretty=format:"${format}"`);

  const commits = rawLog
    .split('\x1e')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, shortHash, author, date, subject, body = ''] = entry.split('\x1f');
      const prMatches = [...(subject + ' ' + body).matchAll(/#(\d+)/g)].map((m) => m[1]);
      return {
        hash,
        shortHash,
        author,
        date,
        subject: subject.trim(),
        body: body.trim(),
        prs: [...new Set(prMatches)]
      };
    });

  const output = {
    mode: 'commit_range',
    baseRef,
    headRef,
    date: new Date().toISOString().split('T')[0],
    repoUrl: getRepoUrl(),
    totalCommits: commits.length,
    commits
  };

  console.log(JSON.stringify(output, null, 2));
}

const [, , command, arg1, arg2] = process.argv;

if (command === 'range') {
  handleRange(arg1, arg2);
} else {
  handleStatus();
}