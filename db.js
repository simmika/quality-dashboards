const Database = require('better-sqlite3');
const path = require('path');

const DB_DIR = process.env.DB_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'skipped-tests.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS daily_skipped_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        repo TEXT NOT NULL DEFAULT 'wix-data-client',
        branch TEXT NOT NULL,
        total_tests INTEGER NOT NULL,
        skipped_count INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(date, branch)
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_date ON daily_skipped_summary(date);
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_branch ON daily_skipped_summary(branch);
    `);
  }
  return db;
}

function upsert({ date, repo, branch, total_tests, skipped_count }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO daily_skipped_summary (date, repo, branch, total_tests, skipped_count)
    VALUES (@date, @repo, @branch, @total_tests, @skipped_count)
    ON CONFLICT(date, branch) DO UPDATE SET
      repo = @repo,
      total_tests = @total_tests,
      skipped_count = @skipped_count,
      updated_at = datetime('now')
  `);
  return stmt.run({ date, repo, branch, total_tests, skipped_count });
}

function getTimeSeries({ branch, from, to }) {
  const db = getDb();
  let sql = `SELECT date, repo, branch, total_tests, skipped_count
             FROM daily_skipped_summary WHERE 1=1`;
  const params = {};

  if (branch) {
    sql += ` AND branch = @branch`;
    params.branch = branch;
  }
  if (from) {
    sql += ` AND date >= @from`;
    params.from = from;
  }
  if (to) {
    sql += ` AND date <= @to`;
    params.to = to;
  }

  sql += ` ORDER BY date ASC`;
  return db.prepare(sql).all(params);
}

function getBranches() {
  const db = getDb();
  return db.prepare(`SELECT DISTINCT branch FROM daily_skipped_summary ORDER BY branch`).all().map(r => r.branch);
}

function getTodaySummary(branch) {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  let sql = `SELECT date, skipped_count, total_tests FROM daily_skipped_summary WHERE date = @today`;
  const params = { today };
  if (branch) {
    sql += ` AND branch = @branch`;
    params.branch = branch;
  }
  sql += ` LIMIT 1`;

  return db.prepare(sql).get(params) || null;
}

function getLast7DaysAvg(branch) {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  let sql = `SELECT AVG(skipped_count) as avg_skipped, COUNT(*) as days
             FROM daily_skipped_summary
             WHERE date >= @sevenDaysAgo AND date <= @today`;
  const params = { sevenDaysAgo, today };
  if (branch) {
    sql += ` AND branch = @branch`;
    params.branch = branch;
  }

  return db.prepare(sql).get(params);
}

function getPrevious7DaysAvg(branch) {
  const db = getDb();
  const eightDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);

  let sql = `SELECT AVG(skipped_count) as avg_skipped, COUNT(*) as days
             FROM daily_skipped_summary
             WHERE date >= @fourteenDaysAgo AND date <= @eightDaysAgo`;
  const params = { fourteenDaysAgo, eightDaysAgo };
  if (branch) {
    sql += ` AND branch = @branch`;
    params.branch = branch;
  }

  return db.prepare(sql).get(params);
}

module.exports = { getDb, upsert, getTimeSeries, getBranches, getTodaySummary, getLast7DaysAvg, getPrevious7DaysAvg };
