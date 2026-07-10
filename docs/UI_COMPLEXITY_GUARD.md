# UI Complexity Guard

The repository already limits growth of large UI modules by line count. This
companion guard limits cyclomatic complexity of the corresponding top-level
functions using ESLint's core `complexity` rule.

| File | Function | Approved maximum |
| --- | --- | ---: |
| `src/App.jsx` | `App` | 24 |
| `src/pages/ScheduleBuilder.jsx` | `ScheduleBuilder` | 123 |
| `src/pages/Courses.jsx` | `Courses` | 100 |
| `src/components/ScatterPlot.jsx` | `ScatterPlot` | 69 |

The check is a ratchet: equal or lower complexity passes. Any increase or a
missing protected function fails CI. Update a baseline only with a recorded
architecture decision and matching regression evidence. Run it locally with:

```sh
npm run check:ui-complexity
```
