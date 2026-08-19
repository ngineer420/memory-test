"""chimpmemory.com navigation data — the single source of truth for the toolbar.

This is the ONLY file that differs between sites. `sync_nav.py` is generic and
copies verbatim. Nothing here is computed at runtime by the browser: sync_nav
renders it into the static HTML of every page.

Tier rule (portfolio spec, ngineer420.github.io#13): a page is tier 1 only if it
answers a *different question*. All five tests do — Chimp is visuospatial recall
of vanished numerals, Sequence is pattern order, Number is digit span, Visual is
growing-grid spatial recall and Verbal is word recognition. They are peers, not
one test with a parameter baked in, so there is no tier 2 on this site, no hub
row and no in-panel sibling chips.

hrefs are the clean extensionless paths the site already publishes in its
canonicals, sitemap and in-body lists; `canon()` maps `/chimp-test.html` onto
`/chimp-test` so the file on disk is stamped from the same one list.
"""

# Noun used in the menu trigger: "All 6 tests" (sync_nav derives the count from
# len(TOOLS), so it follows this list).
NOUN = "tests"

# Tier-1 tools. Six of them, so the whole set is still the rail (cap is 8) and
# the sheet still renders flat — group headings do not turn on here, and adding a
# sixth test does not turn them on either: GROUPS below is empty and sync_nav
# iterates D.GROUPS, so there is nothing for it to render.
#   label -> rail chip text, <= 18 chars
#   long  -> anchor text in the sheet
TOOLS = [
    {"href": "/chimp-test",           "label": "Chimp",    "long": "Chimp Test",              "group": "tests", "tier": 1},
    {"href": "/sequence-memory-test", "label": "Sequence", "long": "Sequence Memory Test",    "group": "tests", "tier": 1},
    {"href": "/number-memory-test",   "label": "Number",   "long": "Number Memory Test",      "group": "tests", "tier": 1},
    {"href": "/visual-memory-test",   "label": "Visual",   "long": "Visual Memory Test",      "group": "tests", "tier": 1},
    {"href": "/verbal-memory-test",   "label": "Verbal",   "long": "Verbal Memory Test",      "group": "tests", "tier": 1},
    # Tier 1 on the same rule as the other five: n-back asks a different
    # question. The others measure how much you can hold; this one measures how
    # well you can keep replacing it, which is why it is the only test here you
    # are meant to come back to tomorrow rather than beat once.
    {"href": "/n-back-test",          "label": "N-Back",   "long": "N-Back Test",             "group": "tests", "tier": 1},
]

# Six destinations still renders flat; the key above is never read.
GROUPS = []

# No preset family here: every test answers a different question.
HUBS = []

# The rail carries all six tests visibly on every page, so a footer duplicate
# would be boilerplate rather than a new crawl surface. The footer keeps the
# legal links it already had.
FOOTER = []

# One-time --migrate: what the legacy markup looked like and where the marker
# pair goes. Per-site, because the legacy markup is per-site. Ops run in order.
MIGRATE = [
    # The homepage's role="tablist" strip. It sat inside <main> below a 585px
    # hero, announced navigation as tabs, and its tabindex="-1" removed four of
    # five links from tab order.
    {"op": "strip", "pattern": r'\n  <div role="tablist" class="tabbar".*?\n  </div>\n'},
    # The same five links again on each solo test page, as a second nav layer
    # inside <main>.
    {"op": "strip", "pattern": r'\n  <nav class="tabbar solo-tabbar".*?\n  </nav>\n'},
    # The toolbar is a direct child of <body>, immediately after </header>, so
    # on the homepage it lands above the hero rather than below it.
    {"op": "insert_after", "region": "nav", "pattern": r"</header>", "indent": ""},
]
