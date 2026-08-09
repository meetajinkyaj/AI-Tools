# Design tokens and shared component classes

Everything here lives in **`src/app/globals.css`**. There is no
`tailwind.config.js`: this is Tailwind v4, which is CSS-first, so the theme is
declared in `@theme inline` inside that file and nowhere else.

Source: the Ikigaro mobile design handoff (`README.md` in the design bundle).
Where the handoff and the mockups disagreed, the handoff's values won.

**Rule: no literal hex or unmeasured px in a component.** If you find yourself
writing `#b5562d` or `p-[18px]`, the token already exists below.

---

## 1. Two vocabularies, one set of values

The handoff names things `canvas` / `ink` / `line` / `primary`. This app was
built on `background` / `foreground` / `border` / `accent` and uses those names
in about forty components.

Rather than rename forty files, the old names are kept as **aliases pointing at
the new tokens**. Both spellings resolve to the same custom property, so every
existing screen inherited the handoff without a single component edit.

| Deprecated | Use instead |
|---|---|
| `background` | `canvas` |
| `foreground` | `ink` |
| `border` | `line` |
| `border-strong` | `line-strong` |
| `accent` | `primary` |
| `accent-hover` | `primary-deep` |
| `accent-contrast` | `primary-fg` |
| `font-body` | `font-sans` |
| `rounded-control` | `rounded-ctl` |

The aliases are supported, not blessed. New code uses the right-hand column.

---

## 2. Colors

Utilities follow Tailwind's normal namespaces: `bg-canvas`, `text-ink`,
`border-line`, `fill-primary`, and so on.

| Token | Light | Dark | Use |
|---|---|---|---|
| `canvas` | `#f1e9dc` | `#1b1815` | app background |
| `surface` | `#fbf7f0` | `#242019` | cards |
| `surface-2` | `#f4ecdf` | `#2d2822` | inset fills: segmented track, stat wells, avatar chip |
| `ink` | `#1b1815` | `#f1e9dc` | primary text |
| `muted` | `#6e645b` | `#a89c8f` | secondary text |
| `line` | 12% ink | 13% linen | hairline borders and dividers |
| `line-strong` | 24% ink | 26% linen | outline buttons, unselected marks |
| `primary` | `#b5562d` | `#cd7144` | CTAs, active nav, selection, eyebrows |
| `primary-deep` | `#8f3f1d` | `#b5562d` | link hover, pressed |
| `primary-fg` | `#f6efe3` | `#1b1815` | text on primary |
| `primary-wash` | 7% primary | 10% primary | selected-tile fill |
| `clay` | `#cd7144` | `#cd7144` | positive movement: sparklines, up deltas |

**Biomarker flags.** Each has a matching `-wash` for its pill background.

| Token | Meaning |
|---|---|
| `good` / `good-wash` | normal, in range, improved |
| `warn` / `warn-wash` | borderline |
| `bad` / `bad-wash` | out of range (LOW / HIGH) |

These are deliberately not red and green. A value outside a reference range is
information, not an alarm, and this app never diagnoses.

**Fixed brand colors** that must NOT follow the ground, for the charcoal
marketing hero: `obsidian`, `linen`, `terracotta`, `tan`.

`primary` is the only saturated hue in the system. If a new tint is needed,
derive it with `color-mix()` from these rather than introducing one.

---

## 3. Type

Families: `font-display` (Cormorant Garamond 500, never bold), `font-label`
(Marcellus 400, eyebrows only), `font-sans` (Hanken Grotesk 400/500/600/700),
`font-jp` (system CJK stack).

Sizes carry their line height and tracking, so `text-display-xl` is the whole
step and not just a font size.

| Utility | px | Face | Use |
|---|---|---|---|
| `text-display-xl` | 31 | CG 500 | screen title |
| `text-display-lg` | 29 | CG 500 | hero numerals (points balance) |
| `text-display-md` | 26 | CG 500 | stat numerals, rank name |
| `text-display-sm` | 22 | CG 500 | card headlines |
| `text-eyebrow` | 11 | Marcellus | section labels, uppercase, 0.2em |
| `text-eyebrow-sm` | 10.5 | Marcellus | partner names, 0.16em |
| `text-body-lg` | 15 | HG 600 | sheet rows |
| `text-body` | 14.5 | HG 600 | buttons, tile labels |
| `text-body-sm` | 13.5 | HG 400/600 | default body |
| `text-caption` | 13 | HG 400 | secondary copy |
| `text-unit` | 12.5 | HG 400 | the unit trailing a numeral |
| `text-small` | 12 | HG 400 | helper text |
| `text-micro` | 11.5 | HG 400 | legal, meta |
| `text-tab` | 10 | HG 600 | nav labels |

The handoff gave ranges for four steps (`display-md` 25-26, `display-sm` 21-23,
`body` 14-14.5, `micro` 11-11.5). A token cannot be a range, so each took a
single value from the sizes the reference screens actually use. The discarded
band is recorded in a comment beside each one.

---

## 4. Spacing

Tailwind's own 4px grid is untouched and still does the ordinary work. These
are the named values the layout depends on, so a screen gutter is `px-gutter`
and cannot drift by one step during an edit. Each works anywhere Tailwind takes
a spacing value: `p-`, `px-`, `gap-`, `h-`, `min-h-`, `mt-`.

| Token | Value | Use |
|---|---|---|
| `gutter` | 20px | screen gutter |
| `card` | 18px | card padding |
| `card-tight` | 16px | compact rows |
| `stack` | 16px | gap between cards |
| `shell-top` | 70px | clears the status bar |
| `shell-bottom` | 130px | clears the floating nav |
| `tap` | 44px | accessibility floor, not a design value |
| `ctl` | 46px | input, secondary button, energy cell |
| `ctl-lg` | 48px | primary submit |
| `nav` | 66px | bottom nav height |
| `fab` | 54px | check-in button |
| `sheet-row` | 52px | More sheet rows |
| `safe-t` `safe-r` `safe-b` `safe-l` | `env(safe-area-inset-*)` | notch and home indicator |

---

## 5. Radii and shadows

`rounded-ctl` 8 · `rounded-inset` 10 · `rounded-inset-pill` 7 (the pill inside a
segmented track) · `rounded-well` 11 · `rounded-card` 14 · `rounded-tile` 16 ·
`rounded-tile-lg` 18 · `rounded-sheet` 22 · `rounded-pill` 999.

> **`rounded-pill` was already used in twelve places and defined in none of
> them.** Tailwind emitted no CSS for it, so those pills have been rendering
> square. Adding the token fixes them, which is the one visible change in this
> work that was not asked for.

Cards have **no shadow**; they are border-defined. Only four things lift, and
each lifts because it floats over content rather than sitting in the flow:
`shadow-nav`, `shadow-fab`, `shadow-sheet`, `shadow-tile` (dark mosaic only).

`--shadow-ring` (`0 0 0 2px var(--primary)`) is the selection ring. A ring
rather than a thicker border, so the box does not grow by 1px when something is
chosen, which reads as a jump.

Easing: `ease-spring` for pills, switches and the sheet; `ease-press` for the
press feedback.

---

## 6. Component classes

All prefixed `iki-`, so they never collide with a Tailwind utility and one grep
finds every use. Compose them with utilities; they set structure, not layout.

**Press and touch**
- `.iki-press` scale 0.97 on active, plus `cursor-pointer`. Put it on every
  tappable thing, including card-shaped ones.
- `.iki-tap` gives a 44px hit area **without** a 44px box, via a centred
  pseudo-element. A 12px text link becomes fully tappable while occupying
  exactly the space it did before.

**Card**
- `.iki-card` surface, 1px line, radius 14, padding 18.
- `.iki-card-tight` compact padding for row lists.
- `.iki-card-accent` the one tinted card in the app (Future You scoreboard).

**Badges**
- `.iki-badge` base pill. Add one of `.iki-badge-good`, `.iki-badge-warn`,
  `.iki-badge-bad`, `.iki-badge-neutral`, `.iki-badge-primary`.
- `.iki-badge-flag` adds caps and tracking for LOW / HIGH / BORDERLINE.

**Buttons** (all take `.iki-btn` plus a variant)
- `.iki-btn-primary` h48, filled, the page's main action.
- `.iki-btn-secondary` h46, outlined.
- `.iki-btn-ceremonial` h44 pill in Marcellus caps. Reserved for brand moments
  ("Share your rank", "Connect a device"). Using it for an ordinary action
  spends the emphasis.
- `.iki-btn-link` underlined text link.

**Header**
- `.iki-eyebrow`, `.iki-title`, `.iki-lede`.

**List rows**
- `.iki-row` with `.iki-row-label` and `.iki-row-value`. The divider is on the
  row, so the last one loses its rule with no special case at the call site.
- `.iki-row-sheet` h52 tappable row for the More sheet.

**Navigation**
- `.iki-nav` the floating pill, with the safe-area inset already in its offset.
- `.iki-nav-item` 56x54, styled off `aria-current="page"` rather than a class,
  so the accessible state and the visible state cannot disagree.
- `.iki-nav-fab` the 54px check-in button, ringed in canvas so it reads as cut
  out of the bar.
- `.iki-shell` the page padding that clears the nav, the status bar and both
  side insets.

---

## 7. Mobile viewport

- `100dvh` on `html` and `body`, not `vh`. On mobile the toolbar collapses on
  scroll and `vh` stays frozen at the largest viewport, so a "full height"
  screen ends up taller than the window.
- `viewportFit: "cover"` in `layout.tsx`. **Without it every
  `env(safe-area-inset-*)` reports 0** and each safe-area calc silently becomes
  a no-op that looks like it works.
- `-webkit-tap-highlight-color: transparent` on body, and `touch-action:
  manipulation` on controls only, not on body, since it would interfere with
  pinch zoom on content a member may want to enlarge, such as a lab report.
- `:focus-visible` draws a 2px primary ring at offset 2. Never removed.
- `prefers-reduced-motion` collapses animation to nothing and turns the press
  feedback into a brightness change, so the interface still answers a tap
  without moving.

**The 44px minimum is `.iki-tap`, not a blanket rule.** Setting
`min-height: 44px` on every button would be the obvious reading of it and would
push apart every dense row in about forty components I was asked not to touch:
the ✕ dismiss, the Show/Hide toggles, the copy chip. Every component class
above already meets 44px natively; `.iki-tap` covers the text links. If you do
want the blanket version, it is four lines in the base layer, and it is a
restyle of the whole app rather than a token change.

---

## 8. Dark mode is defined but not switched on

The `.dark` block and the `@custom-variant dark` rule are in place, so every
token flips correctly the moment something adds `dark` to `<html>`. Nothing
does yet, so today this changes nothing on screen.

Turning it on is a behaviour change, not a token change: it needs the class
toggled from `prefers-color-scheme` with a manual override, and
`layout.tsx` still declares `colorScheme: "light"` in its viewport export.

Note that **terracotta lifts one step in dark**: `#b5562d` has too little
luminance against `#1b1815`, so `--primary` becomes the clay value and
`--primary-deep` takes the old primary. This is exactly why components must
reference tokens and never the raw palette: the mapping changes, the name does
not.

---

## 9. What was deliberately not done

- **No Noto Sans JP.** The handoff asks for it for the four rank kanji. This
  repo already solves that better: `src/lib/rank-kanji.ts` carries them as
  outline paths, so they render identically in the app, in the share card and
  in a PDF with no webfont at all. Downloading a CJK family for four glyphs
  would be a large payload to reach a worse place. `--font-jp` exists with a
  system stack for text that is genuinely Japanese.
- **No component was restyled.** These classes are additive and nothing uses
  them yet, so shipping them changed nothing on screen except the twelve
  `rounded-pill` call sites noted above.
- **Hanken Grotesk 700 was added** to the font load. It is in the handoff's
  scale (flag badges, points amounts, the copy chip) and was not being loaded,
  so those would have rendered at 600 and looked like a weight that did not
  take.
