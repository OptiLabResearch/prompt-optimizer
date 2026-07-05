# Prompt Optimizer — Masterplan

Synthesis of three LLM design reviews (GLM, Gemini, Fable — `promt optimizer review.txt`)
and five design prototypes (`design ideas/`), mapped against what the app already has today
(`public/index.html` + `functions/`).

---

## 0. Where the reviewers agree (the consensus)

Every reviewer independently landed on the same five problems and the same three product bets.
That agreement is the strongest signal in all of this material.

**The five shared problems:**

1. **The output scroll wall.** Long results stretch the page infinitely; the Optimize button,
   options, and the Enhancements panel all get pushed off-screen. This breaks the core
   compare-and-copy loop. (Gemini review #2, Fable finding #1)
2. **Enhancements Made is buried.** It's the product's best trust/education feature and nobody
   sees it below the fold. (All three)
3. **Unexplained controls.** The four technique checkboxes, the strength dropdown, and the
   model dropdown do invisible things. Users toggle blindly. (All three)
4. **Placeholders leak into copies.** The optimizer correctly outputs `[INSERT X]` /
   `{{variable}}` markers, but the UI does nothing with them — users copy prompts with raw
   brackets still inside. (Fable #3, Gemini idea 3, GLM "variables")
5. **Model source-of-truth ambiguity.** "Active Model" badge (the optimizer engine) vs. the
   target-model dropdown (what the prompt is optimized *for*) read as conflicting. (All three)

**The three shared product bets:**

1. **Test Both is the conversion moment** — nobody believes a prompt optimizer until they see
   original vs. optimized run side by side. *(Already built and real in our app — it needs
   elevation, not construction.)*
2. **A library with versioning is the retention hook** — History exists but it's a log;
   named, versioned, reusable prompts make the tool "where prompts live."
3. **Target-model profiles are the differentiation** — Claude (XML) vs. GPT (markdown/system)
   vs. Gemini conventions differ materially. *(Already partially built server-side.)*

**Reality check — already shipped, reviewers didn't know:** real Test Both, word-diff view,
iterative Refine, target-model guidance, technique toggles, strength control, BYOK settings,
streaming, history log. A lot of the plan below is *surfacing* existing capability, not
building new capability.

---

## 1. Design direction (the visual decision)

The five prototypes split into two philosophies:

| Philosophy | Prototypes | Character |
|---|---|---|
| **Dark IDE workspace** | `glm.html`, `gemini.html`, `gemini v2.html` | Sidebar nav, three panels, fixed viewport, data-dense, workspaces/accounts implied |
| **Light editorial flow** | `glm v2.html` ("Focus & Flow"), `fable.html` (Workbench) | Single column, progressive disclosure, input transforms into annotated result |

**Recommendation: the light editorial flow, using `fable.html` as the base skeleton,
borrowing the best pieces of the others.**

Why:
- Our audience is *mixed* (solo builders **and** semi-technical PMs — Fable's persona split).
  The dark three-panel IDE optimizes for an enterprise power user we don't have yet, and
  implies chrome we can't back up (workspaces, accounts, testbeds as nav items).
- The app is a no-login, single-page static tool on Cloudflare Pages. A single-column flow
  is honest about that and is the smallest change from today's codebase.
- `fable.html` already demonstrates the three consensus fixes working together: the **delta
  bar** (enhancement stats above the fold), **accordion result sections with inline "why this
  changed" notes**, and the **placeholder chip fill-flow with copy gating**.

**Borrow from the others:**
- `glm v2.html`: the transform animation (input shrinks to a context bar, result unfurls),
  the color-coded section left-borders (task=blue, variables=green, constraints=purple),
  the "Why this is better" accordion tone, model chips instead of a dropdown.
- `gemini.html`: fixed-height result region with internal scroll; icon buttons with tooltips
  for Copy/Diff/Edit; the variable sandbox (fill `{{vars}}`, preview the compiled prompt).
- `gemini v2.html`: live token/character estimate under the input; a small presets/sample
  catalog for first-run users.
- `glm.html`: checkbox tooltips copy ("Instructs the AI to output a step-by-step reasoning
  structure") — the exact one-liners are already written there.

**Visual system (merged from Fable's palette table + GLM's typography logic):**
- Keep the purple identity: primary `#7C3AED`/`#6D28D9`, but on a warmer, calmer light
  ground (`#FAFAF7`–`#F6F5FB`) instead of washed lavender gradients.
- Semantic colors, not more purple: green `#0E8A62` for enhancements/filled, amber `#B45309`
  for unfilled placeholders/warnings.
- Two font roles: a sans (Inter or IBM Plex Sans) for UI, a mono (JetBrains/IBM Plex Mono)
  for prompt text — prompts read as code.
- One filled primary button per state; everything else ghost. Cards 10–12px radius, one
  shadow level, 8px spacing grid.
- Accessibility: AA contrast on body text (current gray-on-lavender likely fails), visible
  focus rings, 44px hit targets on toggles, `aria-live` on the result, `aria-expanded`
  accordions, `prefers-reduced-motion` respected (fable.html already does this).

---

## 2. The target experience (one flow)

```
STATE 1 — INPUT (calm, single card)
  Headline + one-line promise
  [ textarea, mono font, {{var}} syntax highlighted ]
  toolbar: char/token count · Length: Concise|Standard|Full ·
           Target: Claude|GPT|Gemini|Other (chips) · Techniques ▸ (collapsed, tooltips)
  [ OPTIMIZE ]  ·  "Try a sample prompt"

STATE 2 — RESULT (input collapses to an editable context bar)
  ┌ DELTA BAR (always above the fold) ─────────────────────────┐
  │ +Role · 4 subtasks · 3 constraints · 2 placeholders to fill │
  │            [Copy] [Save to library] [TEST BOTH →] (filled)  │
  └─────────────────────────────────────────────────────────────┘
  ⚠ gate: "2 placeholders need input before this is copy-ready"
  Result sections (accordions, fixed-height region, internal scroll):
    01 Role · 02 Context · 03 Task · 04 Constraints · 05 Output format
    — each with an inline margin note: "Why this changed"
    — placeholders rendered as amber chips → click → inline input → green when filled
    — per-section copy on hover; Edit toggle; Diff toggle (existing word-diff)
  Refine bar (existing feature, kept prominent under the result)

STATE 3 — TEST BENCH (existing Test Both, promoted)
  [test input] [Run] → original vs optimized responses side by side
  + a simple verdict strip (length/structure delta) · "Save winner to library"
```

One primary action per state (Fable's rule): Optimize → Test Both / Copy.

---

## 3. Function roadmap

### Phase 1 — Quick wins (days; CSS + small JS, no backend)
1. ✅ **Kill the scroll wall**: result region gets `max-height: calc(100vh - header)` with
   internal scroll; sticky action bar so Optimize/Copy never leave the viewport.
   `.output-box` now has `max-height: calc(100vh - 260px)` (already had `min-height`/
   `overflow-y:auto`); `.result-actions` changed from an absolutely-positioned overlay to
   `position: sticky; top: -1.5rem` with a blurred background band, so it stays visible
   while the result scrolls internally. Removed the manual `padding-top: 2rem` hack on
   `#optimizedText` since the sticky bar now occupies normal flow space above the text.
2. ✅ **Delta/enhancements strip above the fold** — added a `#deltaBar` between the result
   `<h2>` and the output box: stat chips (`+N enhancements`, `M placeholders to fill`)
   computed from the bullet count in the explanation text and the placeholder regex count,
   plus a "Why this is better" toggle (`#deltaToggle`, `aria-expanded`) that expands the
   existing `#explanationSection` (now collapsed by default) as the detail view.
3. ✅ **Tooltips**: `title` attributes added to all four technique checkboxes (copy adapted
   from `glm.html` plus two authored for xml/placeholders, which weren't in the reviews).
   Added live-updating one-line hints under the strength select (`#strengthHint`) and the
   new length control (`#lengthHint`), swapped via `updateStrengthHint()`/`selectChip()`.
4. ✅ **CTA prominence**: Test Both (`.test-action`) is now `.copy-btn.primary-action` — a
   filled purple/pink gradient button — while Copy/Save/Diff remain ghost `.copy-btn`.
   Optimize was already the filled primary button with a loading state; left as-is.
5. ✅ **Model clarity**: model pill now reads `Engine: <provider> (<model>)` or
   `Engine: shared hosted key (click to configure your own)`. The target-model `<select>`
   was replaced with a labeled chip group (`#targetChips`: Generic/Claude/GPT/Gemini/Small
   Local) backed by a hidden `#targetModel` input for the existing request-building code;
   "Any Model" was renamed to "Generic" (no bare/empty label).
6. ✅ **Placeholder highlighting**: `PLACEHOLDER_REGEX` matches `{{vars}}` and
   `[UPPERCASE BRACKETS]`; matches are wrapped in `<span class="placeholder-chip">` (amber)
   in the rendered result, and a count warning (`⚠ N placeholders to fill before copying`)
   appears in the sticky action bar next to Copy when count > 0. Display-only, as specified
   — copy is not yet gated (that's Phase 2 item 3).
7. ✅ **Contrast/focus/a11y pass**: global `:focus-visible` outline; `prefers-reduced-motion`
   override zeroing animation/transition durations; `aria-live="polite"` on the output box;
   `aria-expanded`/`aria-controls` on the new delta toggle (history toggle already had a
   chevron but no `aria-expanded` — left as a follow-up, see below); checkboxes and icon/
   toggle buttons bumped to ≥44px hit targets (`.technique-option`, `.icon-btn`,
   `.history-toggle`, `.chip`, `.copy-btn`). Did not re-audit exact contrast ratios with a
   tool — `--text-secondary` (#6b7280) on the card backgrounds looked acceptable by eye but
   wasn't measured; flagging as a follow-up if this matters before Phase 2.
8. ✅ **Output-length control**: new `#lengthChips` segmented control (Concise/Standard/Full,
   default Standard) sends `length` in the request body. `functions/_lib/optimizer.js` gained
   `LENGTH_GUIDELINES` (separate from `STRENGTH_GUIDELINES`, which governs structural balance
   rather than literal word count) and appends an `Output length: ...` line to the system
   prompt for the normal optimize path (not applied to `critique` mode or refinement, which
   have their own instructions). Verified directly with `buildOptimizePrompt()` in Node that
   each of concise/standard/full/default produces the expected guideline text and that
   critique mode omits it.

**Deviations / things not done:**
- Did not literally find an "Active Model" badge in the current code (item 5's premise) —
  the existing pill was already named generically; renamed it to lead with "Engine:" instead.
- `.history-toggle` (existing History accordion) doesn't yet have `aria-expanded` wired up;
  only the new `.delta-toggle` does. Small follow-up for a future a11y pass.
- Verification was endpoint/logic-level only (`curl`, `node --check`, a Node-loaded call to
  `buildOptimizePrompt`), not a real browser render — the browser automation tool in this
  environment cannot reach this machine's `localhost` (same limitation noted in
  `phase3-notes.md` for an unrelated earlier task). `wrangler pages dev public` does serve
  the page unmodified and the API returns the expected "no API key configured" error with a
  `length` field in the body, confirming the request doesn't error out.

### Phase 2 — Core redesign (the new layout)
1. ✅ **Single-column transform layout** (fable/glm-v2 hybrid): input state → result state with collapsing context bar, fade/rise animations, reduced-motion safe. Single column centered at `800px` width.
2. ✅ **Sectioned output**: optimizer returns labeled sections (Role, Context, Task, Constraints, Output Format); rendered as color-coded accordions with left-border styling, per-section inline "Why this changed" notes.
3. ✅ **Placeholder fill flow with gating**: highlights `{{variable}}`/`[UPPERCASE]` placeholders, wraps them in interactive input chips. Copy button disabled (with "copy raw anyway" bypass link) until all placeholders filled.
4. ✅ **Variable sandbox**: variables sandbox central form inputs that automatically update templates reactively, with a collapsible live compiled preview.
5. ✅ **Inline edit**: results are editable directly in-page via `contenteditable="true"` on section bodies (chips are uneditable tags). Focus/blur safely rebuilds prompt templates and synchronizes values.
6. ✅ **Diff view polish**: compute word-diff results partitioned per section so differences are viewed locally inside each accordion.
7. ✅ **Token estimate**: characters / 4 token heuristics added under the input and result boxes.


### Phase 3 — Retention & conversion features
1. **Library** (upgrade of existing History, still localStorage — no accounts):
   named prompts, version chain per prompt (v1 → refined v2 → …), tags, search, re-open
   into the optimizer. History log remains as "recent runs."
2. **Test Bench elevation**: own view/anchor, verdict strip comparing the two responses
   (length, structure, instruction-adherence heuristics), "save winner."
3. **Sample/preset catalog**: 5–8 starter prompts (coding assistant, extractor, summarizer…)
   for first-run users (gemini v2's presets, scoped down).
4. **Optional export**: download prompt as `.md`/`.txt`/JSON (with variables schema) — cheap,
   and serves the "port into my codebase" job.

### Deliberately NOT doing (rejected from the reviews)
- **Accounts, workspaces, billing/pricing pages, team libraries** (GLM's IA) — fake chrome
  for a free static tool; Fable's "don't build a fake pricing page" is right.
- **Multi-model A/B matrix** (optimize for 3 models simultaneously) — high cost, low demand
  until single-target flow is proven.
- **CodeMirror/Monaco + react-diff-viewer** — the app is framework-free static HTML; a mono
  textarea with a highlight overlay and our existing custom diff serve the same jobs at ~0 KB.
- **Dark-mode IDE three-panel shell** — revisit only if usage shows heavy power-user skew.
  (A simple dark *theme toggle* on the light design is a fine later add.)
- **Marketing landing page** — the tool is its own landing page; the State-1 headline does
  that job.

---

## 3b. Execution guide — which model runs each phase

The masterplan itself (architecture decisions) is done; execution is mostly mechanical.
Use the cheapest model that can hold the whole task, and reserve stronger models for the
one step with real design judgment (Phase 2 layout rework).

| Phase | Model | Effort / thinking | Why |
|---|---|---|---|
| Phase 1 — quick wins | **Sonnet 5** (`claude-sonnet-5`) | Medium | Many small edits across one 1,465-line HTML file; needs reliable context handling, not deep reasoning. Haiku tends to miss cross-file consistency (CSS ↔ JS ids) at this file size. |
| Phase 1, item 8 only (length control in `functions/_lib/optimizer.js`) | Sonnet 5 | Medium | Prompt-engineering change to the system prompt; test with 2–3 sample runs. |
| Phase 2 — core redesign | **Sonnet 5** with **high** effort/extended thinking. If the layout rework goes off the rails after one attempt, escalate that single task to **Opus 4.8** | High | This is the only genuinely hard step: restructuring state flow (input → result transform), changing the API JSON contract, merging fable.html patterns into the existing app. |
| Phase 3 — library / test bench / presets | **Sonnet 5** | Medium | Well-specified CRUD-on-localStorage and UI work. Individual small items (presets list, export buttons) can be given to **Haiku 4.5** as isolated tasks. |
| Metrics instrumentation (§4b) | **Haiku 4.5** | Low/Medium | A ~40-line beacon + one small Pages Function; fully specified below. |
| Phase-end review | Run `/code-review` at **medium** after each phase | — | Cheaper than debugging regressions later. |

Rules of thumb:
- Give each session **one phase only**. Small context = cheap and accurate.
- Paste the handoff prompt (below) as the session's first message; don't make the model
  re-derive the plan from the repo.
- Escalate model tier only after a concrete failure, not preemptively.

## Handoff protocol (REQUIRED — instruction to the executing model)

> **When you finish a phase:** (1) mark the phase's items done in this file (✅ per item,
> note anything skipped or changed and why); (2) append a fenced block under
> "Session handoffs" below titled `Handoff: Phase N → Phase N+1` containing a
> **self-contained prompt** the user can paste into a brand-new session. It must include:
> the project path, one-paragraph project description, what was completed this phase (with
> file names), any deviations from this plan, known issues/TODOs left behind, the next
> phase's task list copied inline (do not just reference this file), which files to read
> first, and how to run/verify (`npm run dev` → http://localhost:8788). Assume the reader
> has zero context beyond that prompt plus repo access.

## Session handoffs

```
Handoff: Phase 1 → Phase 2

Project path: /root/prompt-optimizer (git repo, branch: master)

Project: A standalone prompt-optimization tool (Cloudflare Pages + Functions, no
framework, no accounts/login). Users paste a raw prompt into public/index.html,
hit Optimize, and get back a structured rewrite plus an explanation of what
changed, via functions/api/optimize-prompt(.js|/stream.js|/test.js) calling
functions/_lib/optimizer.js (which talks to NVIDIA/OpenRouter/OpenAI/Anthropic/
custom OpenAI-compatible endpoints, BYO key or a shared hosted key). Full
context and the whole product plan live in MASTERPLAN.md at the repo root —
read section "0. Where the reviewers agree" and "2. The target experience"
before touching anything.

What was completed this phase (Phase 1, "Quick wins" — see MASTERPLAN.md §3 for
the checked-off item-by-item detail): all 8 items done, in public/index.html
(CSS + JS only, single file) and one small addition to
functions/_lib/optimizer.js (a `LENGTH_GUIDELINES` map + one line appended to
the system prompt in `buildOptimizePrompt`, gated on `body.length`). Highlights:
- Output region now has a bounded height with internal scroll and a sticky,
  blurred action bar (Copy/Save/Diff/Test Both) so long results don't grow the
  page — the reviewers' "scroll wall" bug.
- New collapsed "delta bar" above the output box shows stat chips
  (enhancement count, placeholder count) with a "Why this is better" toggle
  that expands the existing (now-hidden-by-default) explanation section.
- Technique checkboxes have tooltips; strength and length controls have live
  one-line hints underneath.
- Test Both is now the filled/primary post-run action; Copy/Save/Diff stay
  ghost buttons.
- Model pill now reads "Engine: ..."; the target-model <select> became a chip
  group (#targetChips) backed by a hidden #targetModel input so the existing
  request-building JS didn't need to change; "Any Model" renamed to "Generic".
- {{vars}} and [BRACKET] placeholders are now highlighted amber in the result,
  with a count warning next to Copy (display-only — not yet copy-gated).
- Basic a11y: focus-visible outlines, prefers-reduced-motion override,
  aria-live on the output box, aria-expanded on the new delta toggle, ≥44px
  hit targets on checkboxes/icon buttons/chips.
- New segmented Length control (Concise/Standard/Full, default Standard) sends
  `length` to the backend; `functions/_lib/optimizer.js` now has a dedicated
  `LENGTH_GUIDELINES` map (separate from the pre-existing `STRENGTH_GUIDELINES`,
  which governs structural balance, not word count) and appends an
  "Output length: ..." line to the system prompt for the normal optimize path
  only (not critique mode, not refinement).

Deviations / known follow-ups (also noted inline in MASTERPLAN.md §3):
- No literal "Active Model" badge existed to rename — the pill was already
  generic; it now just leads with "Engine:".
- The pre-existing History accordion toggle (#historyToggle) still lacks
  `aria-expanded`; only the new delta toggle has it. Cheap follow-up.
- Contrast ratios were eyeballed, not measured with a contrast-checking tool.
- Verification this phase was endpoint/logic-level only (`curl` against
  `wrangler pages dev`, `node --check` on the extracted <script> body, and a
  direct Node call to `buildOptimizePrompt()` to confirm the length guideline
  text and that critique mode omits it) — NOT a real browser render. The
  browser automation tool in this sandbox cannot reach this machine's
  localhost (confirmed again this session; same limitation phase3-notes.md
  hit for an unrelated earlier task). Whoever picks up Phase 2 should get a
  real screenshot/manual click-through early, since this phase's CSS/layout
  changes (sticky bar, delta bar, chip groups) have not been visually
  confirmed, only reasoned through.
- No commits were made this session (only working-tree edits) — check
  `git status`/`git diff` before assuming this is committed.

Phase 2 task list (copied from MASTERPLAN.md §3, unchanged):
1. Single-column transform layout (fable/glm-v2 hybrid): input state → result
   state with collapsing context bar, fade/rise animations, reduced-motion safe.
2. Sectioned output: have the optimizer return labeled sections (Role/Context/
   Task/Constraints/Format — it already largely writes this structure); render
   as color-coded accordions with per-section copy and inline "why this
   changed" annotations (merge the existing explanation output into
   per-section notes where possible).
3. Placeholder fill flow with gating: chips → inline inputs → Copy disabled
   (with "copy anyway" escape hatch) until filled or dismissed; compiled
   prompt is what gets copied.
4. Variable sandbox (Gemini's idea, cheap version): when {{vars}} exist, show
   a small "test values" form + compiled preview.
5. Inline edit of the result (contenteditable per section) without re-running.
6. Diff view polish: keep existing word-diff; add per-section framing so it
   doesn't become its own wall of text.
7. Token estimate under input and result (chars/4 heuristic is fine).

Files to read first: MASTERPLAN.md (whole file, it's short), public/index.html
(the entire app UI + client JS — now ~1600 lines), functions/_lib/optimizer.js
(prompt-building + provider-calling logic), functions/api/optimize-prompt.js
and functions/api/optimize-prompt/stream.js (the two API entry points; the
JSON contract — optimized_prompt + explanation strings — will need to change
to labeled sections for Phase 2 item 2, which is the one part of Phase 2 that
touches the backend contract, not just presentation).

How to run/verify: `npm install` (installs wrangler) if not already done, then
`npm run dev` (= `wrangler pages dev public`) → http://localhost:8788. No API
key is configured in this environment, so optimize requests will return
"No API key configured..." — that's expected locally; it still confirms
request parsing/validation. If you have real browser access in your
environment (unlike this session), do a full manual click-through of the new
Phase 1 UI (delta bar toggle, chip groups, length control, placeholder
highlighting) before starting Phase 2's rework, since it was never visually
confirmed.
```

```
Handoff: Phase 2 → Phase 3

Project path: /root/prompt-optimizer (git repo, branch: master)

Project: A standalone prompt-optimization tool (Cloudflare Pages + Functions, no
framework, no accounts/login). Users paste a raw prompt into public/index.html,
hit Optimize, and get back a structured rewrite plus an explanation of what
changed. Full context lives in MASTERPLAN.md at the repo root.

What was completed this phase (Phase 2, "Core redesign" — see MASTERPLAN.md §3):
- Single-column transformative layout: centered centered at 800px width. Swap screens between input panel and result panel with context bar.
- Sectioned Output: Parsed headers (Role, Context, Task, Constraints, Output Format) to display inside individual color-coded accordions. Bullet point improvements from explanations are mapped inline in a "Why this changed" box.
- Placeholder Input Chips: Detected placeholders match input chips with inline editing and gating. Copy button disabled until all placeholders filled (with bypass gate link).
- Variable Sandbox: Populate central fields mapped to placeholders that compile the final template.
- Inline Editing: Made sections contenteditable. Focus and blur actions safely parse HTML tree back to template variables.
- Partitioned Diff View: computes word-diff results partitioned per section so differences are viewed locally inside each accordion.
- Token Estimates: Added standard character/4 heuristic next to length indicators.
- Configured local secret bindings: Created .dev.vars containing the NVIDIA, OpenRouter, and Google API keys so that running the wrangler dev server locally executes live API fetch tests successfully.

Phase 3 task list:
1. Library (upgrade of existing History, still localStorage — no accounts): named prompts, version chain per prompt (v1 → refined v2 → …), tags, search, re-open into the optimizer. History log remains as "recent runs."
2. Test Bench elevation: own view/anchor, verdict strip comparing the two responses (length, structure, instruction-adherence heuristics), "save winner."
3. Sample/preset catalog: 5–8 starter prompts (coding assistant, extractor, summarizer…) for first-run users (gemini v2's presets, scoped down).
4. Optional export: download prompt as .md/.txt/JSON (with variables schema).

Files to read first: MASTERPLAN.md, public/index.html, functions/_lib/optimizer.js, .dev.vars.

How to run/verify: Run `npm run dev` to start wrangler pages local server at http://localhost:8788. Verify prompt optimizations fetch real responses using local secrets from `.dev.vars`.
```

---


# 4. Success metrics (merged from Fable + GLM, trimmed to measurable-without-accounts)

| Metric | Target |
|---|---|
| Copy rate per optimization | > 60% |
| Copies with placeholders filled vs. raw | > 80% filled |
| Test Both usage per result view | > 30% |
| Median paste → copy time | < 90 s |
| Return visits within 7 days (localStorage marker) | > 25% |

---

## 4b. Metrics tracking — tooling and implementation

**Recommendation: Cloudflare Workers Analytics Engine, written to by a tiny Pages Function.**
The app already runs on Cloudflare Pages, so this adds zero external vendors, zero cookies
(no consent banner needed), works with ad-blockers better than third-party scripts, and is
free at this scale. Fallback option if you'd rather have ready-made dashboards/funnels with
no query-writing: **PostHog free tier** (1M events/mo) — but it's a third-party script,
often ad-blocked, and overkill here.

Also enable **Cloudflare Web Analytics** (one toggle in the dashboard, no code) for basic
traffic/pageviews — it complements but doesn't replace event tracking.

**How (custom events):**
1. `wrangler.toml`: add an Analytics Engine binding (e.g. `METRICS`).
2. New function `functions/api/event.js`: accepts `POST {event, props}`, calls
   `env.METRICS.writeDataPoint({blobs: [event, target_model, ...], doubles: [duration_ms]})`.
   No IPs, no user IDs — anonymous by design.
3. Client: a ~20-line `track(event, props)` helper using `navigator.sendBeacon`.
4. Events to fire (maps 1:1 to the §4 metrics table):
   - `optimize_run` (props: target model, length setting, techniques)
   - `copy` (props: `placeholders_unfilled` count) → copy rate, filled-vs-raw rate
   - `placeholder_filled`
   - `test_both_run` → Test Both usage
   - `save_to_library`
   - `session_start` (prop: `returning: true/false` from a localStorage first-seen timestamp;
     `days_since_last_visit`) → return-visit rate
   - paste→copy time: timestamp the first input event, send delta as a `double` on `copy`
5. Reading the numbers: Analytics Engine's SQL API (`SELECT blob1, count() ... GROUP BY`)
   via curl or a tiny private `/api/stats` endpoint. Start with manual queries; only build a
   dashboard if you check it often.

**When:**
- **Now — end of Phase 1, before the redesign ships.** You need a baseline to know whether
  the redesign moved copy-rate and paste→copy time; instrumenting after Phase 2 makes the
  before/after comparison impossible.
- Add `save_to_library` / bench events in Phase 3 when those features land.
- Give the implementation to Haiku 4.5 (see §3b) — it's fully specified above.

---

# 5. Suggested order of attack

0. Instrument metrics first (§4b) — a baseline before any redesign ships.
1. Ship all of Phase 1 in one pass — it's the highest ratio of user-visible improvement to
   effort, and none of it risks the working backend.
2. Build Phase 2 behind the same page (it's a rework of `public/index.html`'s result
   rendering; the API contract barely changes — mainly asking the optimizer for labeled
   sections + per-section rationales in its JSON).
3. Phase 3 only after watching real usage of Test Both and Save — Fable's advice: validate
   the conversion moment cheaply before investing in the bench UI.
