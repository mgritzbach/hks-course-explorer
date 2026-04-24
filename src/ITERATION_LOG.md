# Iteration Log

- SC-1: DONE - Reduced scatter marker opacity, added deterministic +/- 0.015 jitter, added axis titles and default-view quadrant labels, and wired Plotly hovertemplate to course name, code, and instructor.
- SC-2: DONE - Added the requested empty states on Home, Courses, and Faculty, including a working clear-filters action on Home and centered placeholder content in the detail panes.
- SC-3: DONE - Added nav aria labels and hidden decorative emoji, made the theme default follow system preference when no saved theme exists, improved mobile drawer focus handoff, and marked the Home result count as a polite live region.
- SC-4: DONE - Added a reusable skeleton card, shimmer animation styles, and a structured loading shell in App with five course-card placeholders plus three desktop filter block skeletons.
- SC-5: DONE - Added an animated mobile drawer backdrop and swipe-to-close gestures across the shared Home, Faculty, and Courses mobile filter drawers.
- SC-6: DONE - Added a persisted compact/full card view toggle on Home and compact card rendering that hides excerpts, notes, and secondary actions when enabled.
- SC-7: DONE - Added low-N response warnings beneath course rating stacks, using single-term or all-years respondent counts and caution coloring for small samples.
- SC-8: DONE - Added up-right external-link indicators to course, faculty-profile, and footer links that open in new tabs across the touched views.
- SC-9: DONE - Added the requested description, Open Graph, and Twitter social meta tags to the app head for richer link previews.
- SC-10: DONE - Replaced the fixed 180-character excerpt with an inline read-more/show-less toggle for long course descriptions.
- SC-11: DONE - Added `hks_storage_version` gating that clears only stale planner/completed-course keys while preserving favorites and notes.
- SC-12: DONE - Wrapped the Home scatter plot in a local ErrorBoundary with a lightweight fallback message so chart failures do not break browsing.
