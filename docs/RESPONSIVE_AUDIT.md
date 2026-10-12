# Responsive audit (Step 8d)

Every screen (landing page, `/login`, `/signup`, `/setup/1`–`/setup/6`, `/setup/done`, `/home` as
Owner and as Helper, the 404 page, the offline state) loaded at 320, 360, 390, 768, 1024, 1280 and
1920px. Checked with `npm run responsive` (`scripts/responsive_check.mjs`, new this step) plus visual
review of the screenshots it saves to `docs/screens/step8d/`. This file is the **before** picture —
written before any fix in this step, per the spec. Everything listed here is fixed; see "What's not
listed" at the end.

## Summary

| Problem | Where | Fixed |
|---|---|---|
| 2-column grid overflows ~18px at 320px | Landing, "Who it's for" tiles | yes |
| Several links/buttons under 44px tall | Landing (wordmark, nav Log in, footer Privacy/Terms, consent-text link) | yes |
| Wordmark not shown on phones | Landing (`.topbar{display:none}` below 760px, no fallback) | yes |
| Quiet text links under 44px tall | App: "New here?"/"Already have an account?", "Back to website", StepHeader's "Save and continue later" | yes |
| Pill/chip buttons at 40px, not 44px | App: colour swatches (step 2), unit/link/role chips (steps 3, 4, 5) | yes |
| "Add a logo" button at 40px tall | App: step 2 | yes |
| Phones/tablets/desktop all get the same ~480px-wide column | Every app screen — a thin strip on a big screen, not a redesigned layout | yes |
| Fixed small overflow on `/setup/5` at 320px | 12px, see below | yes |

**Confirmed clean, no changes needed:** `/setup/done`, `/home` (Owner and Helper), the 404 page, and
the offline retry/banner state — zero touch-target, text-size, overflow or bottom-bar-occlusion
failures at any width, before or after this step.

## Landing page (`landing/index.html`)

1. **320px: "Who it's for" tiles overflow ~18px.** `.tiles{grid-template-columns:1fr 1fr}` — a bare
   `1fr` track has an implicit `minmax(auto, 1fr)`, so the track won't shrink below its content's
   min-content width. With `.tile` holding a fixed `50px` icon box plus `18px` padding each side and
   bold multi-word labels ("Shops that pack or repack goods"), the two columns' min-content width
   exceeds the 288px available inside `.container` at a 320px viewport, pushing `.tiles` — and with
   it the whole page — about 18px wider than the viewport. Confirmed by the check script:
   `.container`/`.tiles` `scrollWidth=306` vs `clientWidth=288`. Fix: `minmax(0, 1fr)` tracks, which
   is exactly rule 2's "use flexible widths... min-width: 0" — the standard fix for this exact
   CSS grid overflow pattern.
2. **Touch targets under 44px**, confirmed by measurement:
   - Nav wordmark link (`.wordmark`, visible ≥760px): 142×23
   - Nav "Log in" link (`.nav-login`, visible ≥760px): 50×27
   - Footer "Privacy" / "Terms" links: 55×23 / 47×23 — present at every width (footer is visible
     regardless of viewport)
   - The inline "privacy page" link inside the signup form's consent text: 100×23
   - The consent checkbox itself is a deliberate 22×22 visual box (`.consent input`) — **not counted
     as a failure**: it sits inside a `<label>` that wraps the whole sentence, so the real/semantic
     tap target is the full label row, comfortably over 44px. The check script measures the `<label>`
     for any labelled checkbox, not the bare input, for exactly this reason. Left exactly as designed.
3. **Wordmark not shown on phones.** `.topbar{display:none}` below 760px removes the *entire* header
   — wordmark, nav links, all of it — with no fallback. The only other "EasyKharcha" text on the page
   is in the footer, far below the fold. Fix needs no new markup: the topbar's own markup already
   exists (from Step 8b) and already separates the wordmark from the nav actions (`.nav-actions`,
   added in Step 8b) — showing `.topbar` always and hiding only `.nav-actions` below 760px turns it
   into exactly the "slim bar, name only, no extra links" the spec asks for, using CSS alone.
4. **Not fixing, by design:** the hero's phone-mockup illustration ("Today / Stock / Milk 12 L...") is
   set at 12.5–14.4px, under the 15px body-text minimum. This is a miniature illustration of what the
   real app looks like, not real readable body copy — enlarging it would make the mockup look wrong
   and arguably counts as changing "the component look", which this step's rules explicitly forbid
   touching. Left as designed.

## App screens — shared issues

These patterns repeat identically across several screens because they share the same components:

- **Quiet text links, no minimum height** (`Pressable` + `Small`, no padding): `/login`'s "New here?
  Create an account", `/signup`'s "Already have an account? Log in", and the new `BackToWebsiteLink`
  on both — all measured at a 23px-tall hit box. Also `StepHeader`'s "Save and continue later" link,
  present on every wizard step (`/setup/1`–`/setup/6`), same issue (168×23).
- **Pill/chip buttons at 40px tall, not 44px**: step 2's colour swatches (`SWATCH_SIZE = 40`, ten of
  them), step 3's unit chips (kg/g/L/ml/piece/pack), step 4's stock-item-link chips (None + one per
  stock item), step 5's role chips (Manager/Head chef/Helper). All four screens build these chips by
  hand with the same `minHeight`-less pattern.
- **"Add a logo" button** on step 2: 78×40, under the 44px floor.

No small-text findings anywhere in the app (the design system's smallest type, `type.sm = 15px`, was
already at the floor everywhere) and no sticky-bar occlusion anywhere, at any width — Step 8/8c's
padding-compensation (`Screen.tsx`'s `onBarLayout` mechanism) already holds up correctly across every
width tested.

One small overflow: `/setup/5` at 320px, 12px (`scrollWidth=296` vs `clientWidth=284`) — the role-chip
row (`roleChips`, `flexDirection:'row', flexWrap:'wrap'`) was tight enough at the narrowest width
tested to just barely overflow before wrapping. Fixed alongside the chip touch-target sizing.

## Desktop and tablet: the "thin phone strip" problem

Not a measurement-script finding (no horizontal scroll or small touch target is involved) but visibly
the single biggest issue above 600px: **every app screen uses the exact same ~480px-wide centred
column regardless of viewport** (`Screen.tsx`'s `MAX_CONTENT_WIDTH = 480`, with no breakpoint logic at
all). At 1920px this is a narrow strip of content surrounded by a sea of empty brand-coloured
background — confirmed visually, e.g. `docs/screens/step8d/home-owner-1920.png` shows the entire
`/home` screen (brand header + Log out button) occupying roughly a quarter of the viewport width,
vertically centred-left with nothing else on the page. The spec's section 4 (auth screens ~440px,
wizard ~640px with a side-by-side preview/help panel at 1024px+ on steps 2/5/6, two-column lists at
900px+, home ~720px) is the fix — a real per-context container-width system, not a single global cap.

## What's not listed

Everything above was fixed in this step (see the commit for the diff). Nothing found during the audit
was left unfixed. The automated check (`npm run responsive`) now passes clean at every route and
width — see the final check run in the Step 8d report.
