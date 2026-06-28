---
name: research-report
description: Produce the autoresearch report with full idea lineage — paper → claim → hypothesis → patch → metric change → status → memory update. Use to summarize an autoresearch run into an auditable, human-readable report at .auto/report.md.
---

# Research report

Turn the run into an auditable story. The point of verifiable memory is that every
result can be traced back to where the idea came from and forward to what was
learned. Make that lineage explicit.

## Gather the material

- `export_dashboard` to write the browser views — `progress.html` (metric chart +
  timeline) and `dashboard.html` (the idea-lineage graph) — and link them from the
  report.
- `research_status` for the session experiments and memory lifecycle counts.
- `recall_memory` for the trusted claims, candidates, and negatives.
- The memory bundle itself (`.research-memory/`): paper, claim, and experiment
  cards, and the `transactions/` audit trail.

## Write `.auto/report.md`

Include:

1. **Goal & metric** — objective, metric, direction, baseline → best achieved.

2. **Headline result** — the best outcome and the change that produced it.

3. **Idea lineage** — the heart of the report. For each idea that was tried, a
   chain:

   ```
   Paper:      <title> (<source_url>)
   Claim:      <claim:id> — <assertion>   [mechanism: …]
   Hypothesis: <intervention + prediction>
   Patch:      <what changed / commit>
   Metric:     <baseline> → <observed>  (Δ …)
   Status:     win | loss | inconclusive
   Memory:     <claim belief x → y, state →>; experiment card <experiment:id>
   ```

4. **What we learned** — durable takeaways now in memory, including **negative
   results** ("X failed here because … — don't retry unless …").

5. **Open directions** — promising-but-untested ideas and gaps/contradictions
   worth exploring next run.

6. **Provenance & trust** — counts by lifecycle state; note anything flagged
   `stale` by `vkf freshness`; confirm `vkf validate` passes at the bundle's
   profile.

## Tone

Honest over impressive. The differentiator of this system is that its memory is
*verifiable* — so report what replicated, what didn't, and what is still just
"the paper says so." Never inflate a 5-minute proxy win into a real win; say which
it is.
