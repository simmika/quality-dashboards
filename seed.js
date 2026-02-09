const { upsert } = require('./db');

const DAYS = 30;
const BRANCHES = ['master', 'develop'];
const BASE_TOTAL = 4500;
const BASE_SKIPPED = { master: 38, develop: 45 };

function randomWalk(base, maxDelta = 3) {
  let val = base;
  return () => {
    val += Math.round((Math.random() - 0.45) * maxDelta);
    val = Math.max(0, val);
    return val;
  };
}

function seed() {
  const today = new Date();

  for (const branch of BRANCHES) {
    const nextSkipped = randomWalk(BASE_SKIPPED[branch], 4);
    const nextTotal = randomWalk(BASE_TOTAL, 20);

    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);

      upsert({
        date,
        repo: 'wix-data-client',
        branch,
        total_tests: nextTotal(),
        skipped_count: nextSkipped(),
      });
    }
  }

  console.log(`Seeded ${DAYS} days × ${BRANCHES.length} branches = ${DAYS * BRANCHES.length} rows.`);
}

seed();
