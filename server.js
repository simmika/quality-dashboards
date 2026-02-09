const express = require('express');
const path = require('path');
const { upsert, getTimeSeries, getBranches, getTodaySummary, getLast7DaysAvg, getPrevious7DaysAvg } = require('./db');
const cron = require('node-cron');
const { fetchAndStore } = require('./fetcher');

const app = express();
const FETCH_BRANCHES = (process.env.FETCH_BRANCHES || 'master').split(',');
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Webhook: POST /api/webhook ──────────────────────────────────────────────
app.post('/api/webhook', (req, res) => {
  const { date, repo, branch, total_tests, skipped_count } = req.body;

  const errors = [];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('date is required (YYYY-MM-DD)');
  if (!branch) errors.push('branch is required');
  if (typeof total_tests !== 'number' || total_tests < 0) errors.push('total_tests must be a non-negative number');
  if (typeof skipped_count !== 'number' || skipped_count < 0) errors.push('skipped_count must be a non-negative number');

  if (errors.length) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  try {
    upsert({
      date,
      repo: repo || 'wix-data-client',
      branch,
      total_tests,
      skipped_count,
    });
    res.json({ ok: true, message: `Upserted ${date} / ${branch}` });
  } catch (err) {
    console.error('Webhook upsert error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── API: GET /api/timeseries ────────────────────────────────────────────────
app.get('/api/timeseries', (req, res) => {
  const { branch, from, to } = req.query;
  try {
    const rows = getTimeSeries({ branch, from, to });
    res.json(rows);
  } catch (err) {
    console.error('Timeseries error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── API: GET /api/branches ──────────────────────────────────────────────────
app.get('/api/branches', (_req, res) => {
  try {
    res.json(getBranches());
  } catch (err) {
    console.error('Branches error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── API: GET /api/summary ───────────────────────────────────────────────────
app.get('/api/summary', (req, res) => {
  const { branch } = req.query;
  try {
    const today = getTodaySummary(branch);
    const last7 = getLast7DaysAvg(branch);
    const prev7 = getPrevious7DaysAvg(branch);

    let trend = 'flat';
    if (last7 && prev7 && last7.days >= 2 && prev7.days >= 2) {
      const diff = last7.avg_skipped - prev7.avg_skipped;
      if (diff > 1) trend = 'up';
      else if (diff < -1) trend = 'down';
    }

    res.json({
      today_skipped: today ? today.skipped_count : null,
      today_total: today ? today.total_tests : null,
      avg_7d: last7 ? Math.round(last7.avg_skipped * 10) / 10 : null,
      trend,
    });
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── API: POST /api/fetch-now ────────────────────────────────────────────────
app.post('/api/fetch-now', async (req, res) => {
  const branch = req.body.branch || 'master';
  try {
    const result = fetchAndStore(branch);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Daily cron: fetch skipped tests every day at 06:00 ──────────────────────
cron.schedule('0 6 * * *', () => {
  console.log(`[cron] Daily fetch triggered at ${new Date().toISOString()}`);
  for (const branch of FETCH_BRANCHES) {
    try {
      const result = fetchAndStore(branch.trim());
      console.log(`[cron] ${branch}: ${result.skippedCount} skipped / ${result.totalTests} total`);
    } catch (err) {
      console.error(`[cron] Failed to fetch ${branch}:`, err.message);
    }
  }
});

app.listen(PORT, () => {
  console.log(`Skipped Tests Dashboard running at http://localhost:${PORT}`);
  console.log(`Daily fetch scheduled at 06:00 for branches: ${FETCH_BRANCHES.join(', ')}`);
});
