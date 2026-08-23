---
version: alpha
name: "DigestDesk"
description: "A bilingual editorial reading workspace that turns subscribed sources into a calm daily edition."
colors:
  background: "oklch(0.985 0.01 95)"
  foreground: "oklch(0.16 0 0)"
  primary: "#FF6719"
  primary-foreground: "#ffffff"
  secondary: "oklch(0.955 0.01 95)"
  muted-foreground: "oklch(0.46 0 0)"
  border: "oklch(0.84 0.01 95)"
  ring: "#FF6719"
typography:
  display:
    fontFamily: "Fraunces, ui-serif, Georgia, serif"
  body:
    fontFamily: "Newsreader, ui-serif, Georgia, serif"
rounded:
  DEFAULT: "0.25rem"
  sm: "0rem"
  md: "0.125rem"
  lg: "0.25rem"
spacing:
  page-inline-mobile: "1rem"
  page-inline-tablet: "1.5rem"
  page-inline-desktop: "2rem"
  section-gap: "3rem"
components:
  button: {}
  card: {}
  navigation: {}
  editorial-list: {}
---

# DigestDesk Design System

## Overview

### Creative North Star

DigestDesk should feel like a personal editor's desk at the start of the day: typographic, ordered, and fast to scan. It borrows the authority of a newspaper contents page without reproducing a broadsheet grid or decorating every block with rules.

### Product context and register

- **Audience and primary job:** People who follow newsletters, podcasts, RSS, and YouTube and need one edited daily reading queue.
- **Target markets and evidence:** Global product with Chinese and English interface modes, based on the maintained locale provider and existing copy.
- **Locale and language policy:** Chinese and English share the same layout hierarchy; controls, dates, feedback, and accessible labels follow the active locale.
- **Usage scene:** Recurring desktop reading with a responsive mobile fallback; the daily digest favors scanability over dashboard density.
- **Register:** Hybrid. The public route may be expressive; the authenticated workspace is a restrained product surface.
- **Memorable signature:** Oversized editorial headings paired with ordered reading entries and one sharp orange accent.
- **Restraint:** Static reading content stays flat. Cards are reserved for distinct state, input, or completion surfaces.
- **Anti-references:** Generic SaaS metric grids, stacked cards around every article, decorative dividers, and long entrance animation.
- **Token ownership/runtime mapping:** `src/index.css` remains the canonical runtime token source. This file mirrors accepted values and explains their intended use.

## Colors

The warm paper background and near-black ink carry the reading experience. Orange is reserved for primary actions, focus, and the single editorial feature signal. Secondary surfaces replace borders when a quiet grouping is enough. Border color is structural, not decorative.

## Typography

Fraunces owns page and section headings. Newsreader owns navigation, controls, metadata, and prose. Hierarchy comes first from size and spacing, then weight. Body text remains upright; italics are not a default summary treatment. Long Chinese and English titles wrap instead of truncating in the main reading flow.

## Layout

Authenticated daily reading may use the full viewport width while management routes retain a bounded container. A persistent navigation rail, a compact contents column, and a fluid article column form the desktop structure. Mobile collapses to one column and keeps the contents disclosure keyboard accessible.

## Elevation & Depth

Static editorial content uses no shadow. Tonal secondary surfaces group navigation, archive choices, and the contents panel. Shadows remain available for transient or stateful surfaces already owned by shared components.

## Shapes

Controls and grouping surfaces use the existing compact radius family. Pills are limited to compact primary actions. Article rows do not become rounded containers.

## Components

### Foundational visual states

Interactive elements expose hover, focus-visible, disabled, and busy states. Loading geometry is reserved. Empty, error, and completion states may use the shared Card component because they represent a distinct workflow state.

### Buttons and actions

Orange solid buttons are primary. Ghost and text actions handle navigation and low-emphasis choices. External links keep a text label and external-link icon.

### Navigation and data display

The daily digest is an ordered editorial list. Number, source, title, summary, and takeaways create hierarchy without per-item borders. The contents panel is the only persistent reading-group surface.

### Forms and overlays

Existing shared primitives remain canonical. Feedback uses the shared toast provider, and product flows do not use browser-native dialogs.

### Iconography

Lucide remains the application icon family; source brands use supplied logos. Icons supplement text labels rather than replacing unfamiliar actions.

### Motion

Motion communicates loading, expansion, scrolling, and mode changes. Primary content is immediately readable, and reduced-motion preferences are respected.

### Content and data visualization

Copy is direct and editorial. It names what the reader can do and avoids invented product claims. Numeric metadata uses tabular figures when alignment matters.

## Do's and Don'ts

- **Do:** Use typography, numbering, and whitespace as the main reading structure.
- **Do:** Preserve real synchronization, filtering, archive, and source-navigation behavior during visual changes.
- **Don't:** Put every digest article, source heading, and navigation group in separate bordered cards.
- **Don't:** Treat Mega4Labs content as internally integrated until a maintained data contract exists; label the external curated destination honestly.
