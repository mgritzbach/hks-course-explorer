# ADR-002: live_courses fetched in its own isolated useEffect

## Status
Accepted

## Context
Fetching live_courses inside the semester-dependent effect caused it to flash empty on every semester change. This made the Non-HKS browse section disappear and reappear, creating a jarring user experience and breaking the visual continuity of the interface.

## Decision
live_courses must have its own `useEffect([], [])` with an empty dependency array, completely separate from the semester/search effect. It is fetched once on component mount and never refetched.

## Consequences
- live_courses is static for the lifetime of the component
- If you add live_courses to another effect's dependency array, the Non-HKS browse section will break on every filter change
- Any future feature that requires live_courses to update dynamically must create a new separate effect, not reuse this one
