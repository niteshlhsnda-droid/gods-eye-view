# GLOSSARY.md — Shared language

Fixed meanings. Use these words this way in code, docs, and handoffs.

- **lane** — one agent role with owned files (Satellites/GNSS, Street
  Level, Geo-import, City Drives, Docs, QA/Scoreboard, Live Now).
  See `docs/Rules.md` ownership table.
- **layer** — one catalog data overlay (31 total: 30 in the registry +
  1 local-only ADS-B). Has a provider, a freshness chip, and a panel.
- **panel** — a UI surface in the shell (layer panel, City Drives
  panel, DISPLAY panel). Collapsible, keyboard-navigable.
- **chrome** — shell furniture: command dock, trays, toasts, alerts,
  share controls. Not data.
- **shell** — `src/ui/shell`: owns the dock, trays, panels, camera
  control. Panels never bypass it.
- **cycle** — one hourly round: every lane produces one researched
  idea and attempts to implement it on a scratch branch.
- **scratch branch** — `idea/<lane>-<timestamp>`: additive-only vs its
  base, local-only until merged. Never committed to by another lane.
- **batch merge** — merging a set of cycle branches (e.g. Cycles 1–5
  = Batch 1) to main after full gates, under approval.
- **gate** — a required check (format, boundaries, targeted/full
  tests). Gates run solo; never piped when the exit code matters.
- **toast** — a transient shell notification (e.g. "Opening City
  Drives…"). Diagnostic, not a state.
- **tray** — a collapsible group in the command dock (LOCATION,
  layers, tools). Holds panel launchers.
- **popover** — a small overlay inside a tray (e.g. LOCATION tray's
  search popover holding the 🚗 launcher).
- **LIVE / RECORDED / CONTINUOUS** — freshness chips. LIVE = proven
  live data/feed now. RECORDED = captured earlier (e.g. drive-throughs).
  CONTINUOUS = ongoing but not proven live. Full vocabulary:
  SNAPSHOT, SIMULATED, PROPAGATED, STALE, PRELIMINARY, VINTAGE UNKNOWN.
- **port** — the upstream-gap port (`port/upstream-gaps`), merged to
  main 2026-10-17. Not ongoing work.
- **upstream** — the original God's Eye View repo this fork descends
  from. Its demo is dead; research via repo + docs.
