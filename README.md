# chimpmemory.com

A free, ad-supported memory-game bundle with three modes in one page:

- **Chimp Test** (default tab): a grid of numbered tiles that vanish the instant you click "1" — you finish clicking the rest purely from memory of where they were. Named for the well-known primate-cognition task chimpanzees are famously good at. Each round adds one more tile; one wrong click ends the game.
- **Sequence Memory**: a 3×3 grid lights up tiles one at a time; repeat the sequence back in order. Each success adds one more tile to the sequence.
- **Number Memory**: a number flashes briefly, then disappears; type it back from memory. Each success adds one more digit.

Each mode tracks a best score and a rolling history of your last 10 attempts (both in `localStorage`, on your own device only), and shows an editorial "rating tier" after every round (e.g. "Sharp memory", "Chimp-level or better") — these tiers are informal groupings for flavor, not citations of a published study.

Everything runs client-side — no backend, no build step, no uploads. Deployed as static files on GitHub Pages.

An `articles/` directory holds four original long-form articles (benchmarks, technique guide, the Ayumu/Kyoto University history behind the "chimp test" name, and how the scoring/difficulty logic works) linked from a "Learn more" section on the homepage — an AdSense content-depth pass to support the tool with genuine written content.

## Local development

No build tooling required. Serve the folder with any static file server, e.g.:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Structure

```
index.html              All three games (tabbed UI)
privacy.html            Privacy policy (required for ad networks)
terms.html              Terms of use
404.html                Custom not-found page
assets/css/styles.css   Design system
assets/js/app.js        Pure game logic (top of file, Node-testable) + DOM wiring (bottom)
assets/favicon.svg      Site icon (abstract tile-grid mark)
CNAME                   GitHub Pages custom domain (chimpmemory.com)
robots.txt / sitemap.xml
```

### Core game logic

The scoring, layout, and sequence/number generation logic for all three modes is
implemented as small pure functions at the top of `assets/js/app.js` (`chimpGenerateLayout`,
`chimpCheckClick`, `chimpRatingTier`, `sequenceAppend`, `sequenceCheckStep`,
`sequenceRatingTier`, `numberGenerate`, `numberCheckAnswer`, `numberRatingTier`,
plus the shared `pushHistory`/`lookupTier` helpers). They're guarded by a
`typeof module !== "undefined"` export so they can be `require()`'d and sanity-checked
from plain Node during development — see the git history for the (intentionally not
committed) throwaway test script used to check edge cases like an empty starting
sequence and an immediate wrong click. The DOM-wiring code below them (tabs, board
rendering, event handlers, localStorage reads/writes) only runs in a browser.

## Enabling ads (Google AdSense)

1. Deploy the site and get it live at chimpmemory.com.
2. Apply at https://adsense.google.com with the live URL. Approval requires a working privacy policy (already included) and some real content/traffic — it isn't instant.
3. Once approved, uncomment the AdSense `<script>` tag in `index.html`'s `<head>` and replace `ca-pub-XXXXXXXXXXXXXXXX` with your publisher ID. Auto ads then places ad units automatically — no manual placement needed.

## Custom domain (chimpmemory.com)

**Note: chimpmemory.com has not been registered yet.** The `CNAME` file below is
already in place so GitHub Pages is ready to serve the domain the moment it's
registered and DNS is pointed at GitHub — until then, the site is reachable at
the default `github.io` Pages URL.

Once the domain is registered, you still need to point DNS at GitHub Pages yourself:

- Apex domain (`chimpmemory.com`): four `A` records to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
- `www` subdomain (optional): `CNAME` record to `<username>.github.io`.

Then enable Pages in the repo's Settings → Pages, and enter `chimpmemory.com` as the custom domain (GitHub will offer to enforce HTTPS once DNS propagates).
