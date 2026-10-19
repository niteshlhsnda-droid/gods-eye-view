# Design.md — Experience (behavior over time)

How the product looks, feels, and behaves — not just colors. Agents
must reference this for every UI commit. Visual states are defined
here; appearance alone is not enough.

## Principles

- **The globe is the primary focal point.** Chrome (dock, trays,
  panels) frames it; nothing covers it without a way back.
- **Dark command-dock aesthetic.** Panels are collapsible, grouped in
  trays (LOCATION, layers, tools); popovers hold secondary actions.
- **Honesty is visual.** Status is shown, not implied — see the state
  catalog below.

## UI state catalog (every feature implements all applicable states)

| State | Treatment |
|---|---|
| initial | skeleton/placeholder, never fake data |
| loading | progress indicator; multi-phase for heavy loads |
| loaded | data + freshness chip + source label |
| empty (healthy) | explicit "no results" — visually distinct from failure |
| stale | STALE chip + age; old data never presented as current |
| partial failure | working parts render; failed part labelled, retry offered |
| complete failure | "unavailable" + reason + retry; never a black screen |
| retry | re-fetch; distinguished message if the source is the problem |

**Critical rule:** a dead camera/feed must not look operational. A
thumbnail remaining after its feed stops must carry STALE/unavailable
treatment — the visual status always reflects the actual data state.

## Honesty chips

LIVE · CONTINUOUS · SNAPSHOT · SIMULATED · PROPAGATED · STALE ·
PRELIMINARY · VINTAGE UNKNOWN (full rules in `docs/Rules.md`).
City Drives Drive tab: always "Recorded drive-through (not live)".
Recorded vs live telemetry must be unmistakable at a glance.

## Globe interaction

Zoom, pan, rotate; eased camera fly-to on selection; layer ordering
predictable; selection highlights. Switching layers never resets the
camera. Rapid place-hopping without per-stop labels is an anti-pattern
(research finding).

## City Drives (distinct experience)

Panel (search + 179-city list) → tap city → camera flies → card opens
with Drive / Live Radio tabs. Drive = recorded iframe embed (16:9,
with "Open on driveandlisten.app ↗" fallback if framing fails).
Radio = live stream, stops on panel close or city switch. Credits
always visible in the panel footer.

## Mobile

Touch targets ≥44px; trays collapse to the lower half; panels are
full-width sheets; no hover-only affordances. The 🚗 launcher lives
inside the LOCATION tray popover, next to search.

## Accessibility and input

Keyboard navigation for all panels and layer toggles; visible focus;
contrast meets WCAG AA on chips and labels; `prefers-reduced-motion`
disables camera easing and ambient animation; every globe interaction
has a non-globe alternative (list/search) where feasible.

## Reference

Keep reference screenshots of key states (loaded, stale, failure) with
the design source. A UI change is done only when its states are
visually verified — technical checks (tests, builds) do not catch
visual regressions.
