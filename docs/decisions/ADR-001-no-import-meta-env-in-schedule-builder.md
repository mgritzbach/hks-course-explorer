# ADR-001: Centralized Supabase browser configuration

## Status

Accepted

## Context

Browser configuration is baked into every Vite artifact. Components must not
choose their own database project or embed credentials. A previous
project-specific fallback could make a misconfigured deployment silently use a
different environment.

## Decision

All browser code imports the client and `isSupabaseConfigured` from
`src/lib/supabase.js`. Only that module reads `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`; it has no project-specific fallback. The App fails
with an explicit operator-safe configuration message when either value is
missing. The deployment workflow validates and supplies target values before
building the artifact.

## Consequences

- The anon key remains public in the browser bundle, but it is target-specific
  build configuration rather than a source-code fallback.
- Supabase RLS remains the security boundary for browser access.
- Missing configuration fails visibly instead of silently reading from another
  project.
