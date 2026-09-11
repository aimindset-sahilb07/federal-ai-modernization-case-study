# Federal Benefits Modernization — AI-Accelerated Migration

A five-chapter case study on AI-accelerated legacy modernization in a regulated
federal environment: Java and DB2 to Postgres, and what integration testing
revealed about the distance between *generated* and *behaviorally equivalent*.

**Live:** https://aimindset-sahilb07.github.io/federal-ai-modernization-case-study/

```
index.html       the case study
tokens.css       the design system: closed set of allowed values
primitives.css   the design system: 9 layout primitives + contracts
check.mjs        the pre-publish gate
```

No build step, no runtime dependencies. Open `index.html` and it works.

---

## The design system

The page is not hand-styled. It is built on a small system, because the first
version of this page was hand-styled and it produced a long tail of defects:
nine near-identical greys, a dozen arbitrary spacing values, a 62px icon inside
a 58px grid track, a `height:100%` that spilled a card into the next section.
None of those were taste problems. Nothing in the file prevented drift.

**Three rules.**

1. **If it is not a token, it does not exist.** No raw colour and no off-scale
   size outside `tokens.css`. When a design needs a value the tokens lack, the
   token set is wrong; fix the token rather than hardcoding. The gate fails the
   build on violations, including `rgba()`.
2. **Compose primitives, do not write layout.** `stack`, `cluster`, `sidebar`,
   `switcher`, `grid`, `cover`, `center`, `frame`, `box`, after
   [Every Layout](https://every-layout.dev). They are intrinsically responsive
   and have no magic numbers to get wrong. `stack` + `[data-grow]` replaces
   `height:100%`; `with-icon` has no fixed track, so an icon and its gutter
   cannot disagree.
3. **Run the gate before publishing.**

```bash
npm i -D playwright axe-core && npx playwright install chromium
node check.mjs index.html
```

Exits non-zero on failure, so it drops into CI unchanged.

## What the gate checks

At 1440 / 1100 / 820 / 400px:

| Check | Catches |
|---|---|
| Design lint | Raw colours, off-scale sizes |
| Horizontal scroll | Names the element that is too wide |
| Parent spill | The `height:100%` class of bug |
| Contrast | Text below WCAG AA, names the selector |
| Occlusion | Fixed nav covering an anchor target |
| Invisible icons | An `svg` rendering smaller than 2×2 |
| Opacity | Content stuck invisible if reveal JS fails |
| axe | WCAG 2 A and AA |
| JS errors | Console and page errors |
| Screenshots | Written to `.shots/` for review |

Scales are fluid and generated for a 380 to 1360px range rather than picked per
element, so sizes relate to each other. `--ink-5` is documented as large-text
only at 3.4:1, and the gate rejects it in body copy.

## What the gate cannot do

It checks correctness, not taste. Every check passed while the hero was
breaking "moderniz / ation" across two lines, because a `sidebar` was inverted
and the copy was being squeezed into the narrow column. Look at `.shots/`
before publishing.

It also only knows what it has been taught. The missing `.bullet-icon`
definition rendered ten icons as nothing: no overflow, no contrast failure, no
console error, and the gate passed. The invisible-icon check exists because of
that escape. When something slips through, add a check for it. That is how the
long tail actually shrinks.

## Structure

The five-chapter spine is deliberate:

1. **Scale** the setup, and the numbers that make it real
2. **Challenge** why it was hard, not just what it was
3. **Approach** what was done, and my role in it
4. **Pivot** the honest turn, what was wrong at first
5. **Governance** what held

Chapter 4 is what makes a case study credible.
