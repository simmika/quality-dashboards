const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { upsert } = require('./db');

const REPO = process.env.REPO || 'wix-private/wix-data-client';
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, '.cache');
const CLONE_DIR = path.join(CACHE_DIR, 'wix-data-client');

const SKIP_PATTERNS = /\b(it|test|describe)\.(skip|flaky)\s*\(/g;
const TEST_PATTERNS = /\b(it|test|describe)\s*\(/g;
const TEST_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

function cloneOrUpdate(branch) {
  if (fs.existsSync(path.join(CLONE_DIR, '.git'))) {
    console.log(`Updating existing clone on branch "${branch}"...`);
    const ghToken = process.env.GH_TOKEN;
    if (ghToken) {
      execSync(`git -C "${CLONE_DIR}" remote set-url origin "https://x-access-token:${ghToken}@github.com/${REPO}.git"`, { stdio: 'pipe' });
    }
    execSync(`git -C "${CLONE_DIR}" fetch origin "${branch}" --depth=1`, { stdio: 'pipe' });
    execSync(`git -C "${CLONE_DIR}" checkout FETCH_HEAD --force`, { stdio: 'pipe' });
  } else {
    console.log(`Shallow-cloning ${REPO} (branch: ${branch})...`);
    fs.mkdirSync(path.dirname(CLONE_DIR), { recursive: true });
    const ghToken = process.env.GH_TOKEN;
    const cloneUrl = ghToken
      ? `https://x-access-token:${ghToken}@github.com/${REPO}.git`
      : `https://github.com/${REPO}.git`;
    execSync(
      `git clone --depth=1 --branch "${branch}" "${cloneUrl}" "${CLONE_DIR}"`,
      { stdio: 'pipe' }
    );
  }
}

function walkFiles(dir, extensions) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      results.push(...walkFiles(full, extensions));
    } else if (extensions.has(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

function countMatches(content, regex) {
  const matches = content.match(regex);
  return matches ? matches.length : 0;
}

function countSkippedTests(branch) {
  cloneOrUpdate(branch);

  const files = walkFiles(CLONE_DIR, TEST_EXTENSIONS);
  let totalTests = 0;
  let skippedCount = 0;
  const skippedFiles = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const skips = countMatches(content, new RegExp(SKIP_PATTERNS.source, 'g'));
    const tests = countMatches(content, new RegExp(TEST_PATTERNS.source, 'g'));

    totalTests += tests;
    skippedCount += skips;

    if (skips > 0) {
      skippedFiles.push({ file: path.relative(CLONE_DIR, file), skips });
    }
  }

  return { totalTests, skippedCount, skippedFiles, filesScanned: files.length };
}

function fetchAndStore(branch = 'master') {
  console.log(`\nFetching skipped test data for ${REPO} @ ${branch}...`);

  const { totalTests, skippedCount, skippedFiles, filesScanned } = countSkippedTests(branch);
  const date = new Date().toISOString().slice(0, 10);

  console.log(`\nResults:`);
  console.log(`  Date:           ${date}`);
  console.log(`  Branch:         ${branch}`);
  console.log(`  Files scanned:  ${filesScanned}`);
  console.log(`  Total tests:    ${totalTests}`);
  console.log(`  Skipped/flaky:  ${skippedCount}`);
  console.log(`  Files with skips: ${skippedFiles.length}`);

  if (skippedFiles.length > 0) {
    console.log(`\n  Top files with skips:`);
    skippedFiles
      .sort((a, b) => b.skips - a.skips)
      .slice(0, 15)
      .forEach(f => console.log(`    ${f.skips}x  ${f.file}`));
  }

  upsert({
    date,
    repo: 'wix-data-client',
    branch,
    total_tests: totalTests,
    skipped_count: skippedCount,
  });

  console.log(`\nStored in dashboard DB.`);
  return { date, branch, totalTests, skippedCount };
}

// Run directly: node fetcher.js [branch]
if (require.main === module) {
  const branch = process.argv[2] || 'master';
  fetchAndStore(branch);
}

module.exports = { fetchAndStore, countSkippedTests };
