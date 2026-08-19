/* Chimp Memory Test — app.js
   Pure, DOM-independent game logic lives at the top of this file (and is
   exported for Node via the `typeof module` guard at the bottom so it can be
   sanity-checked outside the browser). Everything below the
   "===== DOM WIRING =====" divider touches `document` and only runs in a
   browser. */

/* ============================= pure game logic ============================= */

/**
 * Deterministic seeded RNG (mulberry32) so game logic can be unit-tested
 * without depending on Math.random(). The browser code below always calls
 * these functions with Math.random unless a test harness overrides it.
 */
function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(array, rng) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/* ---- shared: history + tiering ---- */

/**
 * Prepend `entry` to `history` (newest first) and cap the length at `maxLen`.
 * Pure — returns a new array, does not mutate the input.
 */
function pushHistory(history, entry, maxLen) {
  const cap = maxLen || 10;
  const next = [entry].concat(Array.isArray(history) ? history : []);
  return next.slice(0, cap);
}

/**
 * Append `score` to the long-run distribution used for percentiles, keeping the
 * most recent `maxLen`. Separate from `pushHistory`: the history list is a short
 * "last 10 attempts" display, the distribution is the sample we rank against.
 * Pure — returns a new array.
 */
function pushDistribution(dist, score, maxLen) {
  const cap = maxLen || 200;
  const next = (Array.isArray(dist) ? dist : []).concat([score]);
  return next.slice(-cap);
}

/**
 * Percentile rank of `score` within `scores`, using the mid-rank convention:
 * everything strictly below, plus half the ties. Returns an integer 0-100, or
 * `null` when there is nothing to rank against.
 *
 * `scores` is the player's own past attempts on this device — this is a
 * personal percentile, not a claim about other people.
 */
function percentileRank(scores, score) {
  const list = (Array.isArray(scores) ? scores : []).filter(function (n) {
    return typeof n === "number" && isFinite(n);
  });
  if (!list.length) return null;
  let below = 0;
  let equal = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] < score) below++;
    else if (list[i] === score) equal++;
  }
  return Math.round(((below + equal / 2) / list.length) * 100);
}

/**
 * Map a series of scores (oldest first) onto "x,y ..." SVG polyline points
 * inside a `w` x `h` box with `pad` units of breathing room top and bottom.
 * A flat series (or a single point) is drawn down the vertical middle.
 * Pure — no DOM.
 */
function sparklinePoints(scores, w, h, pad) {
  const list = (Array.isArray(scores) ? scores : []).filter(function (n) {
    return typeof n === "number" && isFinite(n);
  });
  if (!list.length) return "";
  const p = typeof pad === "number" ? pad : 4;
  const top = p;
  const bottom = h - p;
  let min = list[0];
  let max = list[0];
  for (let i = 1; i < list.length; i++) {
    if (list[i] < min) min = list[i];
    if (list[i] > max) max = list[i];
  }
  const span = max - min;
  const stepX = list.length > 1 ? w / (list.length - 1) : 0;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const x = list.length > 1 ? i * stepX : w / 2;
    // No spread in the data means no meaningful slope — draw it level.
    const y = span === 0 ? (top + bottom) / 2 : bottom - ((list[i] - min) / span) * (bottom - top);
    out.push(round2(x) + "," + round2(y));
  }
  return out.join(" ");
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Look up the label for `score` in an ordered list of {min, max, label} tiers. */
function lookupTier(tiers, score) {
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (score >= t.min && score <= t.max) return t.label;
  }
  return tiers[tiers.length - 1].label;
}

/* ---- Chimp Test ---- */

/**
 * Decide a board size (rows x cols) with a little breathing room beyond the
 * number of tiles actually needed, so tile positions aren't crammed edge to
 * edge as the round count grows.
 */
function chimpGridSize(count) {
  const minCells = Math.max(9, count + 4);
  const cols = Math.ceil(Math.sqrt(minCells));
  const rows = Math.ceil(minCells / cols);
  return { rows: rows, cols: cols };
}

/**
 * Build a round: pick `count` distinct cells out of the grid and assign them
 * numbers 1..count. Returns { rows, cols, totalCells, tiles } where tiles is
 * an array of { number, cell } (cell = 0-indexed position in row-major order).
 */
function chimpGenerateLayout(count, rng) {
  const useRng = rng || Math.random;
  const size = chimpGridSize(count);
  const totalCells = size.rows * size.cols;
  const cellIndices = [];
  for (let i = 0; i < totalCells; i++) cellIndices.push(i);
  const chosen = shuffle(cellIndices, useRng).slice(0, count);
  const tiles = chosen.map(function (cell, i) {
    return { number: i + 1, cell: cell };
  });
  return { rows: size.rows, cols: size.cols, totalCells: totalCells, tiles: tiles };
}

/**
 * Evaluate a click on cell `clickedCell` given the round's `tiles` and the
 * number the player needs to click next (`nextExpected`, 1-indexed).
 * Returns { valid, correct, complete } — `valid` is false if the click
 * landed on an empty cell (no tile there).
 */
function chimpCheckClick(tiles, clickedCell, nextExpected) {
  const tile = tiles.find(function (t) {
    return t.cell === clickedCell;
  });
  if (!tile) return { valid: false, correct: false, complete: false };
  const correct = tile.number === nextExpected;
  const complete = correct && nextExpected === tiles.length;
  return { valid: true, correct: correct, complete: complete };
}

const CHIMP_TIERS = [
  { min: 0, max: 3, label: "Just warming up" },
  { min: 4, max: 5, label: "Average recall" },
  { min: 6, max: 7, label: "Sharp memory" },
  { min: 8, max: 9, label: "Excellent — most people plateau here" },
  { min: 10, max: 11, label: "Exceptional — rare human territory" },
  { min: 12, max: Infinity, label: "Chimp-level or better" },
];

function chimpRatingTier(score) {
  return lookupTier(CHIMP_TIERS, score);
}

/* ---- Sequence Memory ---- */

/** Append one random tile index (0..gridSize-1) to `sequence`. */
function sequenceAppend(sequence, gridSize, rng) {
  const useRng = rng || Math.random;
  const next = Math.floor(useRng() * gridSize);
  return sequence.concat([next]);
}

/**
 * Check the most recent entry in `inputs` against the same position in
 * `sequence`. Returns { correct, complete } — `complete` means the whole
 * sequence has now been reproduced.
 */
function sequenceCheckStep(sequence, inputs) {
  const i = inputs.length - 1;
  const correct = inputs[i] === sequence[i];
  const complete = correct && inputs.length === sequence.length;
  return { correct: correct, complete: complete };
}

const SEQUENCE_TIERS = [
  { min: 0, max: 4, label: "Just warming up" },
  { min: 5, max: 7, label: "Average recall" },
  { min: 8, max: 10, label: "Sharp memory" },
  { min: 11, max: 13, label: "Excellent — most people plateau here" },
  { min: 14, max: 17, label: "Exceptional — rare human territory" },
  { min: 18, max: Infinity, label: "Grandmaster-level recall" },
];

function sequenceRatingTier(level) {
  return lookupTier(SEQUENCE_TIERS, level);
}

/* ---- Number Memory ---- */

/** Generate a `length`-digit number as a string. First digit is never 0. */
function numberGenerate(length, rng) {
  const useRng = rng || Math.random;
  let str = "";
  for (let i = 0; i < length; i++) {
    const digit = i === 0 ? 1 + Math.floor(useRng() * 9) : Math.floor(useRng() * 10);
    str += String(digit);
  }
  return str;
}

/** Compare a typed answer against the target number (whitespace-tolerant). */
function numberCheckAnswer(target, answer) {
  return String(target) === String(answer == null ? "" : answer).trim();
}

const NUMBER_TIERS = [
  { min: 0, max: 5, label: "Just warming up" },
  { min: 6, max: 7, label: "Average recall" },
  { min: 8, max: 9, label: "Sharp memory" },
  { min: 10, max: 12, label: "Excellent — most people plateau here" },
  { min: 13, max: 15, label: "Exceptional — rare human territory" },
  { min: 16, max: Infinity, label: "Savant-level recall" },
];

function numberRatingTier(digits) {
  return lookupTier(NUMBER_TIERS, digits);
}

/* ---- Visual Memory ---- */

/**
 * Side length of the (square) grid for a given level. Grows one cell every few
 * levels and is capped so the board never becomes absurdly large.
 */
function visualGridSize(level) {
  const side = 3 + Math.floor((level - 1) / 3);
  return Math.min(side, 7);
}

/** How many tiles flash at a given level (level 1 = 3 tiles). */
function visualTileCount(level) {
  return level + 2;
}

/**
 * Build a level: choose visualTileCount(level) distinct cells to flash out of a
 * square grid sized by visualGridSize(level). Returns
 * { side, totalCells, litCells } where litCells is an array of 0-indexed cells
 * (row-major). The lit count is clamped so it never exceeds the cell count.
 */
function visualGenerateLayout(level, rng) {
  const useRng = rng || Math.random;
  const side = visualGridSize(level);
  const totalCells = side * side;
  let count = visualTileCount(level);
  if (count > totalCells) count = totalCells;
  const cells = [];
  for (let i = 0; i < totalCells; i++) cells.push(i);
  const litCells = shuffle(cells, useRng).slice(0, count);
  return { side: side, totalCells: totalCells, litCells: litCells };
}

const VISUAL_TIERS = [
  { min: 0, max: 2, label: "Just warming up" },
  { min: 3, max: 4, label: "Average recall" },
  { min: 5, max: 7, label: "Sharp memory" },
  { min: 8, max: 10, label: "Excellent — most people plateau here" },
  { min: 11, max: 14, label: "Exceptional — rare human territory" },
  { min: 15, max: Infinity, label: "Photographic-level recall" },
];

function visualRatingTier(level) {
  return lookupTier(VISUAL_TIERS, level);
}

/* ---- Verbal Memory ---- */

/**
 * Pick the next word to show. `usedList` is every word already shown at least
 * once. With probability `reuseProb` (when possible) a word that's already been
 * seen is shown again; otherwise a fresh word from `pool` is chosen. Falls back
 * to reuse when the pool is exhausted, and to a fresh word when nothing has been
 * shown yet. Returns { word, isSeen }.
 */
function verbalPickWord(pool, usedList, rng, reuseProb) {
  const useRng = rng || Math.random;
  const p = typeof reuseProb === "number" ? reuseProb : 0.42;
  const used = usedList || [];
  const usedSet = {};
  for (let i = 0; i < used.length; i++) usedSet[used[i]] = true;
  const unused = pool.filter(function (w) {
    return !usedSet[w];
  });
  const canReuse = used.length > 0;
  const mustReuse = unused.length === 0;
  const reuse = canReuse && (mustReuse || useRng() < p);
  if (reuse) {
    const w = used[Math.floor(useRng() * used.length)];
    return { word: w, isSeen: true };
  }
  const nw = unused[Math.floor(useRng() * unused.length)];
  return { word: nw, isSeen: false };
}

/** True if the SEEN/NEW answer matches reality. `answer` is "seen" or "new". */
function verbalCheckAnswer(wasSeen, answer) {
  return (answer === "seen") === Boolean(wasSeen);
}

const VERBAL_TIERS = [
  { min: 0, max: 14, label: "Just warming up" },
  { min: 15, max: 29, label: "Average recall" },
  { min: 30, max: 49, label: "Sharp memory" },
  { min: 50, max: 74, label: "Excellent — most people plateau here" },
  { min: 75, max: 99, label: "Exceptional — rare human territory" },
  { min: 100, max: Infinity, label: "Savant-level recall" },
];

function verbalRatingTier(score) {
  return lookupTier(VERBAL_TIERS, score);
}

/* ---- N-Back ----

   The only test on this site whose score is not "how far did you get". An
   n-back run is a stream of trials, most of which are NOT targets, so
   percent-correct is a broken measure: on a run where 25% of trials are
   targets, answering "no" to everything scores 75% while catching nothing.
   Everything below therefore counts hits and false alarms separately, and the
   headline number is d-prime — how far apart the player's "target" and
   "non-target" experiences actually are, in standard deviations. The page
   states that rule where a player can read it. */

/* Inverse standard normal CDF — Acklam's rational approximation
   (|error| < 1.15e-9). Needed only for d-prime; kept here rather than pulled in
   because this file has no dependencies and is not about to grow any. */
function inverseNormalCdf(p) {
  if (!(p > 0) || !(p < 1)) return NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
             1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
             6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
             -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0,
             3.754408661907416e0];
  const pLow = 0.02425;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
           ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pLow) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
         (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Build one block of a position n-back run: `len` trials over a 3x3 grid,
 * returned as an array of cell indices 0-8.
 *
 * A trial is a target when it repeats the cell shown `n` trials earlier. The
 * first `n` trials cannot be targets — there is nothing behind them to match —
 * so they are dealt freely and are not scored.
 *
 * `targetRate` is the share of the SCORABLE trials that are targets, and the
 * count is rounded rather than sampled per trial: a coin flip per trial would
 * hand one player a block with three targets and the next a block with eleven,
 * and d-prime from three targets is not a measurement. Non-target trials are
 * dealt a cell that deliberately differs from the one n back, so the only
 * targets in the block are the intended ones.
 *
 * Deterministic given `rng` — pass a seeded one and the same day deals the same
 * block.
 */
function nbackGenerateSequence(len, n, targetRate, rng) {
  const useRng = rng || Math.random;
  const cells = 9;
  const total = Math.max(n + 1, len | 0);
  const rate = typeof targetRate === "number" ? targetRate : 0.3;
  const scorable = total - n;
  const wanted = Math.max(1, Math.min(scorable, Math.round(scorable * rate)));

  // Choose which scorable trials are targets, without replacement.
  const eligible = [];
  for (let i = n; i < total; i++) eligible.push(i);
  const chosen = shuffle(eligible, useRng).slice(0, wanted);
  const isTarget = {};
  for (let i = 0; i < chosen.length; i++) isTarget[chosen[i]] = true;

  const seq = [];
  for (let i = 0; i < total; i++) {
    if (i < n) {
      seq.push(Math.floor(useRng() * cells));
    } else if (isTarget[i]) {
      seq.push(seq[i - n]);
    } else {
      // Anything except the cell n back, so a lure cannot become a target.
      const avoid = seq[i - n];
      let pick = Math.floor(useRng() * (cells - 1));
      if (pick >= avoid) pick += 1;
      seq.push(pick);
    }
  }
  return seq;
}

/** True when trial `index` of `sequence` repeats the cell `n` trials back. */
function nbackIsTarget(sequence, n, index) {
  return index >= n && sequence[index] === sequence[index - n];
}

/**
 * Classify one trial. Returns "hit", "miss", "falseAlarm", "correctRejection",
 * or null for the first `n` trials, which carry no possible answer and are
 * therefore not scored at all.
 */
function nbackCheckResponse(sequence, n, index, responded) {
  if (index < n) return null;
  const target = nbackIsTarget(sequence, n, index);
  if (target) return responded ? "hit" : "miss";
  return responded ? "falseAlarm" : "correctRejection";
}

/**
 * Score a whole block. `responses` is one boolean per trial — did the player
 * press "match" on it.
 *
 * d-prime = z(hit rate) - z(false-alarm rate). A flawless block would put one of
 * those rates at 0 or 1, where z is infinite, so both rates use the log-linear
 * correction (Hautus 1995): half a trial is added to the hit and false-alarm
 * counts and a whole trial to each total, always, not only at the extremes.
 * Applying it unconditionally is what keeps the measure smooth — a correction
 * that switches on only for perfect blocks puts a step in the scale right where
 * people are trying to improve. It is also why a flawless long block scores
 * higher than a flawless short one: more evidence, less correction.
 *
 * One case is not a d-prime at all: a player who presses on EVERY trial, or on
 * none of them, has given the same answer throughout and shown no
 * discrimination whatsoever. The corrected rates would still produce a non-zero
 * number there, purely from the two totals differing in size, so that case
 * reports 0 rather than an artefact.
 */
function nbackScore(sequence, n, responses) {
  const answers = responses || [];
  let hits = 0, misses = 0, falseAlarms = 0, correctRejections = 0;
  for (let i = 0; i < sequence.length; i++) {
    const verdict = nbackCheckResponse(sequence, n, i, Boolean(answers[i]));
    if (verdict === "hit") hits++;
    else if (verdict === "miss") misses++;
    else if (verdict === "falseAlarm") falseAlarms++;
    else if (verdict === "correctRejection") correctRejections++;
  }
  const targets = hits + misses;
  const nonTargets = falseAlarms + correctRejections;
  const scored = targets + nonTargets;
  const correct = hits + correctRejections;

  const pressedNothing = hits + falseAlarms === 0;
  const pressedEverything = misses + correctRejections === 0;

  let dPrime = null;
  if (targets > 0 && nonTargets > 0) {
    if (pressedNothing || pressedEverything) {
      dPrime = 0;
    } else {
      const hitRate = (hits + 0.5) / (targets + 1);
      const faRate = (falseAlarms + 0.5) / (nonTargets + 1);
      dPrime = inverseNormalCdf(hitRate) - inverseNormalCdf(faRate);
    }
  }

  return {
    trials: sequence.length,
    scored: scored,
    targets: targets,
    nonTargets: nonTargets,
    hits: hits,
    misses: misses,
    falseAlarms: falseAlarms,
    correctRejections: correctRejections,
    accuracy: scored ? correct / scored : 0,
    hitRate: targets ? hits / targets : 0,
    falseAlarmRate: nonTargets ? falseAlarms / nonTargets : 0,
    dPrime: dPrime,
    sameAnswerThroughout: pressedNothing || pressedEverything,
    clean: targets > 0 && misses === 0 && falseAlarms === 0,
  };
}

/**
 * The ladder. `3 clean blocks in a row` moves up, `2 or more missed targets in
 * one block` moves down, and n never drops below 1. Pure: it takes the current
 * rung and a block's score and returns the next rung plus the running streak,
 * so the browser code holds no laddering logic of its own.
 */
function nbackNextLevel(level, cleanStreak, score) {
  let n = level;
  let streak = score.clean ? cleanStreak + 1 : 0;
  let moved = null;
  if (streak >= 3) {
    n = level + 1;
    streak = 0;
    moved = "up";
  } else if (score.misses >= 2) {
    n = Math.max(1, level - 1);
    streak = 0;
    if (n !== level) moved = "down";
  }
  return { level: n, cleanStreak: streak, moved: moved };
}

/**
 * A seed for the day, so a session cannot be rerolled by refreshing until it
 * deals something easy. It mixes the date with the rung and the block number,
 * because a player sitting at 2-back and one sitting at 4-back cannot share a
 * board — a target is defined relative to n, so the same sequence is a
 * different test at every level.
 */
function nbackDailySeed(dateStr, n, block) {
  const text = String(dateStr) + "|" + n + "|" + block;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Local calendar date as YYYY-MM-DD — the streak's unit, in the player's own
    timezone rather than UTC, because "today" is where they are sitting. */
function nbackDayKey(date) {
  const d = date || new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}

/** Days between two YYYY-MM-DD keys, or null if either is unparseable. */
function nbackDaysBetween(from, to) {
  const a = Date.parse(from + "T00:00:00");
  const b = Date.parse(to + "T00:00:00");
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * Update a streak record for a session finished on `today`. Same day, no
 * change; the next day, +1; any longer gap starts again at 1.
 */
function nbackUpdateStreak(streak, today) {
  const prev = streak && typeof streak.count === "number" ? streak : { count: 0, last: null };
  if (!prev.last) return { count: 1, last: today };
  const gap = nbackDaysBetween(prev.last, today);
  if (gap === 0) return { count: Math.max(1, prev.count), last: today };
  if (gap === 1) return { count: prev.count + 1, last: today };
  return { count: 1, last: today };
}

/* The rung, not the score — n-level is an integer that lives in 1-5 for
   essentially everyone, which is exactly why it is a badge on this test and
   never the charted series. */
const NBACK_TIERS = [
  { min: 0, max: 1, label: "1-back — the warm-up rung: just watch for an immediate repeat" },
  { min: 2, max: 2, label: "2-back — where most people start and where a lot of people stay" },
  { min: 3, max: 3, label: "3-back — clearly above the starting rung; this is real work" },
  { min: 4, max: 4, label: "4-back — strong. Sustaining this over a full session is uncommon" },
  { min: 5, max: 5, label: "5-back — rare territory for a single-stream task" },
  { min: 6, max: Infinity, label: "6-back or higher — extraordinary, and worth checking you are not counting rhythm instead of position" },
];

function nbackRatingTier(n) {
  return lookupTier(NBACK_TIERS, n);
}

/* ===================================================================== */
/* ============================= DOM WIRING ============================= */
/* ===================================================================== */

if (typeof document !== "undefined") {
  (function () {
    "use strict";

    /* ---- theme toggle ---- */

    (function initTheme() {
      const stored = localStorage.getItem("cmt-theme");
      if (stored) document.documentElement.setAttribute("data-theme", stored);
      const btn = document.getElementById("theme-toggle");
      if (!btn) return;
      btn.addEventListener("click", function () {
        const current =
          document.documentElement.getAttribute("data-theme") ||
          (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
        const next = current === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("cmt-theme", next);
      });
    })();

    /* ==================================================================== *
     * toolbar v1 — the portfolio navigation pattern.                       *
     * Spec: github.com/ngineer420/ngineer420.github.io/issues/13          *
     *                                                                     *
     * Copy this block verbatim into any site in the portfolio. It is pure *
     * enhancement: with JS off, <details>/<summary> still discloses the   *
     * sheet, the rail is still a native scroll container of real links,   *
     * the edge fades are still CSS and the scrim is still CSS. Only the   *
     * active-chip centring, Escape and click-outside are lost.            *
     * ================================================================== */
    function initToolbar() {
      var bar = document.querySelector(".toolbar");
      if (!bar) return;
      var rail = bar.querySelector(".tb-rail");
      var menu = bar.querySelector("details.tb-menu");

      if (rail) {
        // js-on hands the right-hand fade over to measurement. Until then the
        // CSS keeps it on, so a JS-disabled visitor never gets a chip clipped
        // mid-word with nothing to say there is more of the row.
        rail.classList.add("js-on");
        var fades = function () {
          var max = rail.scrollWidth - rail.clientWidth;
          rail.classList.toggle("can-l", rail.scrollLeft > 1);
          rail.classList.toggle("can-r", rail.scrollLeft < max - 1);
        };
        // Assigning scrollLeft, never scrollIntoView: that also scrolls every
        // ancestor and the document, which on a phone drops the visitor below
        // the header on arrival.
        var current = rail.querySelector("[aria-current]");
        if (current) {
          rail.scrollLeft = Math.max(
            0,
            current.offsetLeft - (rail.clientWidth - current.offsetWidth) / 2
          );
        }
        rail.addEventListener("scroll", fades, { passive: true });
        window.addEventListener("resize", fades);
        fades();
      }

      if (menu) {
        // A disclosure, not a modal: focus is deliberately not trapped, Tab
        // walks the links and straight out the other side.
        window.addEventListener("keydown", function (e) {
          if (e.key !== "Escape" || !menu.open) return;
          menu.open = false;
          var summary = menu.querySelector("summary");
          if (summary) summary.focus();
        });
        document.addEventListener("click", function (e) {
          if (menu.open && !menu.contains(e.target)) menu.open = false;
        });
      }
    }

    /* ---- homepage: the toolbar's own links switch the five game panels ----
     *
     * The homepage carries all five games. The toolbar is the only nav layer
     * on the page, so its links do double duty here: a plain left click swaps
     * the panel in place and replaces the URL with that test's real address,
     * exactly as the old role="tablist" strip did, while a modified click, a
     * JS-disabled visitor and every crawler get ordinary navigation to the
     * standalone page — which is the same game.
     */
    function initHomePanels() {
      var bar = document.querySelector(".toolbar");
      if (!bar) return;
      var PANELS = {
        "/chimp-test": "panel-chimp",
        "/sequence-memory-test": "panel-sequence",
        "/number-memory-test": "panel-number",
        "/visual-memory-test": "panel-visual",
        "/verbal-memory-test": "panel-verbal",
      };
      var links = Array.prototype.slice.call(bar.querySelectorAll("a[href]"));
      var keys = Object.keys(PANELS);
      var panels = {};
      for (var i = 0; i < keys.length; i++) {
        var el = document.getElementById(PANELS[keys[i]]);
        if (!el) return; // a standalone test page: no panels to switch
        panels[keys[i]] = el;
      }
      var rail = bar.querySelector(".tb-rail");
      var menu = bar.querySelector("details.tb-menu");

      function pathOf(a) {
        return (a.getAttribute("href") || "").replace(/\.html$/, "").replace(/\/$/, "");
      }

      function show(path, moveFocus) {
        keys.forEach(function (k) {
          var on = k === path;
          panels[k].hidden = !on;
          panels[k].classList.toggle("active", on);
        });
        links.forEach(function (a) {
          if (pathOf(a) === path) a.setAttribute("aria-current", "page");
          else a.removeAttribute("aria-current");
        });
        if (rail) {
          var cur = rail.querySelector("[aria-current]");
          if (cur) {
            rail.scrollLeft = Math.max(
              0,
              cur.offsetLeft - (rail.clientWidth - cur.offsetWidth) / 2
            );
          }
        }
        if (moveFocus) panels[path].focus();
      }

      links.forEach(function (a) {
        var path = pathOf(a);
        if (!panels[path]) return;
        a.addEventListener("click", function (e) {
          // Modified and non-primary clicks fall through to real navigation so
          // middle-click and cmd/ctrl-click still open the standalone page.
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
            return;
          e.preventDefault();
          if (menu) menu.open = false;
          show(path, true);
          try {
            history.pushState({ tool: path }, "", path);
          } catch (err) {
            /* history unavailable — the anchor is still a real link */
          }
        });
      });

      window.addEventListener("popstate", function (e) {
        var path = (e.state && e.state.tool) || null;
        if (!path || !panels[path]) {
          path = location.pathname.replace(/\.html$/, "").replace(/\/$/, "");
        }
        show(panels[path] ? path : keys[0], false);
      });

      // Default panel = the Chimp Test, the test this domain is named for.
      // Seed a baseline entry so Back after switching returns here cleanly.
      show(keys[0], false);
      try {
        history.replaceState(
          { tool: keys[0] },
          "",
          location.pathname + location.search
        );
      } catch (err) {
        /* ignore */
      }
    }

    initToolbar();
    initHomePanels();

    const yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    /* ---- shared storage helpers ---- */

    function getBest(key) {
      const raw = localStorage.getItem(key);
      const n = raw ? parseInt(raw, 10) : 0;
      return isNaN(n) ? 0 : n;
    }

    function setBest(key, value) {
      try {
        localStorage.setItem(key, String(value));
      } catch (e) {
        /* private browsing / quota — degrade silently */
      }
    }

    function getHistory(key) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    }

    function setHistory(key, history) {
      try {
        localStorage.setItem(key, JSON.stringify(history));
      } catch (e) {
        /* ignore */
      }
    }

    function getDistribution(key) {
      try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }

    function setDistribution(key, dist) {
      try {
        localStorage.setItem(key, JSON.stringify(dist));
      } catch (e) {
        /* ignore */
      }
    }

    const SVG_NS = "http://www.w3.org/2000/svg";
    const SPARK_W = 320;
    const SPARK_H = 48;
    const SPARK_SPAN = 20; // attempts shown in the trend

    function svgEl(name, attrs) {
      const el = document.createElementNS(SVG_NS, name);
      Object.keys(attrs).forEach(function (k) {
        el.setAttribute(k, String(attrs[k]));
      });
      return el;
    }

    /**
     * Render the "how did that go" block under a result: a new-personal-best
     * callout, a percentile against this device's own past attempts, and a
     * sparkline of the recent trend.
     *
     * `priorDist` must be the distribution *before* this attempt was added, so
     * the percentile compares the score against previous attempts rather than
     * against itself.
     */
    function renderTrend(trendEl, opts) {
      if (!trendEl) return;
      trendEl.innerHTML = "";
      const dist = opts.dist || [];
      const prior = opts.priorDist || [];
      const unit = opts.unitLabel || "";

      if (opts.isNewBest && prior.length) {
        const pb = document.createElement("p");
        pb.className = "pb-line";
        pb.textContent = "New personal best — " + opts.score + " " + unit + ".";
        trendEl.appendChild(pb);
      }

      const pct = prior.length >= 3 ? percentileRank(prior, opts.score) : null;
      if (pct !== null) {
        const line = document.createElement("p");
        line.className = "pct-line";
        line.textContent =
          "Better than " + pct + "% of your " + prior.length +
          " previous attempt" + (prior.length === 1 ? "" : "s") + " on this device.";
        trendEl.appendChild(line);
      }

      const series = dist.slice(-SPARK_SPAN);
      if (series.length >= 2) {
        const points = sparklinePoints(series, SPARK_W, SPARK_H, 5);
        const svg = svgEl("svg", {
          class: "sparkline",
          viewBox: "0 0 " + SPARK_W + " " + SPARK_H,
          preserveAspectRatio: "none",
          role: "img",
          "aria-label":
            "Trend of your last " + series.length + " attempts, oldest first: " +
            series.join(", ") + " " + unit,
        });
        // Filled area under the line, then the line itself. `non-scaling-stroke`
        // keeps the stroke even weight despite preserveAspectRatio="none".
        svg.appendChild(svgEl("polygon", {
          class: "spark-area",
          points: "0," + SPARK_H + " " + points + " " + SPARK_W + "," + SPARK_H,
        }));
        svg.appendChild(svgEl("polyline", {
          class: "spark-line",
          points: points,
          "vector-effect": "non-scaling-stroke",
        }));
        trendEl.appendChild(svg);

        const caption = document.createElement("p");
        caption.className = "spark-caption";
        caption.textContent = "Your last " + series.length + " attempts, oldest to newest.";
        trendEl.appendChild(caption);
      }

      trendEl.hidden = !trendEl.firstChild;
    }

    function formatDate(iso) {
      try {
        return new Date(iso).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
      } catch (e) {
        return iso;
      }
    }

    function renderHistoryList(listEl, history, unitLabel) {
      listEl.innerHTML = "";
      if (!history.length) {
        const li = document.createElement("li");
        li.className = "history-empty";
        li.textContent = "No attempts yet — play a round to start your history.";
        listEl.appendChild(li);
        return;
      }
      history.forEach(function (entry) {
        const li = document.createElement("li");
        const score = document.createElement("span");
        score.className = "history-score";
        score.textContent = entry.score + " " + unitLabel;
        const date = document.createElement("span");
        date.className = "history-date";
        date.textContent = formatDate(entry.date);
        li.appendChild(score);
        li.appendChild(date);
        listEl.appendChild(li);
      });
    }

    /* ========================= CHIMP TEST ========================= */

    (function chimpTool() {
      const board = document.getElementById("chimp-board");
      const levelEl = document.getElementById("chimp-level");
      const bestEl = document.getElementById("chimp-best");
      const instructions = document.getElementById("chimp-instructions");
      const startBtn = document.getElementById("chimp-start");
      const gamePanel = document.getElementById("chimp-game-panel");
      const resultsPanel = document.getElementById("chimp-results");
      const finalLevelEl = document.getElementById("chimp-final-level");
      const tierEl = document.getElementById("chimp-tier");
      const restartBtn = document.getElementById("chimp-restart");
      const historyList = document.getElementById("chimp-history-list");
      if (!board) return; // markup for this test isn't on the page

      const BEST_KEY = "cmt-chimp-best";
      const HISTORY_KEY = "cmt-chimp-history";
      const DIST_KEY = "cmt-chimp-dist";
      const trendEl = document.getElementById("chimp-trend");
      const START_COUNT = 4;

      let count = START_COUNT;
      let round = null; // { rows, cols, totalCells, tiles }
      let nextExpected = 1;
      let revealed = true;
      let bestCompletedCount = 0;
      let playing = false;

      bestEl.textContent = getBest(BEST_KEY);

      function buildBoard() {
        board.innerHTML = "";
        board.style.setProperty("--cols", round.cols);
        board.style.setProperty("--rows", round.rows);
        for (let cell = 0; cell < round.totalCells; cell++) {
          const tile = round.tiles.find(function (t) {
            return t.cell === cell;
          });
          const slot = document.createElement(tile ? "button" : "div");
          slot.className = "board-cell" + (tile ? " tile" : "");
          if (tile) {
            slot.type = "button";
            slot.dataset.cell = String(cell);
            slot.dataset.number = String(tile.number);
            slot.textContent = String(tile.number);
            slot.addEventListener("click", onTileClick);
          }
          board.appendChild(slot);
        }
      }

      function startRound() {
        round = chimpGenerateLayout(count);
        nextExpected = 1;
        revealed = true;
        playing = true;
        instructions.textContent =
          count === START_COUNT
            ? "Click the tiles in order, 1 → " + count + ". They'll vanish the instant you start."
            : "Level " + (count - START_COUNT + 1) + " — click 1 → " + count + ".";
        levelEl.textContent = String(count - START_COUNT + 1);
        startBtn.hidden = true;
        resultsPanel.hidden = true;
        gamePanel.hidden = false;
        buildBoard();
      }

      function hideNumbers() {
        revealed = false;
        Array.from(board.querySelectorAll(".tile")).forEach(function (el) {
          el.textContent = "";
          el.classList.add("blank");
        });
      }

      function onTileClick(e) {
        if (!playing) return;
        const cell = parseInt(e.currentTarget.dataset.cell, 10);
        const result = chimpCheckClick(round.tiles, cell, nextExpected);
        if (!result.valid) return;
        if (!result.correct) {
          endGame();
          return;
        }
        e.currentTarget.classList.add("correct-flash");
        if (revealed) hideNumbers();
        if (result.complete) {
          bestCompletedCount = count;
          count += 1;
          setTimeout(startRound, 500);
        } else {
          nextExpected += 1;
        }
      }

      function endGame() {
        playing = false;
        Array.from(board.querySelectorAll(".tile")).forEach(function (el) {
          el.disabled = true;
          if (parseInt(el.dataset.number, 10) === nextExpected) el.classList.add("wrong-flash");
          el.textContent = el.dataset.number;
          el.classList.remove("blank");
        });
        const finalCount = bestCompletedCount; // 0 if failed on the very first round
        const prevBest = getBest(BEST_KEY);
        const priorDist = getDistribution(DIST_KEY);
        const best = Math.max(prevBest, finalCount);
        setBest(BEST_KEY, best);
        const history = pushHistory(getHistory(HISTORY_KEY), {
          score: finalCount,
          date: new Date().toISOString(),
        });
        setHistory(HISTORY_KEY, history);
        const dist = pushDistribution(priorDist, finalCount);
        setDistribution(DIST_KEY, dist);
        renderTrend(trendEl, {
          score: finalCount,
          isNewBest: finalCount > prevBest,
          priorDist: priorDist,
          dist: dist,
          unitLabel: "tiles",
        });
        bestEl.textContent = String(best);

        finalLevelEl.textContent = String(finalCount);
        tierEl.textContent = chimpRatingTier(finalCount);
        renderHistoryList(historyList, history, "tiles");

        setTimeout(function () {
          gamePanel.hidden = true;
          resultsPanel.hidden = false;
        }, 650);
      }

      function resetAndStart() {
        count = START_COUNT;
        bestCompletedCount = 0;
        startRound();
      }

      startBtn.addEventListener("click", startRound);
      restartBtn.addEventListener("click", resetAndStart);

      renderHistoryList(historyList, getHistory(HISTORY_KEY), "tiles");
    })();

    /* ======================= SEQUENCE MEMORY ======================= */

    (function sequenceTool() {
      const board = document.getElementById("sequence-board");
      const levelEl = document.getElementById("sequence-level");
      const bestEl = document.getElementById("sequence-best");
      const instructions = document.getElementById("sequence-instructions");
      const startBtn = document.getElementById("sequence-start");
      const gamePanel = document.getElementById("sequence-game-panel");
      const resultsPanel = document.getElementById("sequence-results");
      const finalLevelEl = document.getElementById("sequence-final-level");
      const tierEl = document.getElementById("sequence-tier");
      const restartBtn = document.getElementById("sequence-restart");
      const historyList = document.getElementById("sequence-history-list");
      if (!board) return; // markup for this test isn't on the page

      const BEST_KEY = "cmt-sequence-best";
      const HISTORY_KEY = "cmt-sequence-history";
      const DIST_KEY = "cmt-sequence-dist";
      const trendEl = document.getElementById("sequence-trend");
      const GRID_SIZE = 9; // 3x3
      const START_LENGTH = 3;

      let sequence = [];
      let inputs = [];
      let level = 0; // highest length fully reproduced so far
      let accepting = false;
      let tiles = [];

      bestEl.textContent = getBest(BEST_KEY);

      function buildBoard() {
        board.innerHTML = "";
        tiles = [];
        for (let i = 0; i < GRID_SIZE; i++) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "seq-tile";
          btn.dataset.index = String(i);
          btn.addEventListener("click", function () {
            onTileClick(i);
          });
          board.appendChild(btn);
          tiles.push(btn);
        }
      }

      function flash(el, cls, ms) {
        return new Promise(function (resolve) {
          el.classList.add(cls);
          setTimeout(function () {
            el.classList.remove(cls);
            resolve();
          }, ms);
        });
      }

      function sleep(ms) {
        return new Promise(function (resolve) {
          setTimeout(resolve, ms);
        });
      }

      async function playSequence() {
        accepting = false;
        instructions.textContent = "Watch closely…";
        await sleep(500);
        for (let i = 0; i < sequence.length; i++) {
          await flash(tiles[sequence[i]], "lit", 450);
          await sleep(180);
        }
        instructions.textContent = "Now repeat it back.";
        accepting = true;
        inputs = [];
      }

      function startRound() {
        sequence = sequenceAppend(sequence, GRID_SIZE);
        levelEl.textContent = String(sequence.length);
        startBtn.hidden = true;
        resultsPanel.hidden = true;
        gamePanel.hidden = false;
        if (!tiles.length) buildBoard();
        playSequence();
      }

      function onTileClick(index) {
        if (!accepting) return;
        inputs.push(index);
        const result = sequenceCheckStep(sequence, inputs);
        if (!result.correct) {
          flash(tiles[index], "wrong", 400);
          endGame();
          return;
        }
        flash(tiles[index], "picked", 250);
        if (result.complete) {
          level = sequence.length;
          accepting = false;
          instructions.textContent = "Nice — level " + level + " locked in.";
          setTimeout(startRound, 700);
        }
      }

      function endGame() {
        accepting = false;
        const prevBest = getBest(BEST_KEY);
        const priorDist = getDistribution(DIST_KEY);
        const best = Math.max(prevBest, level);
        setBest(BEST_KEY, best);
        const history = pushHistory(getHistory(HISTORY_KEY), {
          score: level,
          date: new Date().toISOString(),
        });
        setHistory(HISTORY_KEY, history);
        const dist = pushDistribution(priorDist, level);
        setDistribution(DIST_KEY, dist);
        renderTrend(trendEl, {
          score: level,
          isNewBest: level > prevBest,
          priorDist: priorDist,
          dist: dist,
          unitLabel: "tiles",
        });
        bestEl.textContent = String(best);

        finalLevelEl.textContent = String(level);
        tierEl.textContent = sequenceRatingTier(level);
        renderHistoryList(historyList, history, "tiles long");

        setTimeout(function () {
          gamePanel.hidden = true;
          resultsPanel.hidden = false;
        }, 550);
      }

      function resetAndStart() {
        sequence = [];
        level = 0;
        startRound();
      }

      startBtn.addEventListener("click", startRound);
      restartBtn.addEventListener("click", resetAndStart);

      renderHistoryList(historyList, getHistory(HISTORY_KEY), "tiles long");
    })();

    /* ======================== NUMBER MEMORY ======================== */

    (function numberTool() {
      const display = document.getElementById("number-display");
      const digitsEl = document.getElementById("number-digits");
      const bestEl = document.getElementById("number-best");
      const instructions = document.getElementById("number-instructions");
      const startBtn = document.getElementById("number-start");
      const gamePanel = document.getElementById("number-game-panel");
      const resultsPanel = document.getElementById("number-results");
      const finalDigitsEl = document.getElementById("number-final-digits");
      const tierEl = document.getElementById("number-tier");
      const restartBtn = document.getElementById("number-restart");
      const historyList = document.getElementById("number-history-list");
      const form = document.getElementById("number-form");
      const input = document.getElementById("number-input");
      const answerField = form;
      if (!display) return; // markup for this test isn't on the page

      const BEST_KEY = "cmt-number-best";
      const HISTORY_KEY = "cmt-number-history";
      const DIST_KEY = "cmt-number-dist";
      const trendEl = document.getElementById("number-trend");
      const START_LENGTH = 3;
      const REVEAL_MS_BASE = 1200;
      const REVEAL_MS_PER_DIGIT = 350;

      let length = START_LENGTH;
      let target = "";
      let lastCompleted = 0;

      bestEl.textContent = getBest(BEST_KEY);

      function startRound() {
        target = numberGenerate(length);
        digitsEl.textContent = String(length);
        instructions.textContent = "Memorize the number…";
        display.textContent = target;
        display.classList.remove("hidden-number");
        startBtn.hidden = true;
        resultsPanel.hidden = true;
        gamePanel.hidden = false;
        answerField.hidden = true;
        input.value = "";

        const revealTime = REVEAL_MS_BASE + length * REVEAL_MS_PER_DIGIT;
        setTimeout(function () {
          display.textContent = "•".repeat(length);
          display.classList.add("hidden-number");
          instructions.textContent = "Type the number back.";
          answerField.hidden = false;
          input.focus();
        }, revealTime);
      }

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (answerField.hidden) return;
        const ok = numberCheckAnswer(target, input.value);
        if (ok) {
          lastCompleted = length;
          length += 1;
          instructions.textContent = "Correct! Next: " + length + " digits.";
          answerField.hidden = true;
          setTimeout(startRound, 600);
        } else {
          endGame();
        }
      });

      function endGame() {
        const prevBest = getBest(BEST_KEY);
        const priorDist = getDistribution(DIST_KEY);
        const best = Math.max(prevBest, lastCompleted);
        setBest(BEST_KEY, best);
        const history = pushHistory(getHistory(HISTORY_KEY), {
          score: lastCompleted,
          date: new Date().toISOString(),
        });
        setHistory(HISTORY_KEY, history);
        const dist = pushDistribution(priorDist, lastCompleted);
        setDistribution(DIST_KEY, dist);
        renderTrend(trendEl, {
          score: lastCompleted,
          isNewBest: lastCompleted > prevBest,
          priorDist: priorDist,
          dist: dist,
          unitLabel: "digits",
        });
        bestEl.textContent = String(best);

        finalDigitsEl.textContent = String(lastCompleted);
        tierEl.textContent = numberRatingTier(lastCompleted);
        renderHistoryList(historyList, history, "digits");

        gamePanel.hidden = true;
        resultsPanel.hidden = false;
      }

      function resetAndStart() {
        length = START_LENGTH;
        lastCompleted = 0;
        startRound();
      }

      startBtn.addEventListener("click", startRound);
      restartBtn.addEventListener("click", resetAndStart);

      renderHistoryList(historyList, getHistory(HISTORY_KEY), "digits");
    })();

    /* ======================== VISUAL MEMORY ======================== */

    (function visualTool() {
      const board = document.getElementById("visual-board");
      const levelEl = document.getElementById("visual-level");
      const livesEl = document.getElementById("visual-lives");
      const bestEl = document.getElementById("visual-best");
      const instructions = document.getElementById("visual-instructions");
      const startBtn = document.getElementById("visual-start");
      const gamePanel = document.getElementById("visual-game-panel");
      const resultsPanel = document.getElementById("visual-results");
      const finalLevelEl = document.getElementById("visual-final-level");
      const tierEl = document.getElementById("visual-tier");
      const restartBtn = document.getElementById("visual-restart");
      const historyList = document.getElementById("visual-history-list");
      if (!board) return; // markup for this test isn't on the page

      const BEST_KEY = "cmt-visual-best";
      const HISTORY_KEY = "cmt-visual-history";
      const DIST_KEY = "cmt-visual-dist";
      const trendEl = document.getElementById("visual-trend");
      const START_LEVEL = 1;
      const LIVES = 3;
      const FLASH_MS = 900;

      let level = START_LEVEL;
      let lives = LIVES;
      let round = null; // { side, totalCells, litCells }
      let litSet = {};
      let remaining = 0;
      let picked = {};
      let accepting = false;

      bestEl.textContent = getBest(BEST_KEY);

      function sleep(ms) {
        return new Promise(function (resolve) {
          setTimeout(resolve, ms);
        });
      }

      function buildBoard() {
        board.innerHTML = "";
        board.style.setProperty("--cols", round.side);
        board.style.setProperty("--rows", round.side);
        for (let cell = 0; cell < round.totalCells; cell++) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "visual-cell";
          btn.dataset.cell = String(cell);
          btn.addEventListener("click", onCellClick);
          board.appendChild(btn);
        }
      }

      function cellEl(cell) {
        return board.querySelector('.visual-cell[data-cell="' + cell + '"]');
      }

      async function startLevel() {
        round = visualGenerateLayout(level);
        litSet = {};
        round.litCells.forEach(function (c) {
          litSet[c] = true;
        });
        remaining = round.litCells.length;
        picked = {};
        accepting = false;
        levelEl.textContent = String(level);
        livesEl.textContent = String(lives);
        startBtn.hidden = true;
        resultsPanel.hidden = true;
        gamePanel.hidden = false;
        buildBoard();
        instructions.textContent = "Memorize the highlighted tiles…";
        await sleep(350);
        round.litCells.forEach(function (c) {
          const el = cellEl(c);
          if (el) el.classList.add("flash");
        });
        await sleep(FLASH_MS);
        round.litCells.forEach(function (c) {
          const el = cellEl(c);
          if (el) el.classList.remove("flash");
        });
        instructions.textContent = "Now click the tiles that flashed.";
        accepting = true;
      }

      function onCellClick(e) {
        if (!accepting) return;
        const cell = parseInt(e.currentTarget.dataset.cell, 10);
        if (picked[cell]) return; // ignore repeat clicks on the same tile
        picked[cell] = true;
        const el = e.currentTarget;
        if (litSet[cell]) {
          el.classList.add("correct");
          remaining -= 1;
          if (remaining === 0) {
            accepting = false;
            level += 1;
            instructions.textContent = "Level cleared!";
            setTimeout(startLevel, 550);
          }
        } else {
          el.classList.add("wrong");
          lives -= 1;
          livesEl.textContent = String(lives);
          if (lives <= 0) {
            accepting = false;
            endGame();
          }
        }
      }

      function endGame() {
        // Reveal any lit tiles the player hadn't found yet.
        round.litCells.forEach(function (c) {
          const el = cellEl(c);
          if (el && !el.classList.contains("correct")) el.classList.add("missed");
        });
        const reached = level; // the level they were on when they ran out of lives
        const prevBest = getBest(BEST_KEY);
        const priorDist = getDistribution(DIST_KEY);
        const best = Math.max(prevBest, reached);
        setBest(BEST_KEY, best);
        const history = pushHistory(getHistory(HISTORY_KEY), {
          score: reached,
          date: new Date().toISOString(),
        });
        setHistory(HISTORY_KEY, history);
        const dist = pushDistribution(priorDist, reached);
        setDistribution(DIST_KEY, dist);
        renderTrend(trendEl, {
          score: reached,
          isNewBest: reached > prevBest,
          priorDist: priorDist,
          dist: dist,
          unitLabel: "levels",
        });
        bestEl.textContent = String(best);

        finalLevelEl.textContent = String(reached);
        tierEl.textContent = visualRatingTier(reached);
        renderHistoryList(historyList, history, "level");

        setTimeout(function () {
          gamePanel.hidden = true;
          resultsPanel.hidden = false;
        }, 700);
      }

      function resetAndStart() {
        level = START_LEVEL;
        lives = LIVES;
        startLevel();
      }

      startBtn.addEventListener("click", resetAndStart);
      restartBtn.addEventListener("click", resetAndStart);

      renderHistoryList(historyList, getHistory(HISTORY_KEY), "level");
    })();

    /* ======================== VERBAL MEMORY ======================== */

    (function verbalTool() {
      const wordEl = document.getElementById("verbal-word");
      const scoreEl = document.getElementById("verbal-score");
      const livesEl = document.getElementById("verbal-lives");
      const bestEl = document.getElementById("verbal-best");
      const instructions = document.getElementById("verbal-instructions");
      const startBtn = document.getElementById("verbal-start");
      const gamePanel = document.getElementById("verbal-game-panel");
      const resultsPanel = document.getElementById("verbal-results");
      const finalScoreEl = document.getElementById("verbal-final-score");
      const tierEl = document.getElementById("verbal-tier");
      const restartBtn = document.getElementById("verbal-restart");
      const historyList = document.getElementById("verbal-history-list");
      const buttons = document.getElementById("verbal-buttons");
      const seenBtn = document.getElementById("verbal-seen");
      const newBtn = document.getElementById("verbal-new");
      if (!wordEl) return; // markup for this test isn't on the page

      const BEST_KEY = "cmt-verbal-best";
      const HISTORY_KEY = "cmt-verbal-history";
      const DIST_KEY = "cmt-verbal-dist";
      const trendEl = document.getElementById("verbal-trend");
      const LIVES = 3;
      const POOL = [
        "apple", "river", "candle", "market", "planet", "shadow", "bridge", "forest",
        "silver", "window", "garden", "engine", "pocket", "marble", "throne", "pillow",
        "anchor", "velvet", "meadow", "copper", "lantern", "harbor", "pepper", "ribbon",
        "saddle", "cactus", "puzzle", "tunnel", "orchid", "cobweb", "dagger", "ferry",
        "glacier", "hazard", "island", "jacket", "kettle", "ladder", "magnet", "napkin",
        "orbit", "parlor", "quartz", "raisin", "sonnet", "temple", "utopia", "violin",
        "walnut", "yonder", "zephyr", "acorn", "beacon", "cinder", "dapper", "ember",
        "fable", "gravel", "hollow", "ingot", "jasper", "kernel", "linen", "mosaic",
        "nectar", "outpost", "prairie", "quiver", "rustle", "satchel", "timber", "umber",
        "vessel", "willow", "yeoman", "zenith", "amber", "basil", "crimson", "denim",
        "eagle", "flint", "gopher", "hearth", "ivory", "jungle", "kiosk", "lilac",
        "mango", "nomad", "onyx", "prism", "quilt", "raven", "sable", "tulip",
        "urchin", "vapor", "wharf", "xenon", "yacht", "zebra", "almond", "bison",
        "clover", "dune", "echo", "fjord", "grotto", "heron", "igloo", "jetty",
        "koala", "lagoon", "mural", "needle", "otter", "petal", "quokka", "reef",
        "spruce", "trout", "udder", "vixen", "wagon", "yolk", "zircon", "badge",
        "cove", "drift", "flare", "gorge", "husk", "inlet", "juror", "knoll",
      ];

      let score = 0;
      let lives = LIVES;
      let used = [];
      let currentSeen = false;
      let accepting = false;

      bestEl.textContent = getBest(BEST_KEY);

      function nextWord() {
        const pick = verbalPickWord(POOL, used, Math.random, 0.42);
        currentSeen = pick.isSeen;
        if (!pick.isSeen) used.push(pick.word);
        wordEl.textContent = pick.word;
        wordEl.classList.remove("verbal-correct", "verbal-wrong");
        accepting = true;
      }

      function answer(choice) {
        if (!accepting) return;
        accepting = false;
        const correct = verbalCheckAnswer(currentSeen, choice);
        if (correct) {
          score += 1;
          scoreEl.textContent = String(score);
          wordEl.classList.add("verbal-correct");
          setTimeout(nextWord, 220);
        } else {
          lives -= 1;
          livesEl.textContent = String(lives);
          wordEl.classList.add("verbal-wrong");
          if (lives <= 0) {
            endGame();
          } else {
            setTimeout(nextWord, 320);
          }
        }
      }

      function startGame() {
        score = 0;
        lives = LIVES;
        used = [];
        scoreEl.textContent = "0";
        livesEl.textContent = String(lives);
        startBtn.hidden = true;
        resultsPanel.hidden = true;
        gamePanel.hidden = false;
        buttons.hidden = false;
        instructions.textContent =
          "Have you seen this word before, this game? Mark it SEEN or NEW.";
        nextWord();
      }

      function endGame() {
        accepting = false;
        buttons.hidden = true;
        const prevBest = getBest(BEST_KEY);
        const priorDist = getDistribution(DIST_KEY);
        const best = Math.max(prevBest, score);
        setBest(BEST_KEY, best);
        const history = pushHistory(getHistory(HISTORY_KEY), {
          score: score,
          date: new Date().toISOString(),
        });
        setHistory(HISTORY_KEY, history);
        const dist = pushDistribution(priorDist, score);
        setDistribution(DIST_KEY, dist);
        renderTrend(trendEl, {
          score: score,
          isNewBest: score > prevBest,
          priorDist: priorDist,
          dist: dist,
          unitLabel: "words",
        });
        bestEl.textContent = String(best);

        finalScoreEl.textContent = String(score);
        tierEl.textContent = verbalRatingTier(score);
        renderHistoryList(historyList, history, "words");

        setTimeout(function () {
          gamePanel.hidden = true;
          resultsPanel.hidden = false;
        }, 500);
      }

      seenBtn.addEventListener("click", function () {
        answer("seen");
      });
      newBtn.addEventListener("click", function () {
        answer("new");
      });
      startBtn.addEventListener("click", startGame);
      restartBtn.addEventListener("click", startGame);

      renderHistoryList(historyList, getHistory(HISTORY_KEY), "words");
    })();

    /* =========================== N-BACK =========================== */
    /* The one test here with a running clock. Everything else on this site is
       turn-based: the board waits for you. An n-back trial does not — it
       appears, it goes, and the answer window closes with it. That is the
       point of the task and it is why this tool owns a timer the others do
       not. The measurement itself is still pure: the block is dealt by
       nbackGenerateSequence and scored by nbackScore, both above the DOM
       divider and both Node-checkable. */

    (function nbackTool() {
      const grid = document.getElementById("nback-grid");
      if (!grid) return; // markup for this test isn't on the page

      const levelEl = document.getElementById("nback-level");
      const blockEl = document.getElementById("nback-block");
      const streakEl = document.getElementById("nback-streak");
      const bestEl = document.getElementById("nback-best");
      const instructions = document.getElementById("nback-instructions");
      const startBtn = document.getElementById("nback-start");
      const matchBtn = document.getElementById("nback-match");
      const gamePanel = document.getElementById("nback-game-panel");
      const resultsPanel = document.getElementById("nback-results");
      const restartBtn = document.getElementById("nback-restart");
      const historyList = document.getElementById("nback-history-list");
      const trendEl = document.getElementById("nback-trend");
      const dEl = document.getElementById("nback-final-d");
      const badgeEl = document.getElementById("nback-level-badge");
      const tierEl = document.getElementById("nback-tier");
      const hitsEl = document.getElementById("nback-hits");
      const missesEl = document.getElementById("nback-misses");
      const faEl = document.getElementById("nback-false");
      const accEl = document.getElementById("nback-accuracy");
      const ladderEl = document.getElementById("nback-ladder");
      const streakLineEl = document.getElementById("nback-streak-line");
      const dayNoteEl = document.getElementById("nback-day-note");

      const BEST_KEY = "cmt-nback-best";       // highest rung ever reached (an integer)
      const HISTORY_KEY = "cmt-nback-history"; // last 10 sessions, scored in d'
      const DIST_KEY = "cmt-nback-dist";       // the charted series, also d'
      const LEVEL_KEY = "cmt-nback-level";     // the rung you are on, kept between days
      const STREAK_KEY = "cmt-nback-streak";
      const DAY_KEY = "cmt-nback-day";

      const BLOCKS_PER_SESSION = 3;
      const BASE_TRIALS = 20;      // plus n, since the first n trials cannot be scored
      const TARGET_RATE = 0.3;
      const TRIAL_MS = 2500;
      const STIM_MS = 500;

      let level = readLevel();
      let cleanStreak = 0;
      let blockIndex = 0;          // 0..BLOCKS_PER_SESSION-1 within this session
      let sequence = [];
      let responses = [];
      let trial = -1;
      let blockScores = [];
      let running = false;
      let timer = null;
      let stimTimer = null;
      let blockStartedAt = 0;
      let cells = [];

      function readLevel() {
        const n = parseInt(localStorage.getItem(LEVEL_KEY), 10);
        return isNaN(n) || n < 1 ? 2 : Math.min(n, 9);
      }
      function readJson(key, fallback) {
        try {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
          return fallback;
        }
      }
      function writeJson(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
      }

      /* How many blocks have already been dealt today. It is part of the seed,
         so reloading the page mid-session deals the NEXT block rather than the
         one you just saw — the day's boards are fixed, not repeatable. */
      function dayRecord() {
        const today = nbackDayKey();
        const rec = readJson(DAY_KEY, null);
        if (!rec || rec.date !== today) return { date: today, blocks: 0 };
        return { date: today, blocks: typeof rec.blocks === "number" ? rec.blocks : 0 };
      }

      function buildGrid() {
        grid.innerHTML = "";
        cells = [];
        for (let i = 0; i < 9; i++) {
          const cell = document.createElement("div");
          cell.className = "nback-cell";
          grid.appendChild(cell);
          cells.push(cell);
        }
      }

      function paintStatus() {
        levelEl.textContent = String(level);
        blockEl.textContent = Math.min(blockIndex + 1, BLOCKS_PER_SESSION) + " of " + BLOCKS_PER_SESSION;
        bestEl.textContent = String(getBest(BEST_KEY));
        const streak = readJson(STREAK_KEY, { count: 0, last: null });
        streakEl.textContent = String(streak.count || 0);
      }

      function clearTimers() {
        if (timer) { clearTimeout(timer); timer = null; }
        if (stimTimer) { clearTimeout(stimTimer); stimTimer = null; }
      }

      function startSession() {
        clearTimers();
        blockIndex = 0;
        blockScores = [];
        resultsPanel.hidden = true;
        gamePanel.hidden = false;
        startBtn.hidden = true;
        matchBtn.hidden = false;
        startBlock();
      }

      function startBlock() {
        const rec = dayRecord();
        // The rung is in the seed as well as the date: a target is defined
        // relative to n, so the same sequence is a different task at every
        // level and two players on different rungs cannot share a board.
        const rng = createRng(nbackDailySeed(rec.date, level, rec.blocks));
        sequence = nbackGenerateSequence(BASE_TRIALS + level, level, TARGET_RATE, rng);
        responses = sequence.map(function () { return false; });
        trial = -1;
        running = true;
        buildGrid();
        paintStatus();
        matchBtn.disabled = false;
        instructions.textContent =
          "Block " + (blockIndex + 1) + " of " + BLOCKS_PER_SESSION + ": press Match when the square " +
          "is in the same place it was " + level + " step" + (level === 1 ? "" : "s") + " ago.";
        blockStartedAt = performance.now();
        timer = setTimeout(nextTrial, 900);
      }

      /* Scheduled against the block's own start time rather than by adding up
         timeouts, so a slow frame cannot make trial 20 arrive a second late. */
      function scheduleNext() {
        const due = blockStartedAt + (trial + 1) * TRIAL_MS;
        const delay = Math.max(0, due - performance.now());
        timer = setTimeout(nextTrial, delay);
      }

      function nextTrial() {
        if (!running) return;
        if (trial >= 0) cells[sequence[trial]].classList.remove("is-lit");
        trial += 1;
        if (trial >= sequence.length) return endBlock();
        const cell = cells[sequence[trial]];
        cell.classList.add("is-lit");
        stimTimer = setTimeout(function () { cell.classList.remove("is-lit"); }, STIM_MS);
        matchBtn.classList.remove("is-armed");
        scheduleNext();
      }

      function respond() {
        if (!running || trial < 0 || trial >= sequence.length) return;
        if (responses[trial]) return; // one answer per trial; extra presses are not extra credit
        responses[trial] = true;
        matchBtn.classList.add("is-armed");
      }

      function endBlock() {
        running = false;
        clearTimers();
        const score = nbackScore(sequence, level, responses);
        blockScores.push({ score: score, level: level });

        const rec = dayRecord();
        writeJson(DAY_KEY, { date: rec.date, blocks: rec.blocks + 1 });

        // The ladder is pure: the browser holds no rule of its own.
        const next = nbackNextLevel(level, cleanStreak, score);
        const moved = next.moved;
        level = next.level;
        cleanStreak = next.cleanStreak;
        try { localStorage.setItem(LEVEL_KEY, String(level)); } catch (e) {}
        const best = Math.max(getBest(BEST_KEY), level);
        setBest(BEST_KEY, best);

        blockIndex += 1;
        if (blockIndex < BLOCKS_PER_SESSION) {
          instructions.textContent = moved === "up"
            ? "Three clean blocks — moving up to " + level + "-back."
            : moved === "down"
              ? "Two targets missed — dropping to " + level + "-back."
              : "Block done: " + score.hits + " of " + score.targets + " targets caught, " +
                score.falseAlarms + " false alarm" + (score.falseAlarms === 1 ? "" : "s") + ".";
          timer = setTimeout(startBlock, 1600);
          return;
        }
        finishSession();
      }

      function finishSession() {
        matchBtn.hidden = true;
        const totals = blockScores.reduce(function (acc, b) {
          acc.hits += b.score.hits;
          acc.misses += b.score.misses;
          acc.falseAlarms += b.score.falseAlarms;
          acc.correctRejections += b.score.correctRejections;
          return acc;
        }, { hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0 });

        const withD = blockScores.filter(function (b) { return typeof b.score.dPrime === "number"; });
        const meanD = withD.length
          ? withD.reduce(function (t, b) { return t + b.score.dPrime; }, 0) / withD.length
          : 0;
        const sessionD = Math.round(meanD * 100) / 100;
        const scored = totals.hits + totals.misses + totals.falseAlarms + totals.correctRejections;
        const accuracy = scored ? (totals.hits + totals.correctRejections) / scored : 0;

        const priorDist = getDistribution(DIST_KEY);
        const priorBestD = priorDist.length ? Math.max.apply(null, priorDist) : null;
        const dist = pushDistribution(priorDist, sessionD);
        setDistribution(DIST_KEY, dist);
        const history = pushHistory(getHistory(HISTORY_KEY), {
          score: sessionD.toFixed(2),
          date: new Date().toISOString(),
        });
        setHistory(HISTORY_KEY, history);

        const streak = nbackUpdateStreak(readJson(STREAK_KEY, { count: 0, last: null }), nbackDayKey());
        writeJson(STREAK_KEY, streak);

        dEl.textContent = sessionD.toFixed(2);
        badgeEl.textContent = level + "-back";
        tierEl.textContent = nbackRatingTier(level);
        hitsEl.textContent = totals.hits + " of " + (totals.hits + totals.misses);
        missesEl.textContent = String(totals.misses);
        faEl.textContent = String(totals.falseAlarms);
        accEl.textContent = Math.round(accuracy * 100) + "%";
        ladderEl.textContent = "You finished at " + level + "-back. Three clean blocks in a row move " +
          "you up a rung; two missed targets in one block move you down.";
        streakLineEl.textContent = streak.count === 1
          ? "Day 1 of your streak. Come back tomorrow to make it two."
          : "Daily streak: " + streak.count + " days.";

        renderTrend(trendEl, {
          score: sessionD.toFixed(2),
          isNewBest: priorBestD !== null && sessionD > priorBestD,
          priorDist: priorDist,
          dist: dist,
          unitLabel: "d′",
        });
        renderHistoryList(historyList, history, "d′");
        paintStatus();

        gamePanel.hidden = true;
        resultsPanel.hidden = false;
      }

      matchBtn.addEventListener("click", respond);
      /* Space and A are the two keys every n-back trainer binds; the button is
         still the primary control, and it is a real <button> so nothing here is
         the only way in. */
      document.addEventListener("keydown", function (e) {
        if (!running) return;
        if (e.key === " " || e.key === "Spacebar" || e.key.toLowerCase() === "a") {
          e.preventDefault();
          respond();
        }
      });
      startBtn.addEventListener("click", startSession);
      restartBtn.addEventListener("click", startSession);
      /* A tab switch pauses nothing in a browser's timers reliably, and a block
         that ran while the page was hidden is not a measurement. Abandon it. */
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden || !running) return;
        running = false;
        clearTimers();
        matchBtn.hidden = true;
        startBtn.hidden = false;
        startBtn.textContent = "Start again";
        instructions.textContent =
          "Block abandoned — this tab lost focus, and a block that ran in the background is not a " +
          "measurement. Start again when you are ready.";
      });

      buildGrid();
      paintStatus();
      if (dayNoteEl) {
        const rec = dayRecord();
        dayNoteEl.textContent = rec.blocks
          ? "You have already run " + rec.blocks + " block" + (rec.blocks === 1 ? "" : "s") +
            " today; the next one carries on where they left off."
          : "Today's blocks are dealt from today's date and your current rung, so reloading will " +
            "not deal you an easier board.";
      }
      renderHistoryList(historyList, getHistory(HISTORY_KEY), "d′");
    })();
  })();
}

/* Export pure functions for Node-based sanity checks (see README). Never
   reached in the browser, since `module` is undefined there. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createRng: createRng,
    shuffle: shuffle,
    pushHistory: pushHistory,
    pushDistribution: pushDistribution,
    percentileRank: percentileRank,
    sparklinePoints: sparklinePoints,
    lookupTier: lookupTier,
    chimpGridSize: chimpGridSize,
    chimpGenerateLayout: chimpGenerateLayout,
    chimpCheckClick: chimpCheckClick,
    chimpRatingTier: chimpRatingTier,
    sequenceAppend: sequenceAppend,
    sequenceCheckStep: sequenceCheckStep,
    sequenceRatingTier: sequenceRatingTier,
    numberGenerate: numberGenerate,
    numberCheckAnswer: numberCheckAnswer,
    numberRatingTier: numberRatingTier,
    visualGridSize: visualGridSize,
    visualTileCount: visualTileCount,
    visualGenerateLayout: visualGenerateLayout,
    visualRatingTier: visualRatingTier,
    verbalPickWord: verbalPickWord,
    verbalCheckAnswer: verbalCheckAnswer,
    verbalRatingTier: verbalRatingTier,
    inverseNormalCdf: inverseNormalCdf,
    nbackGenerateSequence: nbackGenerateSequence,
    nbackIsTarget: nbackIsTarget,
    nbackCheckResponse: nbackCheckResponse,
    nbackScore: nbackScore,
    nbackNextLevel: nbackNextLevel,
    nbackDailySeed: nbackDailySeed,
    nbackDayKey: nbackDayKey,
    nbackDaysBetween: nbackDaysBetween,
    nbackUpdateStreak: nbackUpdateStreak,
    nbackRatingTier: nbackRatingTier,
  };
}
