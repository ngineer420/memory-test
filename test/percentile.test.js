/* Run with:  node --test 
   No package.json, no dependencies: node:test and node:assert only.

   Ported from reaction-time-test/test/percentile.test.js. The engine tests are
   the same. The model tests read every model in P.MODELS, so a new model on
   this site gets the same guarantees without a new test. */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const P = require("../assets/js/percentile.js");
const REPO = path.join(__dirname, "..");

/* Site-specific: each fitted curve must land on the cited histogram's own
   mid-rank quantiles, within the tolerance the model states. */
test("every model lands within tolerance of its histogram's quantiles", () => {
  for (const m of P.MODELS) {
    assert.ok(m.empirical && m.tolerance > 0, `${m.id} carries no empirical check`);
    for (const key of Object.keys(m.empirical)) {
      const p = Number(key.slice(1));
      const fitted = P.scoreForPercentile(p, m);
      assert.ok(
        Math.abs(fitted - m.empirical[key]) <= m.tolerance,
        `${m.id} p${p}: fitted ${fitted.toFixed(2)} vs histogram ${m.empirical[key]} (tolerance ${m.tolerance})`
      );
    }
    assert.ok(Number.isInteger(m.n) && m.n > 1000, `${m.id} has no sample size`);
  }
  for (const key of ["chimp", "sequence", "number", "visual", "verbal"]) {
    assert.ok(P.modelForGame(key), `no model for ${key}`);
  }
  assert.strictEqual(P.modelForGame("nback"), null);
  assert.strictEqual(P.modelForGame("constructor"), null);
});

/* Every model on this site scores higher-is-better. The engine must still
   handle the other direction, so one synthetic lower-is-better model rides
   along to prove that the direction switch works. */
const LOWER_IS_BETTER = {
  id: "synthetic-ms",
  unit: "ms",
  lowerIsBetter: true,
  median: 273,
  sd: 38,
  shift: 0,
  precision: 0,
  domain: [140, 450],
  betterWord: "Faster",
  populationPhrase: "a synthetic test population in published data",
};

/* The widest score range any model here is evaluated over. */
const SCAN_MAX = 400;
const SCAN_STEP = 0.05;

/* ============================ bounds ============================ */

test("percentile is always finite and within 0-100 for every model", () => {
  for (const m of P.MODELS) {
    for (let s = 0; s <= SCAN_MAX; s += SCAN_STEP) {
      const p = P.percentileForScore(s, m);
      assert.ok(Number.isFinite(p), `${m.id}: not finite at ${s}: ${p}`);
      assert.ok(p >= 0 && p <= 100, `${m.id}: out of bounds at ${s}: ${p}`);
    }
  }
});

test("percentile stays in bounds for absurd and invalid scores", () => {
  for (const m of P.MODELS) {
    for (const s of [0, -1, -1e6, 1e6, 1e12]) {
      const p = P.percentileForScore(s, m);
      assert.ok(Number.isFinite(p) && p >= 0 && p <= 100, `${m.id}: out of bounds at ${s}: ${p}`);
    }
    for (const bad of [NaN, Infinity, -Infinity, undefined, null, "50"]) {
      assert.ok(Number.isNaN(P.percentileForScore(bad, m)), `${m.id}: expected NaN for ${bad}`);
    }
  }
  assert.ok(Number.isNaN(P.percentileForScore(50, null)));
});

test("a lower-is-better model is also bounded", () => {
  for (let ms = 1; ms <= 5000; ms += 1) {
    const p = P.percentileForScore(ms, LOWER_IS_BETTER);
    assert.ok(Number.isFinite(p) && p >= 0 && p <= 100, `out of bounds at ${ms}ms: ${p}`);
  }
});

/* ========================= monotonicity ========================= */

test("percentile never decreases as the score improves (higher is better)", () => {
  for (const m of P.MODELS) {
    let prev = -Infinity;
    for (let s = 0; s <= SCAN_MAX; s += SCAN_STEP) {
      const p = P.percentileForScore(s, m);
      assert.ok(p >= prev, `${m.id}: percentile dropped when improving to ${s}: ${p} < ${prev}`);
      prev = p;
    }
  }
});

test("percentile never decreases as the score improves (lower is better)", () => {
  let prev = -Infinity;
  for (let ms = 3000; ms >= 1; ms -= 0.25) {
    const p = P.percentileForScore(ms, LOWER_IS_BETTER);
    assert.ok(p >= prev, `percentile dropped when improving to ${ms}ms: ${p} < ${prev}`);
    prev = p;
  }
});

test("the displayed percentile is also monotone and clamped to 1-99", () => {
  for (const m of P.MODELS) {
    let prev = -Infinity;
    for (let s = 0; s <= SCAN_MAX; s += 0.5) {
      const shown = Number(P.formatPercentile(P.percentileForScore(s, m)));
      assert.ok(shown >= 1 && shown <= 99, `${m.id}: displayed percentile out of range at ${s}: ${shown}`);
      assert.ok(shown >= prev, `${m.id}: displayed percentile dropped when improving to ${s}`);
      prev = shown;
    }
  }
});

/* ==================== model / table integrity ==================== */

/* Integrate the density numerically rather than trusting the closed form the
   fit used. The grid runs from the floor of the model to well past its tail. */
function fittedMoments(m) {
  const lo = (m.shift || 0) + 1e-4;
  const hi = (m.shift || 0) + SCAN_MAX * 4;
  const step = (hi - lo) / 400000;
  let m0 = 0, m1 = 0, m2 = 0;
  for (let x = lo; x < hi; x += step) {
    const d = P.density(m, x);
    m0 += d; m1 += d * x; m2 += d * x * x;
  }
  const mean = m1 / m0;
  return { mean: mean, sd: Math.sqrt(m2 / m0 - mean * mean) };
}

test("every model reproduces the published figures it is pinned to", () => {
  for (const m of P.MODELS) {
    const fit = fittedMoments(m);
    const tol = m.sd * 0.02;
    assert.ok(Math.abs(fit.sd - m.sd) < tol, `${m.id}: fitted SD ${fit.sd.toFixed(3)} != cited ${m.sd}`);
    if (m.median != null) {
      assert.ok(Math.abs(P.scoreForPercentile(50, m) - m.median) < tol, `${m.id}: median drifted`);
    } else {
      assert.ok(Math.abs(fit.mean - m.mean) < tol, `${m.id}: fitted mean ${fit.mean.toFixed(3)} != cited ${m.mean}`);
    }
    assert.ok(fit.mean > P.scoreForPercentile(50, m), `${m.id}: a right-skewed model must have mean > median`);
  }
});

test("the median-anchored fit also reproduces its inputs", () => {
  assert.ok(Math.abs(P.scoreForPercentile(50, LOWER_IS_BETTER) - LOWER_IS_BETTER.median) < 0.5);
  let m0 = 0, m1 = 0, m2 = 0;
  for (let x = 1; x < 4000; x += 0.05) {
    const d = P.density(LOWER_IS_BETTER, x);
    m0 += d; m1 += d * x; m2 += d * x * x;
  }
  const mean = m1 / m0;
  const sd = Math.sqrt(m2 / m0 - mean * mean);
  assert.ok(Math.abs(sd - LOWER_IS_BETTER.sd) < 0.5, `fitted SD ${sd.toFixed(2)} != cited ${LOWER_IS_BETTER.sd}`);
});

test("scoreForPercentile round-trips through percentileForScore", () => {
  for (const m of P.MODELS.concat([LOWER_IS_BETTER])) {
    for (const p of [1, 5, 10, 25, 50, 75, 90, 95, 99]) {
      const score = P.scoreForPercentile(p, m);
      const back = P.percentileForScore(score, m);
      assert.ok(Math.abs(back - p) < 0.01, `${m.id}: round-trip failed at p${p}: ${back}`);
    }
  }
});

test("every model's quantile table matches the model it claims to come from", () => {
  for (const m of P.MODELS) {
    assert.ok(Array.isArray(m.quantiles) && m.quantiles.length > 0, `${m.id} has no table`);
    for (const row of m.quantiles) {
      const actual = P.percentileForScore(row.score, m);
      assert.ok(
        Math.abs(actual - row.percentile) <= 1.5,
        `${m.id} row p${row.percentile} = ${row.score} actually maps to p${actual.toFixed(2)}`
      );
    }
    for (let i = 1; i < m.quantiles.length; i++) {
      assert.ok(m.quantiles[i].percentile < m.quantiles[i - 1].percentile, `${m.id}: percentiles must descend`);
      assert.ok(m.quantiles[i].score < m.quantiles[i - 1].score, `${m.id}: scores must fall with percentile`);
    }
  }
});

test("quantileTable() generates an ordered table for any model", () => {
  for (const m of P.MODELS) {
    const table = P.quantileTable(m);
    assert.ok(table.length > 0);
    for (let i = 1; i < table.length; i++) {
      assert.ok(table[i].percentile < table[i - 1].percentile);
      assert.ok(table[i].score < table[i - 1].score, `${m.id}: higher-is-better scores must fall with percentile`);
    }
  }
  const table = P.quantileTable(LOWER_IS_BETTER);
  for (let i = 1; i < table.length; i++) {
    assert.ok(table[i].score > table[i - 1].score, "lower-is-better scores must rise as percentile falls");
  }
});

test("every model is registered, unique and complete", () => {
  assert.ok(P.MODELS.length >= 1, "at least one model");
  const ids = new Set(P.MODELS.map((m) => m.id));
  assert.strictEqual(ids.size, P.MODELS.length, "model ids must be unique");
  const sourceIds = new Set(P.SOURCES.map((s) => s.id));
  assert.strictEqual(sourceIds.size, P.SOURCES.length, "source ids must be unique");
  for (const m of P.MODELS) {
    assert.ok(m.label && m.unit && m.betterWord && m.populationPhrase, `${m.id} is missing display copy`);
    assert.strictEqual(m.lowerIsBetter, false, `${m.id} must be a higher-is-better model`);
    assert.ok(sourceIds.has(m.source), `${m.id} cites unknown source ${m.source}`);
    assert.ok(Number.isFinite(m.sd) && m.sd > 0, `${m.id} has no usable spread`);
    assert.ok(Number.isFinite(m.median) || Number.isFinite(m.mean), `${m.id} has no anchor`);
    assert.ok(Array.isArray(m.domain) && m.domain[1] > m.domain[0], `${m.id} has no drawing domain`);
    assert.match(m.populationPhrase, /published|estimate/i, `${m.id} must name its source class`);
  }
  for (const s of P.SOURCES) {
    assert.ok(s.citation && s.url && s.kind && s.used, `source ${s.id} is missing citation/url/kind/used`);
    assert.match(s.url, /^https:\/\//, `source ${s.id} must carry a checkable URL`);
  }
});

/* ======================= curve geometry ======================= */

test("distributionPath returns a usable SVG path", () => {
  for (const m of P.MODELS) {
    const geom = { width: 320, height: 130 };
    const d = P.distributionPath(m, geom);
    assert.match(d, /^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+)+$/, `${m.id}: path must be a plain move+line polyline`);
    assert.ok(!/NaN|Infinity|undefined/.test(d), `${m.id}: path must not contain NaN/Infinity`);
    const closed = P.distributionPath(m, Object.assign({ close: true }, geom));
    assert.ok(closed.endsWith(" Z"), "closed path must end with Z");
  }
});

test("distributionPath stays inside the requested box", () => {
  const geom = { width: 300, height: 120, padTop: 10, padBottom: 20, padLeft: 8, padRight: 8 };
  for (const m of P.MODELS) {
    const d = P.distributionPath(m, geom);
    const nums = d.replace(/[ML]/g, " ").trim().split(/[\s]+/).map(Number);
    for (let i = 0; i < nums.length; i += 2) {
      const x = nums[i], y = nums[i + 1];
      assert.ok(x >= geom.padLeft - 0.01 && x <= geom.width - geom.padRight + 0.01, `${m.id}: x out of box: ${x}`);
      assert.ok(y >= geom.padTop - 0.01 && y <= geom.height - geom.padBottom + 0.01, `${m.id}: y out of box: ${y}`);
    }
  }
});

test("an empty slice returns an empty path rather than junk", () => {
  const m = P.MODELS[0];
  const at = m.domain[0] + 1;
  assert.strictEqual(P.distributionPath(m, { from: at, to: at }), "");
  assert.strictEqual(P.distributionPath(null, {}), "");
});

test("projectScore clamps the marker into the drawn domain", () => {
  for (const m of P.MODELS) {
    const geom = { width: 320, height: 130 };
    const mid = (m.domain[0] + m.domain[1]) / 2;
    const inside = P.projectScore(m, mid, geom);
    assert.ok(inside.x > 0 && !inside.clamped, `${m.id}: a mid-domain score must not clamp`);
    assert.ok(P.projectScore(m, m.domain[0] - 1e6, geom).clamped);
    assert.ok(P.projectScore(m, m.domain[1] + 1e6, geom).clamped);
    // A better score always sits to the right of a worse one.
    assert.ok(P.projectScore(m, m.domain[0] + 1, geom).x < P.projectScore(m, mid, geom).x);
  }
});

test("axisTicks span the domain in order", () => {
  const ticks = P.axisTicks(P.MODELS[0], { min: 0, max: 20 }, 4);
  assert.strictEqual(ticks.length, 5);
  assert.strictEqual(ticks[0].score, 0);
  assert.strictEqual(ticks[4].score, 20);
  for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i].x > ticks[i - 1].x);
});

/* ======================= copy and provenance ======================= */

test("comparison copy attributes the figures to their source class", () => {
  for (const m of P.MODELS) {
    const mid = P.scoreForPercentile(60, m);
    const text = P.comparisonText(mid, m);
    assert.match(text, /published|estimate/i, `${m.id}: comparison copy must name its source class`);
    assert.ok(new RegExp("^" + m.betterWord + " than \\d+% of ").test(text), `${m.id}: unexpected copy: ${text}`);
    assert.strictEqual(P.comparisonText(NaN, m), "");
  }
});

test("no shipped file claims the percentiles come from this site's visitors", () => {
  const banned = [
    /than other (visitors|players|users)/i,
    /of (our|site) (visitors|users|players)/i,
    /(visitors|users|players) (who|that) (have )?(took|taken|tried) (this|the) test/i,
    /people who (took|have taken) this test/i,
    /(everyone|others) (who|that) (took|played)/i,
    /our (database|dataset|data) of (results|scores|times)/i,
    /\bwe (collect|aggregate|store|track) (your |the )?(results|scores|times)/i,
  ];
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === ".worktrees" || entry.name === ".claude" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(html|js)$/.test(entry.name)) files.push(full);
    }
  })(REPO);
  assert.ok(files.length > 5, "expected to scan the site's pages");
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of banned) {
      assert.ok(
        !pattern.test(text),
        `${path.relative(REPO, file)} implies visitor-data aggregation: ${pattern}`
      );
    }
  }
});

/* Article and policy pages load app.js for the toolbar only. The engine is
   required on every page that renders a results panel (a `score-trend`
   block), and app.js degrades to no population line where it is absent. */
test("every test page loads percentile.js ahead of app.js", () => {
  const pages = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === ".worktrees" || entry.name === ".claude" || entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.html$/.test(entry.name)) pages.push(full);
    }
  })(REPO);
  let checked = 0;
  for (const file of pages) {
    const html = fs.readFileSync(file, "utf8");
    const app = html.search(/<script src="\/assets\/js\/app\.js/);
    if (app < 0 || html.indexOf('class="score-trend"') < 0) continue;
    const eng = html.search(/<script src="\/assets\/js\/percentile\.js/);
    assert.ok(eng >= 0, `${path.relative(REPO, file)} loads app.js without percentile.js`);
    assert.ok(eng < app, `${path.relative(REPO, file)} must load percentile.js before app.js`);
    checked++;
  }
  assert.ok(checked > 0, "expected at least one test page");
});
