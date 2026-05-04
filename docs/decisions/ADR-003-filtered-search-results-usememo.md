# ADR-003: filteredSearchResults useMemo is the single source of truth

## Status
Accepted

## Context
Early versions ran browse filtering in a useEffect with setState, causing race conditions. Stale async results would overwrite newer filter results, leading to the display showing courses from a previous filter state.

## Decision
All browse filtering is done synchronously in a useMemo called `filteredSearchResults`. This is the single source of truth for the filtered results displayed to the user. No async filtering, no separate state for filtered results — the useMemo IS the display list.

## Consequences
- Filtering is always synchronous and guaranteed race-condition-free
- Filter performance depends on filtering algorithm efficiency (useMemo memoizes across renders)
- Never move browse logic into an async effect; it will reintroduce race conditions
- If filtering needs to depend on async data, wait for that data to load first, then pass it to the useMemo
