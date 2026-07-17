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

    /* ---- tabs ---- */

    (function initTabs() {
      const tablist = document.querySelector('[role="tablist"]');
      if (!tablist) return; // standalone single-test pages have no tab bar
      const tabs = Array.prototype.slice.call(
        tablist.querySelectorAll('[role="tab"]')
      );
      if (!tabs.length) return;

      function panelFor(tab) {
        return document.getElementById(tab.getAttribute("aria-controls"));
      }

      function select(tab, opts) {
        const focus = !opts || opts.focus !== false;
        tabs.forEach(function (t) {
          const active = t === tab;
          t.setAttribute("aria-selected", String(active));
          t.tabIndex = active ? 0 : -1;
          const panel = panelFor(t);
          if (panel) {
            panel.hidden = !active;
            panel.classList.toggle("active", active);
          }
        });
        try {
          sessionStorage.setItem("cmt:tab", tab.id);
        } catch (e) {
          /* ignore */
        }
        if (focus) tab.focus();
      }

      tabs.forEach(function (tab, i) {
        tab.addEventListener("click", function () {
          select(tab);
        });
        tab.addEventListener("keydown", function (e) {
          if (e.key === "ArrowRight") select(tabs[(i + 1) % tabs.length]);
          if (e.key === "ArrowLeft") select(tabs[(i - 1 + tabs.length) % tabs.length]);
          if (e.key === "Home") select(tabs[0]);
          if (e.key === "End") select(tabs[tabs.length - 1]);
        });
      });

      let restored = null;
      try {
        restored = sessionStorage.getItem("cmt:tab");
      } catch (e) {
        /* ignore */
      }
      if (restored) {
        const match = tabs.find(function (t) {
          return t.id === restored;
        });
        if (match && match !== tabs[0]) select(match, { focus: false });
      }
    })();

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
        const best = Math.max(getBest(BEST_KEY), finalCount);
        setBest(BEST_KEY, best);
        const history = pushHistory(getHistory(HISTORY_KEY), {
          score: finalCount,
          date: new Date().toISOString(),
        });
        setHistory(HISTORY_KEY, history);
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
        const best = Math.max(getBest(BEST_KEY), level);
        setBest(BEST_KEY, best);
        const history = pushHistory(getHistory(HISTORY_KEY), {
          score: level,
          date: new Date().toISOString(),
        });
        setHistory(HISTORY_KEY, history);
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
        const best = Math.max(getBest(BEST_KEY), lastCompleted);
        setBest(BEST_KEY, best);
        const history = pushHistory(getHistory(HISTORY_KEY), {
          score: lastCompleted,
          date: new Date().toISOString(),
        });
        setHistory(HISTORY_KEY, history);
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
        const best = Math.max(getBest(BEST_KEY), reached);
        setBest(BEST_KEY, best);
        const history = pushHistory(getHistory(HISTORY_KEY), {
          score: reached,
          date: new Date().toISOString(),
        });
        setHistory(HISTORY_KEY, history);
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
        const best = Math.max(getBest(BEST_KEY), score);
        setBest(BEST_KEY, best);
        const history = pushHistory(getHistory(HISTORY_KEY), {
          score: score,
          date: new Date().toISOString(),
        });
        setHistory(HISTORY_KEY, history);
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
  })();
}

/* Export pure functions for Node-based sanity checks (see README). Never
   reached in the browser, since `module` is undefined there. */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createRng: createRng,
    shuffle: shuffle,
    pushHistory: pushHistory,
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
  };
}
