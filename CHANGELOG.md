# Changelog

## 0.1.0 — unreleased

Initial MVP: autoresearch with verifiable long-term memory.

- **Two-layer persistence**: ephemeral `.auto/` session + durable
  `.research-memory/` VKF bundle that persists across runs.
- **Seven tools**: `init_research`, `remember_claim`, `verify_claim`,
  `recall_memory`, `run_experiment`, `log_experiment`, `research_status`.
- **Six skills**: `autoresearch-create` (spine), `knowledge-gather`,
  `claim-extract`, `claim-verify`, `hypothesis-loop`, `research-report`.
- **VKF bridge**: shells out to the `vkf` CLI (auto-detected in a `VKF` conda env
  or via `$PI_AUTORESEARCH_VKF`) for validation, graph, freshness, and permission
  checks; reads/writes bundle markdown directly. Degrades gracefully when `vkf`
  is absent.
- **Trust lifecycle**: memory states (candidate → source_verified →
  locally_tested/replicated → contradicted → deprecated → retired) mapped onto
  VKF `status` + a staging/verified/deprecated directory layout, with a
  transaction record for every change (propose-don't-promote).
- **Belief updates**: numeric belief per claim, mirrored to VKF's categorical
  `confidence`, updated on each experiment outcome.
- Generated bundles validate at VKF Profile 1 (governed).
