---
name: Ascend CRM
description: Deal tracking and one-click lender submissions for Ascend Fund's funding desk.
colors:
  teal: "#0f6e66"
  teal-ink: "#ffffff"
  teal-wash: "#e3f1ef"
  ink: "#15201d"
  ink-muted: "#5d6b67"
  ink-faint: "#8a9692"
  paper: "#f3f5f4"
  surface: "#ffffff"
  surface-2: "#f7f9f8"
  hairline: "#e1e7e4"
  hairline-strong: "#cdd6d2"
  pine: "#10211e"
  pine-ink: "#d6e3df"
  pine-muted: "#8aa29b"
  good: "#1d7a46"
  good-wash: "#e2f3e8"
  warn: "#9a5c00"
  warn-wash: "#fbf0dc"
  bad: "#b3261e"
  bad-wash: "#fbe5e3"
typography:
  headline:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.3
  body:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.07em"
  figure:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
    fontFeature: "tnum"
rounded:
  xs: "4px"
  sm: "7px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "10px"
  lg: "14px"
  xl: "18px"
  2xl: "28px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "7px 11px"
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.teal-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "7px 11px"
  button-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.body}"
    padding: "0"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "7px 11px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "18px 20px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  pill:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.small}"
    rounded: "{rounded.pill}"
    padding: "2px 9px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.pine-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
  nav-item-active:
    backgroundColor: "rgba(63, 179, 166, 0.16)"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "8px 10px"
---

# Design System: Ascend CRM

## Overview

**Creative North Star: "The Underwriter's Desk"**

Ascend CRM is a working desk, not a showcase. A rep opens a deal and needs the merchant, the files, the bank scrub, the lenders and the timeline on one scrolling page, readable at a glance and dense enough that nothing important is a click away. The design serves that scene with calm restraint: a near-white page, white panels separated by hairlines, one teal accent used for the single action that matters and for "this is live" states, and a dark pine sidebar that holds navigation out of the way. Nothing is decorative; brand lives in precise details such as the teal brand mark, the mono figures and the soft status pills.

Numbers are the content. Money, balances, scores, dates, emails and file sizes are set in JetBrains Mono with tabular figures so columns line up and amounts can be compared by eye. Everything else is Instrument Sans at 14px, with hierarchy carried by weight and small uppercase labels rather than by size jumps. Color is reserved for meaning: green is good, amber is caution, red is bad, teal is action or "in progress"; grey is everything else.

The same system runs in light and dark mode through one set of tokens. Dark mode is a tonal recolor of the same design: slightly brighter teal, no shadows, the same hairline structure.

**Key Characteristics:**

- One accent (teal), used sparingly: primary buttons, links, active navigation, focus rings, "sent / in review" states.
- Structure by hairline borders on white panels; shadows are a whisper in light mode and absent in dark mode.
- Figures in mono with tabular numerals; prose in Instrument Sans; uppercase 11px tracked labels for sections and table headers.
- Dense but breathable: 14px body, 18/20px panel padding, 14px between panels, 1240px content column beside a 224px sidebar.
- Status as soft pills (tinted wash, no border) and small square grade chips; never as loud banners.

## Colors

A grey-green neutral family with one teal accent and three semantic hues, each paired with a pale wash for backgrounds.

### Primary

- **Ascend Teal** (#0f6e66): the only accent. Primary buttons, links, active nav highlight (as a 16% wash on the sidebar), focus rings, the brand mark, "sent / in review" pills and done steps in the stage stepper. In dark mode it brightens to #3fb3a6 with near-black text (#06201c) on it.
- **Teal Wash** (#e3f1ef): background of in-progress pills, outgoing chat bubbles, and the 3px focus halo on inputs. Dark mode: #15302c.

### Neutral

- **Ink** (#15201d): all primary text. Dark mode: #e4ece9.
- **Muted Ink** (#5d6b67): secondary text, labels, table headers, breadcrumbs, dt keys. Dark mode: #9db0aa.
- **Faint Ink** (#8a9692): tertiary text, empty states, timestamps, placeholder-level emphasis. Dark mode: #6f8580.
- **Paper** (#f3f5f4): the page background. Dark mode: #0d1513.
- **Surface** (#ffffff): panels, cards, inputs, the deal header. Dark mode: #141e1c.
- **Surface 2** (#f7f9f8): board columns, stat tiles, chat background, default pill fill; one tone down from a panel. Dark mode: #18231f.
- **Hairline** (#e1e7e4) and **Strong Hairline** (#cdd6d2): panel and row borders; the stronger one for input borders, table header rules and the stepper track. Dark mode: #23312d / #2f403b.
- **Pine** (#10211e) with **Pine Ink** (#d6e3df) and **Pine Muted** (#8aa29b): the sidebar and its text. Dark mode sidebar: #0a1210.

### Semantic

- **Good** (#1d7a46) on **Good Wash** (#e2f3e8): approvals, fit scores, "live sending", success notices. Dark: #5cc98c / #15301f.
- **Warn** (#9a5c00) on **Warn Wash** (#fbf0dc): stips requested, outside-appetite scores, conflicts, test mode. Dark: #e6a94a / #33270f.
- **Bad** (#b3261e) on **Bad Wash** (#fbe5e3): declines, errors, closed-lost stage, failed messages. Dark: #f07f76 / #3a1a17.

### Named Rules

**The One Teal Rule.** Teal is the only accent and it marks action or progress: one primary button per panel, links, the active nav item, focus. It is never used as decoration, background fill or heading color.

**The Wash-Not-Border Rule.** Semantic states are shown as colored text on the matching pale wash with no border (pills, notices, score badges). Hairline borders are reserved for neutral structure.

## Typography

**Body Font:** Instrument Sans (with ui-sans-serif, system-ui, Segoe UI)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, SF Mono, Menlo, Consolas)

**Character:** A plain, slightly narrow humanist sans for reading, paired with a crisp mono for anything you compare or copy. The pairing reads as a well-kept ledger: quiet text, exact figures.

### Hierarchy

- **Headline** (650, 24px, 1.2, -0.015em): the page title (merchant name on a deal, "Settings"). Balanced wrapping. One per page.
- **Title** (650, 15px): panel headings ("Ascend application", "Ship the file"); flex row so a tag can sit beside it.
- **Body** (400, 14px, 1.5): everything else; form controls at 13px.
- **Small** (400, 12px): helper text, addresses, meta rows, timestamps, fields' labels (500 weight, muted).
- **Label** (600, 11px, 0.07em, UPPERCASE, muted): section eyebrows (h3), table headers (0.06em), stage stepper, stat tile keys, flag severities.
- **Figure** (JetBrains Mono, 500–600, tabular-nums): money and amounts (13px on cards, 17px in stat tiles, 24px in the risk score), email addresses (11.5px), counts, scores (11px pills), API secrets.

### Named Rules

**The Mono Figures Rule.** Any value a rep compares or copies (money, percentages, counts, dates in tables, emails, file sizes) is set in JetBrains Mono with tabular numerals. Prose never is.

**The Weight-Not-Size Rule.** Hierarchy inside a panel comes from weight (650/600/500/400) and the uppercase label, not from larger type. Only the page headline exceeds 17px.

## Layout

A fixed 224px pine sidebar (sticky, full height) beside one content column of stacked panels, padded 28px 32px and capped at 1240px. Panels are full-width blocks with 14px between them; two-column layouts use `.cols` (equal halves, 28px gutter). Deal pages open with a header card (title, facts row, six-step stage stepper) and a sticky, blurred sub-navigation bar that jumps to each panel; panels have a 64px scroll margin so they land below it. The pipeline board is a horizontal grid of 212px-minimum columns with 12px gaps and its own horizontal scroll.

Rhythm is on a loose 4px grid: 4/8/10/14/18/28. Inside panels, forms use `.stack` (10px gaps) and `.row` (8px wrapping flex); key/value lists use a 112px key column.

Below 860px the sidebar becomes a top bar (icons only, brand without tagline, nav pulled right), content padding drops to 20px 16px, and two-column layouts stack. Below 560px the stage stepper shows bars only plus the current stage's name. The merchant-facing pages use their own centered 620px card (920px when wide) on the same tokens.

## Elevation & Depth

Flat by default. Structure is drawn with 1px hairlines; a panel's shadow is a whisper (`0 1px 2px rgba(16,33,30,.06), 0 1px 1px rgba(16,33,30,.04)`) that only separates white from the near-white page. Dark mode removes shadows entirely and relies on the three surface tones (paper → surface → surface 2) and hairlines. The sticky sub-navigation floats on an 88% page-color blur rather than a shadow. Focus is a 2px teal outline (offset 2px) on anything focusable and a 3px teal-wash halo plus teal border on inputs.

### Shadow Vocabulary

- **Panel whisper** (`box-shadow: 0 1px 2px rgba(16,33,30,0.06), 0 1px 1px rgba(16,33,30,0.04)`): panels, cards, the deal header, login and merchant cards. Light mode only.

### Named Rules

**The Hairline-First Rule.** If a border can carry the structure, no shadow is added. Shadows never signal importance.

## Shapes

Soft rectangles with small radii, scaled to the element: 4px focus outlines, 6px grade chips and sub-nav links, 7px buttons, inputs and nav items, 8px cards, stat tiles and fieldsets, 10px panels and the deal header, 14px for the login and merchant cards. Status pills and counts are fully rounded (999px). Corners never exceed 14px; there are no circles except the 9px timeline dots, the 7px mode dot and the 76px risk-score ring. The signature pad is a dashed hairline rectangle. Rows inside lists and tables are separated by hairlines, never by boxes within boxes.

## Components

### Buttons

- **Shape:** gently rounded (7px), 13px text, 7px 11px padding, inline-flex with 6px icon gap.
- **Default:** white surface, strong-hairline border, 500 weight; hover darkens the border to faint ink.
- **Primary:** teal fill, white text, 600 weight; hover brightens 6%. One per panel, for the action that advances the deal ("Send to selected lenders", "Upload, read and sign").
- **Link:** no border or fill, muted ink, 400 weight; for "Sign out", "Clear", secondary choices.
- **Disabled:** 55% opacity, default cursor.
- **Focus:** 2px teal outline with 2px offset.

### Pills and chips

- **Status pill:** 11.5px 600 text, 2px 9px padding, fully rounded. Neutral = surface-2 with hairline; sent/in review = teal on teal wash; approved = good on good wash; declined = bad on bad wash; stips = warn on warn wash. No border on semantic variants.
- **Tag:** 11px 500, 1px 8px, hairline border; `.on` turns the border and text good.
- **Score badge:** mono 11px pill; fit = good on good wash, outside appetite = warn on warn wash.
- **Grade chip:** 22px square, 6px radius, 700 weight letter; A/B good, C warn, D bad.
- **Count:** mono 11px pill on surface with hairline (board column totals).

### Cards / Containers

- **Panel:** surface, hairline, 10px radius, panel whisper, 18px 20px padding, 14px vertical margin.
- **Deal card (board):** surface, hairline, 8px radius, 10px 12px padding, 4px grid gap; name 600, amount in mono 13px, meta row 12px; hover turns the border teal.
- **Stat tile:** surface-2, hairline, 8px radius, 10px 12px; uppercase 11px key over a mono 17px 600 value.
- **Notice:** 13px, 10px 14px, 8px radius; ok/warn/error on the matching wash with ink text.
- **Flag:** surface-2 row with a 3px left bar (bad/warn/strong hairline) and an 80px uppercase severity column.

### Inputs / Fields

- **Style:** surface, strong-hairline border, 7px radius, 13px text, 7px 11px padding.
- **Focus:** teal border plus a 3px teal-wash halo, no outline.
- **Field label:** 12px 500 muted text above the control, 5px gap, 10px below the field.
- **Checkbox:** 15px, teal accent-color. **File input:** 5px padding. **Fieldset:** hairline, 8px radius.

### Navigation

- **Sidebar:** pine background, 20px 14px padding, 24px gaps; brand row (28px teal mark with a 700 "A", name 650 with an 11px muted tagline), nav list, footer with the mode pill (dot: amber test / green live), user name and sign-out link in 12px muted.
- **Nav item:** 8px 10px, 7px radius, pine-ink 500 text with a 16px line icon at 75% opacity; hover = 6% white; active = 16% teal wash with white text and a full-opacity icon.
- **Sub-navigation (deal page):** sticky row of 6px 10px links, muted 500 text, hover turns surface/ink; sits on a blurred page-color bar.

### Stage stepper (signature component)

Six equal columns, each a 3px top bar with an 11px uppercase label beneath. Done and current steps turn the bar teal (current also colors the label); a closed-lost deal turns the current step red. On phones only the bars remain, plus the current step's name.

### Timeline

Hairline-separated rows with a 9px dot in the left gutter: strong hairline for outgoing or system events, teal for inbound lender email.

### Tables

`table.grid`: 13px, 10px cell padding, hairline row rules, uppercase 11px muted headers over a strong hairline. `table.num` adds mono 12.5px tabular cells with no wrapping.

## Do's and Don'ts

### Do:

- **Do** keep one teal primary button per panel and make every other control a default or link button.
- **Do** set every comparable figure (money, counts, dates in tables, emails) in JetBrains Mono with tabular numerals.
- **Do** carry hierarchy with weight (650/600/500) and 11px uppercase tracked labels; keep body at 14px and controls at 13px.
- **Do** build structure from hairlines on white panels (10px radius, 18px 20px padding, 14px apart) and let the panel whisper be the only shadow.
- **Do** express state as colored text on its pale wash (good/warn/bad/teal) with no border.
- **Do** define every color once as a token so dark mode stays a recolor, and check both themes.
- **Do** keep the sidebar pine and the page near-white; the content column stays at or under 1240px.

### Don't:

- **Don't** add gradients, colored panel backgrounds, large radii (over 14px) or drop shadows to signal importance.
- **Don't** use teal for headings, backgrounds or decoration, or add a second accent.
- **Don't** nest boxes inside boxes; rows are separated by hairlines, not cards within panels.
- **Don't** raise type sizes to create hierarchy; only the page headline exceeds 17px.
- **Don't** put icon tiles above headings or illustrations in empty states; an empty state is one line of faint text.
- **Don't** change wording, behavior or data in a visual pass; refinement keeps copy and function exactly as they are.
