#!/usr/bin/env node
//
// Counts skipped/flaky tests in a checked-out repo and merges the result
// into a data.json file used by the static dashboard.
//
// Usage (from GitHub Action):
//   node count-and-update.js <repo-checkout-path> <data-json-path> <branch>
//
// Example:
//   node count-and-update.js ./wix-data-client ./public/data.json master

const fs = require('fs');
const path = require('path');

const SKIP_PATTERN = /\b(it|test|describe)\.(skip|flaky)\s*\(/g;
const TEST_PATTERN = /\b(it|test|describe)\s*\(/g;
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

function walkFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      results.push(...walkFiles(full));
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

function countMatches(content, regex) {
  const m = content.match(regex);
  return m ? m.length : 0;
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const repoPath = process.argv[2];
const dataJsonPath = process.argv[3];
const branch = process.argv[4] || 'master';

if (!repoPath || !dataJsonPath) {
  console.error('Usage: node count-and-update.js <repo-path> <data-json-path> [branch]');
  process.exit(1);
}

// ── Count ─────────────────────────────────────────────────────────────────────
const files = walkFiles(repoPath);
let totalTests = 0;
let skippedCount = 0;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  skippedCount += countMatches(content, new RegExp(SKIP_PATTERN.source, 'g'));
  totalTests += countMatches(content, new RegExp(TEST_PATTERN.source, 'g'));
}

const date = new Date().toISOString().slice(0, 10);

console.log(`Date:           ${date}`);
console.log(`Branch:         ${branch}`);
console.log(`Files scanned:  ${files.length}`);
console.log(`Total tests:    ${totalTests}`);
console.log(`Skipped/flaky:  ${skippedCount}`);

// ── Merge into data.json ──────────────────────────────────────────────────────
let data;
try {
  data = JSON.parse(fs.readFileSync(dataJsonPath, 'utf8'));
} catch {
  data = { repo: 'wix-data-client', updated_at: '', entries: [] };
}

// Upsert: replace existing entry for same date+branch, or append
const existingIdx = data.entries.findIndex(e => e.date === date && e.branch === branch);
const entry = { date, branch, total_tests: totalTests, skipped_count: skippedCount };

if (existingIdx >= 0) {
  data.entries[existingIdx] = entry;
} else {
  data.entries.push(entry);
}

// Sort by date ascending
data.entries.sort((a, b) => a.date.localeCompare(b.date));
data.updated_at = new Date().toISOString();

fs.writeFileSync(dataJsonPath, JSON.stringify(data, null, 2) + '\n');
console.log(`\nUpdated ${dataJsonPath} (${data.entries.length} total entries)`);
