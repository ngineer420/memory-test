/* percentile.js — a cited, population-model percentile engine.
   DOM-free and dependency-free. Loaded before app.js as a plain <script>;
   also require()-able from Node for unit tests.

   Ported from reaction-time-test/assets/js/percentile.js (reflexzap). The
   engine is byte-for-byte the same. Only the SOURCES and the models below the
   "SITE-SPECIFIC POPULATION MODEL" heading belong to this site.

   ─────────────────────────────────────────────────────────────────────────
   WHAT THIS IS, AND WHAT IT IS NOT
   ─────────────────────────────────────────────────────────────────────────
   The percentiles this file produces come from a MODEL fitted to figures
   published by one large public memory-test dataset — cited in the SOURCES
   block below. No peer-reviewed study publishes a distribution for the chimp
   test as this site scores it. The nearest laboratory measures, digit span
   and Corsi block span, use a different procedure with no study time before
   the first response, so they do not feed these models.

   They are NOT this site's own visitor data. This site has no backend and
   stores nothing off your device; it cannot and does not aggregate results.
   The personal percentile in app.js compares you with your own past attempts
   on this device, and says so. Any copy rendered from this module must name
   its origin — the model's `populationPhrase` carries the wording — and must
   never imply "other visitors here". A test greps every shipped page for the
   phrasings that would break that. If a number cannot be traced to a source
   below, it does not belong here.
*/

(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PercentileEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ===================== generic math ===================== */

  /* Abramowitz & Stegun 7.1.26 rational approximation of the error function
     (|error| < 1.5e-7). Monotone across the range we evaluate it over, which
     is what keeps percentileForScore monotone — see test/percentile.test.js. */
  function erf(x) {
    var sign = x < 0 ? -1 : 1;
    var ax = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * ax);
    var y =
      1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
        0.254829592) *
        t *
        Math.exp(-ax * ax);
    return sign * y;
  }

  function normalCdf(z) {
    return 0.5 * (1 + erf(z / Math.SQRT2));
  }

  /* Inverse standard normal CDF — Acklam's rational approximation
     (|error| < 1.15e-9). Used to turn a percentile back into a score. */
  function normalQuantile(p) {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    var a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
             1.383577518672690e2, -3.066479806614716e1, 2.506628277459239e0];
    var b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
             6.680131188771972e1, -1.328068155288572e1];
    var c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0,
             -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
    var d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0,
             3.754408661907416e0];
    var pLow = 0.02425, pHigh = 1 - pLow, q, r;
    if (p < pLow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
             ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > pHigh) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
              ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  /* A lognormal is the standard shape for reaction-time-like data: bounded
     below by zero, right-skewed, long slow tail. Optional `shift` moves the
     floor; mu/sigma describe log(score - shift).

     The model is pinned to TWO published numbers and has no free parameters.
     Anchor it on whichever central figure the source actually reports:

       median given (preferred — robust to a junk tail):
         M       = median - shift
         u       = exp(sigma^2), solved from  SD^2 = M^2 * u * (u - 1)
                   ->  u = (1 + sqrt(1 + 4*(SD/M)^2)) / 2
         mu      = ln(M)

       mean given:
         m       = mean - shift
         sigma^2 = ln(1 + SD^2 / m^2)
         mu      = ln(m) - sigma^2 / 2                                      */
  function lognormalParams(model) {
    var shift = model.shift || 0;
    var sd = model.sd;
    if (model.median != null) {
      var M = model.median - shift;
      var k = (sd / M) * (sd / M);
      var u = (1 + Math.sqrt(1 + 4 * k)) / 2;
      return { mu: Math.log(M), sigma: Math.sqrt(Math.log(u)), shift: shift };
    }
    var m = model.mean - shift;
    var sigmaSq = Math.log(1 + (sd * sd) / (m * m));
    return { mu: Math.log(m) - sigmaSq / 2, sigma: Math.sqrt(sigmaSq), shift: shift };
  }

  function paramsFor(model) {
    if (!model._params) model._params = lognormalParams(model);
    return model._params;
  }

  /* ===================== generic engine ===================== */

  /* Share (0..1) of the modelled population scoring at or below `score`. */
  function shareAtOrBelow(model, score) {
    var p = paramsFor(model);
    var x = score - p.shift;
    if (!(x > 0)) return 0;
    return normalCdf((Math.log(x) - p.mu) / p.sigma);
  }

  /* Raw score at a given share (0..1) of the population. */
  function scoreAtShare(model, share) {
    var p = paramsFor(model);
    if (share <= 0) return p.shift;
    if (share >= 1) return Infinity;
    return p.shift + Math.exp(p.mu + p.sigma * normalQuantile(share));
  }

  /* Probability density at `score` (unnormalised units are fine — only ever
     used to give the drawn curve its shape). */
  function density(model, score) {
    var p = paramsFor(model);
    var x = score - p.shift;
    if (!(x > 0)) return 0;
    var z = (Math.log(x) - p.mu) / p.sigma;
    return Math.exp(-0.5 * z * z) / (x * p.sigma * Math.sqrt(2 * Math.PI));
  }

  function modeOf(model) {
    var p = paramsFor(model);
    return p.shift + Math.exp(p.mu - p.sigma * p.sigma);
  }

  /* THE headline function: what percentage of the modelled population does
     this score beat? Always finite and within 0-100. Monotone — a better
     score can never come back with a lower percentile. */
  function percentileForScore(score, model) {
    if (!model || !Number.isFinite(score)) return NaN;
    var below = shareAtOrBelow(model, score);
    var beaten = model.lowerIsBetter ? 1 - below : below;
    return Math.min(100, Math.max(0, beaten * 100));
  }

  /* Inverse: the score sitting at "beats P% of the population". */
  function scoreForPercentile(percentile, model) {
    if (!model || !Number.isFinite(percentile)) return NaN;
    var beaten = Math.min(100, Math.max(0, percentile)) / 100;
    return scoreAtShare(model, model.lowerIsBetter ? 1 - beaten : beaten);
  }

  /* Display form. Clamped to 1-99: the tails of a smooth model fitted to
     published summary statistics do not support "beats 100% of people". */
  function formatPercentile(percentile) {
    if (!Number.isFinite(percentile)) return "";
    return String(Math.min(99, Math.max(1, Math.round(percentile))));
  }

  /* Comparison copy. The population wording is owned by the model so it can
     never drift into implying we aggregate visitor results. */
  function comparisonText(score, model) {
    if (!model || !Number.isFinite(score)) return "";
    var pct = formatPercentile(percentileForScore(score, model));
    return model.betterWord + " than " + pct + "% of " + model.populationPhrase + ".";
  }

  /* A quantile table: [{ percentile, score }, ...] for the reference page and
     for the results-screen ladder. `percentile` is again "beats this many".
     Scores are rounded to model.precision decimals — whole milliseconds here,
     but a clicks-per-second model would want 2. */
  function quantileTable(model, percentiles) {
    var factor = Math.pow(10, model.precision || 0);
    return (percentiles || DEFAULT_PERCENTILES).map(function (p) {
      return { percentile: p, score: Math.round(scoreForPercentile(p, model) * factor) / factor };
    });
  }

  var DEFAULT_PERCENTILES = [99, 95, 90, 75, 50, 25, 10, 5];

  /* ===================== generic curve geometry ===================== */

  function resolveGeom(model, geom) {
    var g = geom || {};
    var domain = model.domain || [model.mean - 3 * model.sd, model.mean + 4 * model.sd];
    return {
      width: g.width || 320,
      height: g.height || 130,
      padTop: g.padTop == null ? 12 : g.padTop,
      padBottom: g.padBottom == null ? 26 : g.padBottom,
      padLeft: g.padLeft == null ? 10 : g.padLeft,
      padRight: g.padRight == null ? 10 : g.padRight,
      min: g.min == null ? domain[0] : g.min,
      max: g.max == null ? domain[1] : g.max,
      samples: g.samples || 96,
    };
  }

  function scalesFor(model, geom) {
    var g = resolveGeom(model, geom);
    var plotW = g.width - g.padLeft - g.padRight;
    var plotH = g.height - g.padTop - g.padBottom;
    var span = g.max - g.min || 1;
    var peak = density(model, modeOf(model)) || 1;
    return {
      g: g,
      baseline: g.padTop + plotH,
      xFor: function (score) {
        var t = (score - g.min) / span;
        return g.padLeft + Math.min(1, Math.max(0, t)) * plotW;
      },
      yFor: function (score) {
        var d = density(model, score) / peak;
        return g.padTop + (1 - Math.min(1, Math.max(0, d))) * plotH;
      },
    };
  }

  /* SVG path `d` for the distribution curve.
     opts.close — close the path down to the baseline (a fillable area)
     opts.step  — draw a staircase instead of a smooth polyline
     opts.from / opts.to — draw only that score slice (used to shade the part
     of the population the visitor beat). */
  function distributionPath(model, geom) {
    if (!model) return "";
    var s = scalesFor(model, geom);
    var g = s.g;
    var from = geom && geom.from != null ? Math.max(g.min, geom.from) : g.min;
    var to = geom && geom.to != null ? Math.min(g.max, geom.to) : g.max;
    if (!(to > from)) return "";
    var stepped = !!(geom && geom.step);
    var step = (to - from) / g.samples;
    var parts = [];
    for (var i = 0; i <= g.samples; i++) {
      var score = from + i * step;
      var x = s.xFor(score).toFixed(2);
      var y = s.yFor(score).toFixed(2);
      // A staircase repeats each sample's height across its own bin width, so
      // the curve reads as hard-edged pixel steps rather than a smooth spline.
      if (stepped && i > 0) parts.push("L" + x + " " + parts[parts.length - 1].split(" ")[1]);
      parts.push((i === 0 ? "M" : "L") + x + " " + y);
    }
    var d = parts.join(" ");
    if (geom && geom.close) {
      d += " L" + s.xFor(to).toFixed(2) + " " + s.baseline.toFixed(2);
      d += " L" + s.xFor(from).toFixed(2) + " " + s.baseline.toFixed(2) + " Z";
    }
    return d;
  }

  /* Where the visitor's marker sits on that same curve. */
  function projectScore(model, score, geom) {
    var s = scalesFor(model, geom);
    var clamped = Math.min(s.g.max, Math.max(s.g.min, score));
    return {
      score: clamped,
      x: s.xFor(clamped),
      y: s.yFor(clamped),
      baseline: s.baseline,
      top: s.g.padTop,
      clamped: clamped !== score,
    };
  }

  /* The slice of the drawn domain this score beats — the part of the curve
     worth shading. Which side that is depends only on model.lowerIsBetter,
     so callers stay unit-agnostic. */
  function beatenRange(model, score, geom) {
    var s = scalesFor(model, geom);
    var at = Math.min(s.g.max, Math.max(s.g.min, score));
    return model.lowerIsBetter ? { from: at, to: s.g.max } : { from: s.g.min, to: at };
  }

  /* Evenly spaced axis ticks across the drawn domain. */
  function axisTicks(model, geom, count) {
    var s = scalesFor(model, geom);
    var n = count || 4;
    var out = [];
    for (var i = 0; i <= n; i++) {
      var score = s.g.min + ((s.g.max - s.g.min) * i) / n;
      out.push({ score: Math.round(score), x: s.xFor(score) });
    }
    return out;
  }

  /* ===================== SOURCES ===================== */
  /* Every figure in the models below traces to one of these. Nothing in this
     file comes from visitors to this site. */

  var SOURCES = [
    {
      id: "humanbenchmark",
      citation: "Human Benchmark — per-test score histograms (accessed 2026-08-26).",
      url: "https://humanbenchmark.com/tests/chimp",
      kind: "web dataset",
      used:
        "Saved-score histograms behind the Statistics chart on each test page. The " +
        "numbers ship inside the site's JavaScript bundle (/assets/index-*.js, one " +
        "object keyed by test id) and the chart reads them from there. Bin counts by " +
        "score, N, mean and SD: chimp N = 27,233, mean 10.29, SD 2.58; sequence " +
        "N = 35,868, mean 9.91, SD 4.70; number memory N = 24,084, mean 9.25, SD 2.54; " +
        "verbal memory (10-word bins) N = 26,860, mean 49.1, SD 37.5; visual memory " +
        "N = 29,243, mean 11.50, SD 2.62. Aggregated by that site, not by this one.",
    },
  ];

  /* ===================== SITE-SPECIFIC POPULATION MODEL ===================== */

  /* HOW THESE MODELS WERE BUILT — the whole derivation, so every number is
     checkable.

     Each model is a lognormal pinned to TWO numbers read from the cited
     histogram and has no free parameters:

       MEDIAN — the score at which the mid-rank share (scores below, plus half
                the scores equal) crosses 50%, interpolated between bins. The
                mid-rank rule is the same one percentileRank() in app.js uses
                for the personal percentile, so the two lines agree on what
                "better than" means for a tied score.
       SD     — the standard deviation of the histogram, bins at their score
                (or at the bin midpoint for the 10-word verbal bins).

     A median anchor is used rather than the mean because every one of these
     histograms has a long right tail of rare high scores that drags a mean
     up. The `empirical` block on each model carries the histogram's own
     mid-rank quantiles, and the test suite checks that the fitted curve lands
     within `tolerance` of them.

     SCORE CONVENTION. The source reports the level a player was ON when the
     game ended. This site's chimp, sequence and number tests report the last
     level fully CLEARED, and start at 4 tiles, 3 tiles and 3 digits. app.js
     converts before it asks for a percentile:

       reached = max(startLevel, cleared + 1)

     The visual test already reports the level reached, and the verbal test
     counts words on both sites, so neither converts.

     LIMITATIONS, stated rather than hidden:

     - The source is a website's own aggregate of saved scores, not a
       peer-reviewed study, and the snapshot is undated.
     - The source's chimp test allows three mistakes per game. This site's
       ends on the first. A percentile here is therefore conservative: the
       same memory scores lower on this site than it would there.
     - The source's sequence and number tests start at one item, this site's
       at three. A player who fails the first board here maps to level 3
       there, which is the honest floor, not a bonus.
     - The verbal histogram uses 10-word bins, and a lognormal cannot follow
       its heavy first bin: 12% of players score under 10 words. Below the
       25th percentile the verbal model reads a few points high.
     - The n-back test has no model. No published distribution of n-back
       level exists that this file could cite. */

  function memoryModel(opts) {
    return {
      id: opts.id,
      label: opts.label,
      unit: opts.unit,
      precision: 1, // scores are whole levels, but a quantile table needs tenths to stay strictly ordered

      lowerIsBetter: false,
      betterWord: "Better",
      populationPhrase: "people in published " + opts.testName + " data (Human Benchmark)",
      source: "humanbenchmark",

      median: opts.median,
      sd: opts.sd,
      shift: 0,
      domain: opts.domain,

      /* Read from the cited histogram, for the results screen and the tests. */
      n: opts.n,
      startLevel: opts.startLevel,
      empirical: opts.empirical,
      tolerance: opts.tolerance,
      quantiles: [],
    };
  }

  var CHIMP_TILES = memoryModel({
    id: "chimp-tiles", label: "Chimp test, tiles on the board when the game ended",
    unit: "tiles", testName: "chimp test", n: 27233, startLevel: 4,
    median: 10.1, sd: 2.58, domain: [4, 24],
    empirical: { p10: 7.58, p25: 8.79, p75: 11.47, p90: 13.07 }, tolerance: 1.0,
  });

  var SEQUENCE_LENGTH = memoryModel({
    id: "sequence-length", label: "Sequence memory, sequence length when the game ended",
    unit: "tiles", testName: "sequence memory", n: 35868, startLevel: 3,
    median: 9.5, sd: 4.7, domain: [1, 30],
    empirical: { p10: 4.56, p25: 7.22, p75: 12.2, p90: 15.27 }, tolerance: 1.5,
  });

  var NUMBER_DIGITS = memoryModel({
    id: "number-digits", label: "Number memory, digits on screen when the game ended",
    unit: "digits", testName: "number memory", n: 24084, startLevel: 3,
    median: 9.1, sd: 2.54, domain: [3, 20],
    empirical: { p10: 6.64, p25: 7.88, p75: 10.52, p90: 11.93 }, tolerance: 1.0,
  });

  var VISUAL_LEVEL = memoryModel({
    id: "visual-level", label: "Visual memory, level reached",
    unit: "levels", testName: "visual memory", n: 29243, startLevel: 1,
    median: 11.1, sd: 2.62, domain: [4, 24],
    empirical: { p10: 8.63, p25: 9.63, p75: 13.18, p90: 14.7 }, tolerance: 1.0,
  });

  var VERBAL_WORDS = memoryModel({
    id: "verbal-words", label: "Verbal memory, words survived",
    unit: "words", testName: "verbal memory", n: 26860, startLevel: 0,
    median: 41.9, sd: 37.5, domain: [0, 200],
    /* p10 is omitted on purpose: see the verbal limitation above. */
    empirical: { p25: 22.35, p75: 66.7, p90: 97.53 }, tolerance: 6,
  });

  var MODEL_BY_GAME = {
    chimp: CHIMP_TILES,
    sequence: SEQUENCE_LENGTH,
    number: NUMBER_DIGITS,
    visual: VISUAL_LEVEL,
    verbal: VERBAL_WORDS,
  };

  function modelForGame(key) {
    return Object.prototype.hasOwnProperty.call(MODEL_BY_GAME, key) ? MODEL_BY_GAME[key] : null;
  }

  var MODELS = [CHIMP_TILES, SEQUENCE_LENGTH, NUMBER_DIGITS, VISUAL_LEVEL, VERBAL_WORDS];

  MODELS.forEach(function (model) {
    model.quantiles = [99, 95, 90, 75, 50, 25, 10, 5, 1].map(function (p) {
      return { percentile: p, score: Math.round(scoreForPercentile(p, model) * 10) / 10 };
    });
  });

  return {
    // engine
    percentileForScore: percentileForScore,
    scoreForPercentile: scoreForPercentile,
    formatPercentile: formatPercentile,
    comparisonText: comparisonText,
    quantileTable: quantileTable,
    shareAtOrBelow: shareAtOrBelow,
    density: density,
    distributionPath: distributionPath,
    projectScore: projectScore,
    beatenRange: beatenRange,
    axisTicks: axisTicks,
    DEFAULT_PERCENTILES: DEFAULT_PERCENTILES,
    // math (exported for tests)
    erf: erf,
    normalCdf: normalCdf,
    normalQuantile: normalQuantile,
    lognormalParams: lognormalParams,
    // site data
    SOURCES: SOURCES,
    MODELS: MODELS,
    MODEL_BY_GAME: MODEL_BY_GAME,
    modelForGame: modelForGame,
    CHIMP_TILES: CHIMP_TILES,
    SEQUENCE_LENGTH: SEQUENCE_LENGTH,
    NUMBER_DIGITS: NUMBER_DIGITS,
    VISUAL_LEVEL: VISUAL_LEVEL,
    VERBAL_WORDS: VERBAL_WORDS,
  };
});
