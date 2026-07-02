/**
 * pi-autoresearch-vkf — autoresearch with verifiable long-term memory.
 *
 * This extension is the machinery; the domain knowledge (how to search the
 * literature, extract claims, pick the next experiment) lives in the skills.
 *
 * One self-contained workspace, two layers (see ./paths.ts):
 *   .autoresearch-vkf/session/   the per-run session (goal, experiment log)
 *   .autoresearch-vkf/memory/    a durable VKF bundle the loop reads from and
 *                                writes to, so future runs build on verified
 *                                knowledge instead of rediscovering it.
 *
 * The seven tools below implement the loop's spine: init → remember (literature)
 * → verify → recall → run → log (write-back). Everything an agent proposes lands
 * as a VKF *candidate* with a transaction record; promotion to a trusted state is
 * an explicit, audited step — never silent.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

import {
  ALTITUDES,
  beliefFromEvidence,
  buildClaimCard,
  buildExperimentCard,
  buildPaperCard,
  confidenceLabel,
  findCard,
  isTrustedForHypotheses,
  LEVERS,
  listCards,
  MEMORY_STATES,
  scaffoldMemoryBundle,
  transitionCard,
  writeCard,
  writeTransaction,
  type MemoryState,
  type Verification,
} from "./cards.ts";
import { autonomyMode, makeConfig, readConfig, researchMode, sessionMode, writeConfig, type ResearchConfig } from "./config.ts";
import { buildFullscreenLines } from "./dashboard.ts";
import { branchNameForIdea, remoteCommitUrl, snapshotToBranch } from "./git.ts";
import {
  appendExperiment,
  deriveOutcome,
  nodeBaseline,
  readExperiments,
  summarize,
  writeExperiments,
  type Experiment,
  type NodeKind,
  type Outcome,
} from "./experiments.ts";
import { appendLog } from "./jsonl.ts";
import { parseMetrics } from "./metrics.ts";
import { buildDashboardData } from "./progress_data.ts";
import { renderDashboardHtml } from "./progress_html.ts";
import { bucketKey, rankIdeas, selectBalanced, type IdeaInput } from "./scoring.ts";
import { bestNode, depths, selectExpansion } from "./tree.ts";
import { findCompositions, findContradictions, findTransfers, type CardLike } from "./synthesis.ts";
import { ensureSessionDirs, globalRoot, hasGlobalMemory, hasSession, memoryPaths, sessionPaths } from "./paths.ts";
import { refreshWidget, textResult, WIDGET_KEY } from "./render.ts";
import { resolveRoot, runtimeStore, sessionKey } from "./runtime.ts";
import { loadShortcuts } from "./shortcuts.ts";
import * as vkf from "./vkf.ts";

const MAX_OUTPUT_CHARS = 16_000;

/** Package version, surfaced in the dashboard footer. Keep in sync with package.json. */
const VERSION = "0.10.2";

const truncate = (s: string): string =>
  s.length <= MAX_OUTPUT_CHARS
    ? s
    : s.slice(0, MAX_OUTPUT_CHARS) + `\n…[truncated ${s.length - MAX_OUTPUT_CHARS} chars]`;

function requireSession(root: string): void {
  if (!hasSession(root)) {
    throw new Error("No .auto/ session in this directory. Call init_research first.");
  }
}

/** Summarize a post-write validation, for inclusion in tool output. */
function validationNote(root: string, profile: number): string {
  const memoryDir = memoryPaths(root).dir;
  const report = vkf.validate(memoryDir, profile);
  if (!report.available) {
    return "ℹ vkf CLI not found — memory written, but trust validation was skipped. Set $PI_AUTORESEARCH_VKF or install the VKF env to enable it.";
  }
  if (report.passed) return `✓ vkf validate passed (profile ${report.profile}).`;
  const errs = (report.issues ?? []).filter((i) => i.level === "ERROR").slice(0, 5);
  const lines = errs.map((e) => `   - ${e.path}: ${e.message}`);
  return `✗ vkf validate found ${report.summary?.ERROR ?? "?"} error(s):\n${lines.join("\n")}`;
}

/**
 * The autonomy directive appended to loop-tool outputs. Skill text fades out of
 * a long context; tool results recur every turn, so this line is what actually
 * keeps the loop running unattended. It re-asserts the contract (continue
 * without asking), the budget state, and the user's brake (the STOP file).
 */
function continuationNote(root: string, config: ResearchConfig): string {
  const sp = sessionPaths(root);
  if (existsSync(sp.stop)) {
    return `⏸ STOP requested (${sp.stop} exists) — halt the loop now, report with autoresearch-vkf-research-report, and wait for the user. (Deleting the file resumes.)`;
  }
  const used = readExperiments(sp.experiments).length;
  const max = config.maxIterations;
  if (max !== undefined && used >= max) {
    return `■ Budget exhausted (${used}/${max} iterations) — stop and hand off to autoresearch-vkf-research-report.`;
  }
  const budget = max !== undefined ? `iteration ${used}/${max}` : `iteration ${used} (no cap set)`;
  if (autonomyMode(config) === "confirm-each") {
    return `Autonomy: confirm-each — ${budget}. Check in with the user before the next experiment.`;
  }
  return (
    `▶ Autonomy: continuous (pre-authorized) — ${budget}. Do NOT pause to ask permission or offer options: ` +
    `continue the loop now (recall/refresh research → plan_next_step → implement → vkf_run_experiment → vkf_log_experiment). ` +
    `Stop only when the budget is exhausted, the goal is met, the loop is blocked on something only the user can do, or ${basename(sp.stop)} appears in the session dir.`
  );
}

/**
 * Ids of memory cards that should be treated as stale: those whose `valid_until`
 * is in the past, plus anything `vkf freshness` flags. Used to down-weight stale
 * knowledge in scoring so it doesn't steer the loop on equal footing.
 */
function staleIdSet(root: string): Set<string> {
  const ids = new Set<string>();
  const today = new Date().toISOString().slice(0, 10);
  for (const c of listCards(root)) {
    const vu = c.meta["valid_until"];
    if (typeof vu === "string" && vu && vu < today) ids.add(String(c.meta["id"]));
  }
  const fresh = vkf.freshness(memoryPaths(root).dir);
  if (fresh.available && fresh.report && typeof fresh.report === "object") {
    const stale = (fresh.report as { stale?: unknown[] }).stale;
    if (Array.isArray(stale)) {
      for (const s of stale) {
        const id =
          typeof s === "string"
            ? s
            : s && typeof s === "object"
              ? String((s as { id?: unknown }).id ?? "")
              : "";
        if (id) ids.add(id);
      }
    }
  }
  return ids;
}

export default function autoresearchExtension(pi: ExtensionAPI): void {
  // ── init_research ──────────────────────────────────────────────────────────
  const InitParams = Type.Object({
    name: Type.String({ description: "Human-readable session name, e.g. 'Speed up the test suite'." }),
    goal: Type.String({ description: "The research goal / optimization objective, in words." }),
    command: Type.Optional(Type.String({ description: "Shell command (run via `bash -lc`) that prints `METRIC <name>=<number>` lines. Often a wrapper that calls .auto/measure.sh. OMIT for an ideation session (no measurable target yet) — the deliverable is then a ranked research plan via draft_research_plan." })),
    metric_name: Type.Optional(Type.String({ description: "Name of the metric to optimize, matching the METRIC line, e.g. 'wall_clock_s'. Omit for ideation sessions." })),
    direction: Type.Optional(Type.Union([Type.Literal("higher"), Type.Literal("lower")], { description: "Which direction is an improvement. Default 'higher'." })),
    files_in_scope: Type.Optional(Type.Array(Type.String(), { description: "Files/globs the loop may modify." })),
    max_iterations: Type.Optional(Type.Number({ description: "Optional cap on loop iterations." })),
    autonomy: Type.Optional(Type.Union([Type.Literal("continuous"), Type.Literal("confirm-each")], { description: "Loop autonomy. 'continuous' (default): once inputs are confirmed the loop runs without asking — the user's brake is the session STOP file. 'confirm-each': check in before every experiment." })),
    memory_profile: Type.Optional(Type.Union([Type.Literal(1), Type.Literal(2)], { description: "VKF conformance profile for the memory bundle (1 governed, 2 verified). Default 1." })),
    working_dir: Type.Optional(Type.String({ description: "Directory experiment commands run in. Defaults to the project root." })),
  });

  pi.registerTool({
    name: "init_research",
    label: "Init research",
    description:
      "Scaffold a .autoresearch-vkf/ workspace (session/ + memory/ VKF bundle) for an autoresearch loop. Idempotent: an existing session is reported, not overwritten. Call once at the start. With a measure `command` this is an optimize session; without one it's an *ideation* session whose deliverable is a ranked research plan (draft_research_plan).",
    parameters: InitParams,
    async execute(_id, params: Static<typeof InitParams>, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ created: boolean }>> {
      const root = params.working_dir ?? ctx.cwd;
      const sp = sessionPaths(root);
      const existing = readConfig(sp.config);
      if (existing) {
        refreshWidget(ctx, root);
        return textResult(
          `A research session already exists: "${existing.name}".\nSession: ${sp.dir}\nMemory:  ${memoryPaths(root).dir}\nContinue the loop with recall_memory → vkf_run_experiment → vkf_log_experiment.`,
          { created: false },
        );
      }

      ensureSessionDirs(root);
      const config = makeConfig({
        name: params.name,
        goal: params.goal,
        command: params.command,
        metricName: params.metric_name,
        direction: params.direction,
        filesInScope: params.files_in_scope,
        workingDir: params.working_dir,
        maxIterations: params.max_iterations,
        memoryProfile: params.memory_profile,
        autonomy: params.autonomy,
      });
      writeConfig(sp.config, config);
      writeExperiments(sp.experiments, []);
      if (sessionMode(config) === "optimize") writeFileIfAbsent(sp.measure, measureStub(config.command));
      writeFileIfAbsent(sp.prompt, promptStub(config));
      const fresh = scaffoldMemoryBundle(root, params.name, config.memoryProfile);
      appendLog(sp.log, { event: "init", name: config.name, goal: config.goal });

      // Create the progress dashboard up front so it exists from iteration zero;
      // it then refreshes automatically as experiments are logged.
      writeProgressDashboard(root);
      refreshWidget(ctx, root);
      return textResult(
        [
          `Initialized research session "${config.name}".`,
          `Session dir: ${sp.dir}`,
          `Memory bundle: ${memoryPaths(root).dir} ${fresh ? "(new)" : "(existing)"} — profile ${config.memoryProfile}.`,
          sessionMode(config) === "optimize"
            ? `Optimizing ${config.metricName} (${config.direction} is better).`
            : "Ideation session (no measure command) — the deliverable is a ranked research plan.",
          `Autonomy: ${autonomyMode(config)}${config.maxIterations ? ` · budget ${config.maxIterations} iterations` : ""}.` +
            (autonomyMode(config) === "continuous"
              ? ` The loop is pre-authorized — don't pause to ask between iterations; the user can halt it anytime by creating ${sp.stop}.`
              : ""),
          "",
          sessionMode(config) === "optimize"
            ? "Next: gather literature (autoresearch-vkf-knowledge-gather skill) → remember_claim candidates → verify_claim → recall_memory to pick an idea → vkf_run_experiment → vkf_log_experiment."
            : "Next: recall_memory → gather literature (autoresearch-vkf-knowledge-gather) → remember_claim/verify_claim → synthesize (find_contradictions / find_transfers / find_compositions) → draft_research_plan.",
        ].join("\n"),
        { created: true },
      );
    },
  });

  // ── remember_claim ─────────────────────────────────────────────────────────
  const PaperSub = Type.Object({
    title: Type.String({ description: "Paper / source title." }),
    source_url: Type.String({ description: "URL, arXiv id, or DOI." }),
    authors: Type.Optional(Type.String({ description: "Author list (free text)." })),
    year: Type.Optional(Type.Number({ description: "Publication year." })),
    summary: Type.Optional(Type.String({ description: "One-paragraph summary of the source." })),
  });
  const RememberParams = Type.Object({
    title: Type.String({ description: "Short title for the claim / research atom, e.g. 'AdaGC stabilizes early LLM training'." }),
    assertion: Type.String({ description: "The single, checkable assertion this claim makes." }),
    mechanism: Type.Optional(Type.String({ description: "The mechanism — WHY it should work. Mechanism, not keywords, is what enables cross-domain transfer." })),
    context: Type.Optional(Type.String({ description: "The setting the claim applies to, e.g. 'transformer pretraining'." })),
    implementation_recipe: Type.Optional(Type.String({ description: "How to implement it in this codebase." })),
    failure_modes: Type.Optional(Type.String({ description: "Known or suspected ways this fails / interacts badly." })),
    confidence: Type.Optional(Type.Number({ description: "Initial belief in [0,1] that this helps our goal. Default 0.5." })),
    recency_score: Type.Optional(Type.Number({ description: "How recent the supporting literature is, [0,1]." })),
    reliability_score: Type.Optional(Type.Number({ description: "How reliable/robust the evidence is, [0,1]. A new paper can be high recency, low reliability." })),
    expected_value: Type.Optional(Type.Number({ description: "Scoring input: how much this could move the metric if it works, [0,1]. Defaults to belief." })),
    feasibility: Type.Optional(Type.Number({ description: "Scoring input: how easy to implement within scope, [0,1]. Default 0.6." })),
    info_gain: Type.Optional(Type.Number({ description: "Scoring input: how much a test would teach us, [0,1]. Defaults to belief uncertainty." })),
    implementation_cost: Type.Optional(Type.Number({ description: "Scoring input: relative cost to try, (0,1]. Default 0.4." })),
    origin: Type.Optional(Type.Union([Type.Literal("literature"), Type.Literal("contradiction"), Type.Literal("transfer"), Type.Literal("synthesis")], { description: "Where this idea came from. Use 'contradiction'/'transfer'/'synthesis' for agent-generated hypotheses (vs 'literature' for extracted claims). Default 'literature'." })),
    lever: Type.Optional(Type.Union(LEVERS.map((l) => Type.Literal(l)), { description: "Which part of the system this idea touches: 'data' (inputs/fixtures), 'objective' (what's optimized / the metric definition), 'representation' (encoding/format), 'algorithm' (the core method/logic), 'architecture' (structure/composition), 'evaluation' (how it's measured), 'constraints' (budgets/limits treated as fixed). Used for coverage and structural novelty." })),
    altitude: Type.Optional(Type.Union(ALTITUDES.map((a) => Type.Literal(a)), { description: "How big a change this is: 'hyperparameter' (tweak a value), 'component' (swap a module), 'mechanism' (change how it works), 'reframe' (change what's optimized/measured). Prefer tagging honestly — a reworded tweak is still 'hyperparameter'." })),
    derived_from: Type.Optional(Type.Array(Type.String(), { description: "Ids of existing cards this hypothesis was synthesized from (must already exist in memory)." })),
    paper: Type.Optional(PaperSub),
  });

  pi.registerTool({
    name: "remember_claim",
    label: "Remember claim",
    description:
      "Record a literature-derived research atom as a VKF *candidate* claim (status draft) in the memory bundle's staging/ area, with a transaction record. If a `paper` is given, its PaperCard is created too so the claim's source resolves. This is collect-and-stage — verify_claim promotes it; nothing is trusted yet.",
    parameters: RememberParams,
    async execute(_id, params: Static<typeof RememberParams>, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ claim_id: string; paper_id?: string }>> {
      const root = resolveRoot(ctx);
      const sp = sessionPaths(root);
      requireSession(root);
      const config = readConfig(sp.config)!;
      scaffoldMemoryBundle(root, config.name, config.memoryProfile);

      let paperId: string | undefined;
      if (params.paper) {
        const paper = buildPaperCard({
          title: params.paper.title,
          source_url: params.paper.source_url,
          authors: params.paper.authors,
          year: params.paper.year,
          summary: params.paper.summary ?? "(summary pending)",
          owner: config.owner,
        });
        paperId = paper.id;
        if (!findCard(root, paper.id)) {
          writeCard(root, "staging", paper.file, paper.content);
          writeTransaction(root, {
            action: "created",
            target: paper.id,
            actor: config.owner,
            reason: `Recorded source from literature search: ${params.paper.source_url}`,
            changedFields: [`created ${paper.id} (status: draft)`],
            requiresHumanApproval: false,
          });
        }
      }

      const claim = buildClaimCard({
        title: params.title,
        assertion: params.assertion,
        mechanism: params.mechanism,
        context: params.context,
        implementation_recipe: params.implementation_recipe,
        failure_modes: params.failure_modes,
        paper_id: paperId,
        source_url: params.paper?.source_url,
        recency_score: params.recency_score,
        reliability_score: params.reliability_score,
        expected_value: params.expected_value,
        feasibility: params.feasibility,
        info_gain: params.info_gain,
        implementation_cost: params.implementation_cost,
        origin: params.origin,
        lever: params.lever,
        altitude: params.altitude,
        derived_from: params.derived_from?.filter((id) => findCard(root, id)),
        confidence: params.confidence,
        owner: config.owner,
      });
      if (findCard(root, claim.id)) {
        return textResult(`A claim "${claim.id}" already exists. Use verify_claim to advance it, or pick a more specific title.`, { claim_id: claim.id, paper_id: paperId });
      }
      writeCard(root, "staging", claim.file, claim.content);
      writeTransaction(root, {
        action: "created",
        target: claim.id,
        actor: config.owner,
        reason: `Extracted candidate claim from literature${paperId ? ` (${paperId})` : ""}.`,
        changedFields: [`created ${claim.id} (status: draft)`],
        requiresHumanApproval: false,
      });
      appendLog(sp.log, { event: "remember", claim_id: claim.id, paper_id: paperId });

      writeProgressDashboard(root);
      refreshWidget(ctx, root);
      return textResult(
        [
          `Staged candidate ${claim.id}${paperId ? ` (source ${paperId})` : ""}.`,
          `Confidence: ${confidenceLabel(params.confidence ?? 0.5)} (belief ${(params.confidence ?? 0.5).toFixed(2)}).`,
          validationNote(root, config.memoryProfile),
          "Next: verify_claim to check the citation and codebase fit before building on it.",
        ].join("\n"),
        { claim_id: claim.id, paper_id: paperId },
      );
    },
  });

  // ── verify_claim ───────────────────────────────────────────────────────────
  const DecisionLiterals = [
    Type.Literal("source_verified"),
    Type.Literal("locally_tested"),
    Type.Literal("replicated"),
    Type.Literal("contradicted"),
    Type.Literal("deprecated"),
    Type.Literal("rejected"),
  ];
  const VerifyParams = Type.Object({
    id: Type.String({ description: "VKF id of the claim to act on, e.g. 'claim:adagc'." }),
    decision: Type.Union(DecisionLiterals, { description: "source_verified = citation/source checks out & it's codebase-relevant; locally_tested/replicated = backed by experiment(s); contradicted = an experiment/source disagrees; deprecated = stale/superseded; rejected = retire it." }),
    reason: Type.String({ description: "Why — what you checked. Becomes part of the audit trail." }),
    conflicts_with: Type.Optional(Type.String({ description: "Id of a card this one conflicts with (for 'contradicted')." })),
  });

  const DECISION_MAP: Record<string, { state: MemoryState; verification: Verification }> = {
    source_verified: { state: "source_verified", verification: "verified_by_agent" },
    locally_tested: { state: "locally_tested", verification: "verified_by_local_experiment" },
    replicated: { state: "replicated", verification: "verified_by_independent_reproduction" },
    contradicted: { state: "contradicted", verification: "contradicted_by_local_experiment" },
    deprecated: { state: "deprecated", verification: "verified_by_agent" },
    rejected: { state: "retired", verification: "verified_by_agent" },
  };

  pi.registerTool({
    name: "verify_claim",
    label: "Verify claim",
    description:
      "Advance or downgrade a memory card's trust lifecycle and move it between staging/verified/deprecated, writing a transaction record. Only source_verified and above should drive serious hypotheses; only locally_tested and above should strongly steer experiments.",
    parameters: VerifyParams,
    async execute(_id, params: Static<typeof VerifyParams>, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ id: string; state: MemoryState }>> {
      const root = resolveRoot(ctx);
      const sp = sessionPaths(root);
      requireSession(root);
      const config = readConfig(sp.config)!;

      const card = findCard(root, params.id);
      if (!card) {
        return textResult(`No card "${params.id}" in the memory bundle.`, { id: params.id, state: "candidate" });
      }
      const map = DECISION_MAP[params.decision]!;
      const before = String(card.meta["memory_state"] ?? "candidate");
      transitionCard(root, params.id, map.state, {
        verification: map.verification,
        conflictsWith: params.conflicts_with,
      });
      writeTransaction(root, {
        action: map.state === "retired" || map.state === "contradicted" || map.state === "deprecated" ? "demoted" : "promoted",
        target: params.id,
        actor: config.owner,
        reason: params.reason,
        changedFields: [`memory_state: ${before} → ${map.state}`, `verification: ${map.verification}`],
        requiresHumanApproval: false,
      });
      appendLog(sp.log, { event: "verify", claim_id: params.id, decision: params.decision });

      writeProgressDashboard(root);
      refreshWidget(ctx, root);
      return textResult(
        [
          `${params.id}: ${before} → ${map.state} (${map.verification}).`,
          validationNote(root, config.memoryProfile),
        ].join("\n"),
        { id: params.id, state: map.state },
      );
    },
  });

  // ── recall_memory ──────────────────────────────────────────────────────────
  const RecallParams = Type.Object({
    query: Type.Optional(Type.String({ description: "Free-text focus, matched against titles, assertions, mechanisms and tags. Omit to get the full trusted picture." })),
    limit: Type.Optional(Type.Number({ description: "Max claims to return per group. Default 10." })),
    include_candidates: Type.Optional(Type.Boolean({ description: "Include unverified candidates (status draft). Default true." })),
    scope: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("global"), Type.Literal("both")], { description: "Which memory to search. 'project' (default) = this repo's bundle; 'global' = the cross-project shared bundle; 'both' = include global trusted knowledge learned elsewhere." })),
  });

  pi.registerTool({
    name: "recall_memory",
    label: "Recall memory",
    description:
      "Query the research memory before deciding what to try next. Returns trusted claims to build on, candidate ideas, prior experiments (so you don't repeat them), negative results, and conflicts — following VKF retrieval rules (prefer verified, warn on stale, surface conflicts, cite ids). The loop should pick its next idea from here.",
    parameters: RecallParams,
    async execute(_id, params: Static<typeof RecallParams>, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ trusted: number; candidates: number; experiments: number }>> {
      const root = resolveRoot(ctx);
      const sp = sessionPaths(root);
      requireSession(root);
      const limit = params.limit ?? 10;
      const includeCandidates = params.include_candidates ?? true;

      const q = params.query?.toLowerCase().trim();
      const matches = (c: ReturnType<typeof listCards>[number]): boolean => {
        if (!q) return true;
        const hay = [
          c.meta["title"],
          c.meta["mechanism"],
          c.meta["context"],
          ...(Array.isArray(c.meta["tags"]) ? (c.meta["tags"] as unknown[]) : []),
          c.body,
        ]
          .map((x) => String(x ?? "").toLowerCase())
          .join(" ");
        return hay.includes(q);
      };

      const claims = listCards(root, { type: "claim" }).filter(matches);
      const trusted = claims.filter((c) => isTrustedForHypotheses(c.meta["memory_state"] as MemoryState));
      const candidates = claims.filter((c) => (c.meta["memory_state"] as MemoryState) === "candidate");
      const contradicted = claims.filter((c) => (c.meta["memory_state"] as MemoryState) === "contradicted");
      const experiments = listCards(root, { type: "experiment" }).filter(matches);
      const negatives = experiments.filter((e) => e.meta["outcome"] === "loss");

      const fmtClaim = (c: (typeof claims)[number]): string =>
        `  • ${c.meta["id"]} — ${c.meta["title"]} [${c.meta["memory_state"]}, confidence ${c.meta["confidence"]}]` +
        (c.meta["mechanism"] ? `\n      mechanism: ${c.meta["mechanism"]}` : "");
      const fmtExp = (e: (typeof experiments)[number]): string =>
        `  • ${e.meta["id"]} — ${e.meta["title"]} [${e.meta["outcome"]}, ${e.meta["metric_name"]}=${e.meta["value"]}]`;

      const sections: string[] = [];
      sections.push(`Research memory${q ? ` matching "${params.query}"` : ""}:`);
      sections.push("");
      sections.push(`TRUSTED claims to build on (${trusted.length}):`);
      sections.push(trusted.length ? trusted.slice(0, limit).map(fmtClaim).join("\n") : "  (none yet — verify candidates first)");
      if (includeCandidates) {
        sections.push("");
        sections.push(`CANDIDATE ideas (unverified — verify before trusting) (${candidates.length}):`);
        sections.push(candidates.length ? candidates.slice(0, limit).map(fmtClaim).join("\n") : "  (none)");
      }
      sections.push("");
      sections.push(`ALREADY TRIED — don't repeat (${experiments.length}):`);
      sections.push(experiments.length ? experiments.slice(-limit).map(fmtExp).join("\n") : "  (none)");
      if (negatives.length || contradicted.length) {
        sections.push("");
        sections.push(`NEGATIVE RESULTS / CONFLICTS — avoid unless conditions change (${negatives.length + contradicted.length}):`);
        sections.push([...negatives.slice(0, limit).map(fmtExp), ...contradicted.slice(0, limit).map(fmtClaim)].join("\n"));
      }

      // Global, cross-project memory: trusted knowledge learned in other repos.
      const scope = params.scope ?? "project";
      if ((scope === "global" || scope === "both") && hasGlobalMemory()) {
        const gRoot = globalRoot();
        const globalTrusted = listCards(gRoot, { type: "claim" })
          .filter(matches)
          .filter((c) => isTrustedForHypotheses(c.meta["memory_state"] as MemoryState));
        sections.push("");
        sections.push(`GLOBAL trusted claims (learned in other projects) (${globalTrusted.length}):`);
        sections.push(globalTrusted.length ? globalTrusted.slice(0, limit).map(fmtClaim).join("\n") : "  (none)");
      } else if ((scope === "global" || scope === "both") && !hasGlobalMemory()) {
        sections.push("");
        sections.push("GLOBAL memory: empty (nothing promoted yet — use promote_to_global on replicated wins).");
      }

      // Freshness signal from the real CLI, when available.
      const fresh = vkf.freshness(memoryPaths(root).dir);
      if (fresh.available && fresh.report && typeof fresh.report === "object") {
        const stale = (fresh.report as { stale?: unknown[] }).stale;
        if (Array.isArray(stale) && stale.length) {
          sections.push("");
          sections.push(`⚠ ${stale.length} memory object(s) flagged stale by vkf freshness — re-verify before relying on them.`);
        }
      }

      appendLog(sp.log, { event: "recall", query: params.query, trusted: trusted.length, candidates: candidates.length });
      refreshWidget(ctx, root);
      return textResult(sections.join("\n"), {
        trusted: trusted.length,
        candidates: candidates.length,
        experiments: experiments.length,
      });
    },
  });

  // ── score_ideas ──────────────────────────────────────────────────────────────
  const ScoreParams = Type.Object({
    query: Type.Optional(Type.String({ description: "Restrict to ideas whose text matches this focus." })),
    limit: Type.Optional(Type.Number({ description: "How many ranked ideas to return. Default 8." })),
    include_candidates: Type.Optional(Type.Boolean({ description: "Score unverified candidates too, not just source_verified+ claims. Default true." })),
  });

  pi.registerTool({
    name: "score_ideas",
    label: "Score ideas",
    description:
      "Rank untested ideas in memory by priority = EV × feasibility × evidence × novelty × info_gain × altitude_affinity ÷ cost, where novelty blends lexical distance with *structural* novelty (how under-explored the idea's lever·altitude bucket is). Also returns a budget-balanced shortlist that reserves explore slots for high-altitude bets. Use in the hypothesis loop to pick the next experiment deliberately. The factor breakdown keeps the ranking auditable.",
    parameters: ScoreParams,
    async execute(_id, params: Static<typeof ScoreParams>, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ ranked: number; top?: string }>> {
      const root = resolveRoot(ctx);
      const sp = sessionPaths(root);
      requireSession(root);
      const config = readConfig(sp.config)!;
      const limit = params.limit ?? 8;
      const includeCandidates = params.include_candidates ?? true;

      const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
      const str = (v: unknown): string => String(v ?? "");
      const optStr = (v: unknown): string | undefined => (v == null ? undefined : String(v));

      const q = params.query?.toLowerCase().trim();
      const cardText = (c: ReturnType<typeof listCards>[number]): string =>
        [c.meta["title"], c.meta["mechanism"], c.meta["context"], c.body].map(str).join(" ");

      const claims = listCards(root, { type: "claim" });
      const exploredStates = new Set<MemoryState>(["locally_tested", "replicated", "contradicted"]);
      const untestedStates = new Set<MemoryState>(
        includeCandidates ? ["candidate", "source_verified"] : ["source_verified"],
      );

      // Explored ground: tried experiments + already-settled claims. Experiment
      // cards also give the lever·altitude bucket distribution for structural novelty.
      const experimentCards = listCards(root, { type: "experiment" });
      const explored: string[] = [
        ...experimentCards.map(cardText),
        ...claims.filter((c) => exploredStates.has(c.meta["memory_state"] as MemoryState)).map(cardText),
      ];
      const bucketCounts: Record<string, number> = {};
      for (const e of experimentCards) {
        const key = bucketKey(optStr(e.meta["lever"]), optStr(e.meta["altitude"]));
        bucketCounts[key] = (bucketCounts[key] ?? 0) + 1;
      }
      const staleIds = staleIdSet(root);

      const ideas: IdeaInput[] = claims
        .filter((c) => untestedStates.has(c.meta["memory_state"] as MemoryState))
        .filter((c) => !q || cardText(c).toLowerCase().includes(q))
        .map((c) => ({
          id: str(c.meta["id"]),
          title: str(c.meta["title"]),
          text: cardText(c),
          belief: num(c.meta["belief"]) ?? 0.5,
          verification_level: c.meta["verification_level"] as IdeaInput["verification_level"],
          recency_score: num(c.meta["recency_score"]),
          reliability_score: num(c.meta["reliability_score"]),
          expected_value: num(c.meta["expected_value"]),
          feasibility: num(c.meta["feasibility"]),
          info_gain: num(c.meta["info_gain"]),
          implementation_cost: num(c.meta["implementation_cost"]),
          lever: optStr(c.meta["lever"]),
          altitude: optStr(c.meta["altitude"]),
          stale: staleIds.has(str(c.meta["id"])),
        }));

      if (ideas.length === 0) {
        return textResult(
          "No untested ideas to score. Gather literature (autoresearch-vkf-knowledge-gather) and remember_claim some candidates first.",
          { ranked: 0 },
        );
      }

      const mode = researchMode(config);
      const ranked = rankIdeas(ideas, {
        explored,
        bucketCounts,
        exploredTotal: experimentCards.length,
        altitudePreference: mode.altitudePreference,
      });
      const ideaById = new Map(ideas.map((i) => [i.id, i]));
      const pct = (n: number): string => (n * 100).toFixed(0) + "%";
      const lines = ranked.slice(0, limit).map((r, i) => {
        const f = r.factors;
        return (
          `${i + 1}. [${r.priority.toFixed(2)}] ${r.id} — ${r.title}  (${r.bucket})\n` +
          `     EV ${pct(f.expected_value)} · feas ${pct(f.feasibility)} · evidence ${pct(f.evidence_strength)} · ` +
          `novelty ${pct(f.novelty)} (struct ${pct(f.structural_novelty)}) · info-gain ${pct(f.info_gain)} · ` +
          `altitude×${f.altitude_affinity.toFixed(2)} · cost ${pct(f.implementation_cost)}` +
          (r.max_similarity > 0.5 ? `  ⚠ ${pct(r.max_similarity)} similar to explored/playbook` : "")
        );
      });

      // Budget-balanced shortlist: reserve explore slots so reliable tweaks can't
      // crowd out high-altitude bets (skipped when exploreFraction is 0).
      const k = Math.min(4, ranked.length);
      const picks = selectBalanced(
        ranked.map((r) => ({ r, idea: ideaById.get(r.id)! })),
        { exploreFraction: mode.exploreFraction, k },
      );
      const shortlist = picks.map(
        (p) => `  • [${p.slot}${p.slot === "explore" ? " ⟵ reserved" : ""}] ${p.r.id} — ${p.r.title}  (${p.r.bucket})`,
      );

      appendLog(sp.log, { event: "note", note: "score_ideas", ranked: ranked.length, top: ranked[0]?.id });
      return textResult(
        [
          `Ranked ${ranked.length} untested idea(s) by priority` +
            ` (mode: ${mode.altitudePreference}, explore ${pct(mode.exploreFraction)}):`,
          "",
          ...lines,
          "",
          "Suggested next experiments (budget-balanced):",
          ...shortlist,
          "",
          "Honor the explore quota across the run — a reserved explore pick that opens new ground beats another tweak to a saturated bucket.",
        ].join("\n"),
        { ranked: ranked.length, top: ranked[0]?.id },
      );
    },
  });

  // ── plan_next_step ───────────────────────────────────────────────────────────
  const PlanParams = Type.Object({
    query: Type.Optional(Type.String({ description: "Restrict to ideas whose text matches this focus." })),
    k: Type.Optional(Type.Number({ description: "How many expansion candidates to return. Default 4." })),
    include_candidates: Type.Optional(Type.Boolean({ description: "Consider unverified candidates too, not just source_verified+ claims. Default true." })),
  });

  pi.registerTool({
    name: "plan_next_step",
    label: "Plan next step",
    description:
      "Best-first expansion for the search tree: decide BOTH which experiment node to branch from AND which idea to apply next. Combines score_ideas' idea ranking + the explore/exploit budget with the current tree (build on the best node, or branch to explore). Returns a shortlist of {parent node, idea, move-kind} — pass the chosen parent_id/node_kind to vkf_log_experiment. This replaces guessing what to try next.",
    parameters: PlanParams,
    async execute(_id, params: Static<typeof PlanParams>, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ picks: number; top?: string }>> {
      const root = resolveRoot(ctx);
      const sp = sessionPaths(root);
      requireSession(root);
      const config = readConfig(sp.config)!;
      const includeCandidates = params.include_candidates ?? true;
      const k = params.k ?? 4;

      const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
      const str = (v: unknown): string => String(v ?? "");
      const optStr = (v: unknown): string | undefined => (v == null ? undefined : String(v));
      const q = params.query?.toLowerCase().trim();
      const cardText = (c: ReturnType<typeof listCards>[number]): string =>
        [c.meta["title"], c.meta["mechanism"], c.meta["context"], c.body].map(str).join(" ");

      const claims = listCards(root, { type: "claim" });
      const untestedStates = new Set<MemoryState>(
        includeCandidates ? ["candidate", "source_verified"] : ["source_verified"],
      );
      const exploredStates = new Set<MemoryState>(["locally_tested", "replicated", "contradicted"]);
      const experimentCards = listCards(root, { type: "experiment" });
      const explored: string[] = [
        ...experimentCards.map(cardText),
        ...claims.filter((c) => exploredStates.has(c.meta["memory_state"] as MemoryState)).map(cardText),
      ];
      const bucketCounts: Record<string, number> = {};
      for (const e of experimentCards) {
        const key = bucketKey(optStr(e.meta["lever"]), optStr(e.meta["altitude"]));
        bucketCounts[key] = (bucketCounts[key] ?? 0) + 1;
      }
      const staleIds = staleIdSet(root);

      const ideas: IdeaInput[] = claims
        .filter((c) => untestedStates.has(c.meta["memory_state"] as MemoryState))
        .filter((c) => !q || cardText(c).toLowerCase().includes(q))
        .map((c) => ({
          id: str(c.meta["id"]),
          title: str(c.meta["title"]),
          text: cardText(c),
          belief: num(c.meta["belief"]) ?? 0.5,
          verification_level: c.meta["verification_level"] as IdeaInput["verification_level"],
          recency_score: num(c.meta["recency_score"]),
          reliability_score: num(c.meta["reliability_score"]),
          expected_value: num(c.meta["expected_value"]),
          feasibility: num(c.meta["feasibility"]),
          info_gain: num(c.meta["info_gain"]),
          implementation_cost: num(c.meta["implementation_cost"]),
          lever: optStr(c.meta["lever"]),
          altitude: optStr(c.meta["altitude"]),
          stale: staleIds.has(str(c.meta["id"])),
        }));

      if (ideas.length === 0) {
        return textResult(
          "No untested ideas to expand. Gather literature (autoresearch-vkf-knowledge-gather) and remember_claim some candidates, or synthesize with find_contradictions / find_transfers.",
          { picks: 0 },
        );
      }

      const mode = researchMode(config);
      const ranked = rankIdeas(ideas, {
        explored,
        bucketCounts,
        exploredTotal: experimentCards.length,
        altitudePreference: mode.altitudePreference,
      });
      const ideaById = new Map(ideas.map((i) => [i.id, i]));
      const experiments = readExperiments(sp.experiments);
      const best = bestNode(experiments, config.direction);
      const picks = selectExpansion(
        experiments,
        ranked.map((r) => ({ r, idea: ideaById.get(r.id)! })),
        { direction: config.direction, exploreFraction: mode.exploreFraction, k: Math.min(k, ranked.length) },
      );

      const pct = (n: number): string => (n * 100).toFixed(0) + "%";
      const lines = picks.map((p, i) => {
        const parent = p.parent_id ? `expand ${p.parent_id}` : "draft from scratch";
        return (
          `${i + 1}. [${p.slot}] ${p.node_kind} — ${parent}\n` +
          `     idea ${p.r.id} (${p.r.title})  priority ${p.r.priority.toFixed(2)} · novelty ${pct(p.r.factors.novelty)} · evidence ${pct(p.r.factors.evidence_strength)} (${p.r.bucket})`
        );
      });

      appendLog(sp.log, { event: "note", note: "plan_next_step", picks: picks.length, top: picks[0]?.r.id, parent: picks[0]?.parent_id });
      return textResult(
        [
          `Best node so far: ${best ? `${best.id} (${config.metricName}=${best.value})` : "(none yet — first node will be a draft root)"}.`,
          `Next-step shortlist (mode: ${mode.altitudePreference}, explore ${pct(mode.exploreFraction)}):`,
          "",
          ...lines,
          "",
          "Pick one, implement the smallest falsifying change, run it, then vkf_log_experiment with that parent_id + node_kind. Spend the reserved explore picks across the run — don't collapse onto improve every time.",
          "",
          continuationNote(root, config),
        ].join("\n"),
        { picks: picks.length, top: picks[0]?.r.id },
      );
    },
  });

  // ── set_research_mode ─────────────────────────────────────────────────────────
  const ModeParams = Type.Object({
    explore_fraction: Type.Optional(Type.Number({ description: "Fraction of the experiment budget reserved for exploratory (high-altitude / high-uncertainty) ideas, [0,1]. 0 ⇒ pure priority order (tuning)." })),
    altitude_preference: Type.Optional(Type.Union([Type.Literal("any"), Type.Literal("high"), Type.Literal("tuning")], { description: "Altitude bias: 'any' neutral, 'high' mildly favors mechanism/reframe ideas, 'tuning' favors hyperparameter tweaks." })),
  });

  pi.registerTool({
    name: "set_research_mode",
    label: "Set research mode",
    description:
      "Steer how the loop trades off exploration vs exploitation, mid-run. Set explore_fraction higher to spend more budget on novel high-altitude bets, or switch altitude_preference to 'tuning' when the user explicitly wants hyperparameter tuning. Affects score_ideas going forward.",
    parameters: ModeParams,
    async execute(_id, params: Static<typeof ModeParams>, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ explore_fraction: number; altitude_preference: string }>> {
      const root = resolveRoot(ctx);
      const sp = sessionPaths(root);
      requireSession(root);
      const config = readConfig(sp.config)!;
      const current = researchMode(config); // backfills legacy configs
      config.exploreFraction =
        params.explore_fraction !== undefined
          ? Math.min(1, Math.max(0, params.explore_fraction))
          : current.exploreFraction;
      config.altitudePreference = params.altitude_preference ?? current.altitudePreference;
      writeConfig(sp.config, config);
      appendLog(sp.log, { event: "note", note: "set_research_mode", exploreFraction: config.exploreFraction, altitudePreference: config.altitudePreference });
      return textResult(
        `Research mode: altitude_preference=${config.altitudePreference}, explore_fraction=${(config.exploreFraction * 100).toFixed(0)}%.`,
        { explore_fraction: config.exploreFraction, altitude_preference: config.altitudePreference },
      );
    },
  });

  // ── find_contradictions ──────────────────────────────────────────────────────
  const toCardLike = (c: ReturnType<typeof listCards>[number]): CardLike => {
    const s = (v: unknown): string => String(v ?? "");
    return {
      id: s(c.meta["id"]),
      title: s(c.meta["title"]),
      mechanism: c.meta["mechanism"] ? s(c.meta["mechanism"]) : undefined,
      context: c.meta["context"] ? s(c.meta["context"]) : undefined,
      text: [c.meta["title"], c.meta["context"], c.body].map(s).join(" "),
      memory_state: c.meta["memory_state"] as MemoryState | undefined,
      conflicts_with: Array.isArray(c.meta["conflicts_with"])
        ? (c.meta["conflicts_with"] as unknown[]).map(s)
        : [],
      lever: c.meta["lever"] ? s(c.meta["lever"]) : undefined,
    };
  };

  const ContradictionParams = Type.Object({
    limit: Type.Optional(Type.Number({ description: "Max tensions to return. Default 10." })),
  });
  pi.registerTool({
    name: "find_contradictions",
    label: "Find contradictions",
    description:
      "Mine the memory for tensions between claims — explicit conflicts, the same idea that won here and lost there, and different mechanisms aimed at the same goal. Each tension is a generative question: a seed for a novel hypothesis that resolving it would answer. More likely to produce novelty than retrieving more papers.",
    parameters: ContradictionParams,
    async execute(_id, params: Static<typeof ContradictionParams>, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ tensions: number }>> {
      const root = resolveRoot(ctx);
      requireSession(root);
      const limit = params.limit ?? 10;
      const cards = listCards(root, { type: "claim" }).map(toCardLike);
      const tensions = findContradictions(cards);
      if (tensions.length === 0) {
        return textResult("No contradictions found yet. Gather and verify more claims, or run experiments that settle existing ones.", { tensions: 0 });
      }
      const lines = tensions.slice(0, limit).map((t, i) =>
        `${i + 1}. [${t.kind}] ${t.detail}\n     → ${t.question}`,
      );
      refreshWidget(ctx, root);
      return textResult(
        [
          `Found ${tensions.length} tension(s) — each is a hypothesis seed:`,
          "",
          ...lines,
          "",
          "Turn a promising tension into a hypothesis with remember_claim (origin: 'contradiction', derived_from: the two ids).",
        ].join("\n"),
        { tensions: tensions.length },
      );
    },
  });

  // ── find_transfers ───────────────────────────────────────────────────────────
  const TransferParams = Type.Object({
    problem: Type.String({ description: "The target problem: describe its MECHANISM (what needs controlling/stabilizing/etc.), not keywords. e.g. 'stabilize discrete nonlinear dynamics during gradient training'." }),
    context: Type.Optional(Type.String({ description: "The target domain/context, e.g. 'spiking neural networks'. Used to prefer cross-domain analogies." })),
    limit: Type.Optional(Type.Number({ description: "Max transfer candidates. Default 8." })),
  });

  pi.registerTool({
    name: "find_transfers",
    label: "Find transfers",
    description:
      "Cross-domain mechanism search: find claims whose MECHANISM matches the target problem's structure but come from a DIFFERENT domain. Same how, different where — the source of surprising, novel ideas that keyword search misses. Returns transfer candidates to adapt into the current problem.",
    parameters: TransferParams,
    async execute(_id, params: Static<typeof TransferParams>, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ transfers: number; top?: string }>> {
      const root = resolveRoot(ctx);
      requireSession(root);
      const limit = params.limit ?? 8;
      const target: CardLike = {
        id: "__target__",
        title: "target problem",
        mechanism: params.problem,
        context: params.context ?? "",
        text: `${params.problem} ${params.context ?? ""}`,
      };
      const cards = listCards(root, { type: "claim" }).map(toCardLike);
      const transfers = findTransfers(target, cards);
      if (transfers.length === 0) {
        return textResult("No cross-domain transfer candidates found. Describe the problem by its mechanism, or gather claims from other domains first.", { transfers: 0 });
      }
      const pct = (n: number): string => (n * 100).toFixed(0) + "%";
      const lines = transfers.slice(0, limit).map((t, i) =>
        `${i + 1}. [${t.transfer_score.toFixed(2)}] ${t.from} — ${t.title}\n     mechanism sim ${pct(t.mechanism_similarity)} · context sim ${pct(t.context_similarity)} (lower = more cross-domain)`,
      );
      refreshWidget(ctx, root);
      return textResult(
        [
          `Found ${transfers.length} transfer candidate(s) for: "${params.problem}"`,
          "",
          ...lines,
          "",
          "Adapt a candidate's mechanism into the target with remember_claim (origin: 'transfer', derived_from: the source id).",
        ].join("\n"),
        { transfers: transfers.length, top: transfers[0]?.from },
      );
    },
  });

  // ── find_compositions ────────────────────────────────────────────────────────
  const CompositionParams = Type.Object({
    goal: Type.Optional(Type.String({ description: "Goal text to gauge relevance against. Defaults to the session goal." })),
    limit: Type.Optional(Type.Number({ description: "Max compositions to return. Default 8." })),
  });
  pi.registerTool({
    name: "find_compositions",
    label: "Find compositions",
    description:
      "Combine trusted claims into novel hypotheses: pairs whose mechanisms are complementary (both goal-relevant, low mechanism overlap, different levers preferred). A composition is an idea no single source states — retrieval alone can never propose it. Turn a good one into a claim with remember_claim (origin: 'synthesis', derived_from: both ids).",
    parameters: CompositionParams,
    async execute(_id, params: Static<typeof CompositionParams>, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ compositions: number; top?: string }>> {
      const root = resolveRoot(ctx);
      requireSession(root);
      const config = readConfig(sessionPaths(root).config)!;
      const limit = params.limit ?? 8;
      const cards = listCards(root, { type: "claim" }).map(toCardLike);
      const comps = findCompositions(params.goal ?? config.goal, cards);
      if (comps.length === 0) {
        return textResult(
          "No composable pairs found — compositions need 2+ *trusted* (source_verified+) claims with stated mechanisms. Verify more claims first.",
          { compositions: 0 },
        );
      }
      const pct = (n: number): string => (n * 100).toFixed(0) + "%";
      const lines = comps.slice(0, limit).map((c, i) =>
        `${i + 1}. [${c.score.toFixed(2)}] ${c.a} + ${c.b}\n     ${c.titleA}  ×  ${c.titleB}\n     relevance ${pct(c.goal_relevance)} · mechanism overlap ${pct(c.mechanism_overlap)} (lower = more complementary)`,
      );
      refreshWidget(ctx, root);
      return textResult(
        [
          `Found ${comps.length} composition candidate(s):`,
          "",
          ...lines,
          "",
          "Write the promising ones into memory with remember_claim (origin: 'synthesis', derived_from: [both parent ids]) so they can be scored and tested.",
        ].join("\n"),
        { compositions: comps.length, top: comps[0] ? `${comps[0].a}+${comps[0].b}` : undefined },
      );
    },
  });

  // ── draft_research_plan ──────────────────────────────────────────────────────
  const PlanDraftParams = Type.Object({
    query: Type.Optional(Type.String({ description: "Restrict the plan to ideas matching this focus. Default: everything relevant to the session goal." })),
    limit: Type.Optional(Type.Number({ description: "Max ranked hypotheses in the plan. Default 10." })),
  });
  pi.registerTool({
    name: "draft_research_plan",
    label: "Draft research plan",
    description:
      "Turn the knowledge base into a ranked research plan: the top untested hypotheses (with mechanism, evidence trail, novelty basis, and a proposed falsifying experiment) plus the synthesis opportunities (contradictions to settle, cross-claim compositions). Writes .autoresearch-vkf/session/research_plan.md and returns it. The deliverable of an ideation session; also useful mid-loop to re-plan the agenda.",
    parameters: PlanDraftParams,
    async execute(_id, params: Static<typeof PlanDraftParams>, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ hypotheses: number; path: string }>> {
      const root = resolveRoot(ctx);
      const sp = sessionPaths(root);
      requireSession(root);
      const config = readConfig(sp.config)!;
      const limit = params.limit ?? 10;

      const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
      const str = (v: unknown): string => String(v ?? "");
      const optStr = (v: unknown): string | undefined => (v == null ? undefined : String(v));
      const q = params.query?.toLowerCase().trim();
      const cardText = (c: ReturnType<typeof listCards>[number]): string =>
        [c.meta["title"], c.meta["mechanism"], c.meta["context"], c.body].map(str).join(" ");

      const claims = listCards(root, { type: "claim" });
      const experimentCards = listCards(root, { type: "experiment" });
      const untestedStates = new Set<MemoryState>(["candidate", "source_verified"]);
      const exploredStates = new Set<MemoryState>(["locally_tested", "replicated", "contradicted"]);
      const explored: string[] = [
        ...experimentCards.map(cardText),
        ...claims.filter((c) => exploredStates.has(c.meta["memory_state"] as MemoryState)).map(cardText),
      ];
      const bucketCounts: Record<string, number> = {};
      for (const e of experimentCards) {
        const key = bucketKey(optStr(e.meta["lever"]), optStr(e.meta["altitude"]));
        bucketCounts[key] = (bucketCounts[key] ?? 0) + 1;
      }
      const staleIds = staleIdSet(root);
      const claimById = new Map(claims.map((c) => [str(c.meta["id"]), c]));

      const ideas: IdeaInput[] = claims
        .filter((c) => untestedStates.has(c.meta["memory_state"] as MemoryState))
        .filter((c) => !q || cardText(c).toLowerCase().includes(q))
        .map((c) => ({
          id: str(c.meta["id"]),
          title: str(c.meta["title"]),
          text: cardText(c),
          belief: num(c.meta["belief"]) ?? 0.5,
          verification_level: c.meta["verification_level"] as IdeaInput["verification_level"],
          recency_score: num(c.meta["recency_score"]),
          reliability_score: num(c.meta["reliability_score"]),
          expected_value: num(c.meta["expected_value"]),
          feasibility: num(c.meta["feasibility"]),
          info_gain: num(c.meta["info_gain"]),
          implementation_cost: num(c.meta["implementation_cost"]),
          lever: optStr(c.meta["lever"]),
          altitude: optStr(c.meta["altitude"]),
          stale: staleIds.has(str(c.meta["id"])),
        }));

      const mode = researchMode(config);
      const ranked = rankIdeas(ideas, {
        explored,
        bucketCounts,
        exploredTotal: experimentCards.length,
        altitudePreference: mode.altitudePreference,
      }).slice(0, limit);

      const cardLikes = claims.map(toCardLike);
      const tensions = findContradictions(cardLikes).slice(0, 6);
      const comps = findCompositions(config.goal, cardLikes).slice(0, 6);

      const pct = (n: number): string => (n * 100).toFixed(0) + "%";
      const hypothesisBlock = (r: (typeof ranked)[number], i: number): string => {
        const c = claimById.get(r.id);
        const mech = optStr(c?.meta["mechanism"]);
        const recipe = optStr(c?.meta["implementation_recipe"]);
        const state = optStr(c?.meta["memory_state"]) ?? "candidate";
        const sources = (Array.isArray(c?.meta["depends_on"]) ? (c!.meta["depends_on"] as unknown[]) : [])
          .map(String)
          .filter((d) => d.startsWith("paper:"));
        return [
          `### ${i + 1}. ${r.title}`,
          "",
          `- **id:** \`${r.id}\` (${state}${sources.length ? `, sources: ${sources.join(", ")}` : ""})`,
          `- **priority:** ${r.priority.toFixed(2)} — EV ${pct(r.factors.expected_value)} · feasibility ${pct(r.factors.feasibility)} · evidence ${pct(r.factors.evidence_strength)} · novelty ${pct(r.factors.novelty)} · info-gain ${pct(r.factors.info_gain)}`,
          ...(mech ? [`- **mechanism:** ${mech}`] : []),
          `- **novelty basis:** ${r.factors.structural_novelty > 0.6 ? "opens an under-explored" : "extends the"} \`${r.bucket}\` bucket${r.max_similarity > 0.5 ? ` (⚠ ${pct(r.max_similarity)} similar to explored work)` : ""}`,
          `- **proposed experiment:** ${recipe ?? "define the smallest falsifying change and a METRIC to judge it by"}`,
        ].join("\n");
      };

      const planLines: string[] = [
        `# Research plan — ${config.name}`,
        "",
        `**Goal:** ${config.goal}`,
        "",
        `_Generated ${new Date().toISOString()} from ${claims.length} claim(s), ${experimentCards.length} experiment(s) in memory. Mode: ${mode.altitudePreference}, explore ${pct(mode.exploreFraction)}._`,
        "",
        "## Ranked hypotheses",
        "",
        ...(ranked.length ? ranked.map((r, i) => hypothesisBlock(r, i) + "\n") : ["(no untested ideas in memory — gather and verify claims first)", ""]),
        "## Tensions to settle (each is a hypothesis seed)",
        "",
        ...(tensions.length ? tensions.map((t, i) => `${i + 1}. [${t.kind}] ${t.detail}\n   → ${t.question}`) : ["(none found)"]),
        "",
        "## Composition opportunities (novel combinations)",
        "",
        ...(comps.length ? comps.map((c, i) => `${i + 1}. \`${c.a}\` + \`${c.b}\` — ${c.titleA} × ${c.titleB} (score ${c.score.toFixed(2)})`) : ["(none — need 2+ trusted claims with mechanisms)"]),
        "",
        "## Next actions",
        "",
        "- Turn the strongest tension/composition into a claim: `remember_claim` (origin: contradiction/synthesis, derived_from set).",
        "- Verify top candidates (`verify_claim`) so they can drive experiments.",
        ...(sessionMode(config) === "optimize"
          ? ["- Test the #1 hypothesis: `plan_next_step` → implement → `vkf_run_experiment` → `vkf_log_experiment`."]
          : ["- When a measurable target exists, start an optimize session to test the top hypotheses."]),
      ];
      const plan = planLines.join("\n") + "\n";
      writeFileSync(sp.researchPlan, plan, "utf8");
      appendLog(sp.log, { event: "note", note: "draft_research_plan", hypotheses: ranked.length });
      writeProgressDashboard(root);
      refreshWidget(ctx, root);
      return textResult(
        truncate(plan) + `\n\nSaved to ${sp.researchPlan}.`,
        { hypotheses: ranked.length, path: sp.researchPlan },
      );
    },
  });

  // ── vkf_run_experiment ───────────────────────────────────────────────────────
  const RunParams = Type.Object({
    command: Type.Optional(Type.String({ description: "Command to run (via `bash -lc`). Defaults to the session's configured command." })),
    claim_id: Type.Optional(Type.String({ description: "The claim/idea this run is testing, for logging." })),
    timeout: Type.Optional(Type.Number({ description: "Timeout in milliseconds. Omit for none." })),
    cwd: Type.Optional(Type.String({ description: "Working directory. Defaults to the session working directory." })),
  });

  pi.registerTool({
    name: "vkf_run_experiment",
    label: "Run experiment",
    description:
      "Run the measurement command and capture its output and any `METRIC name=number` lines. Does not judge or record an outcome — read the metric, then record it with vkf_log_experiment.",
    parameters: RunParams,
    async execute(_id, params: Static<typeof RunParams>, signal, _onUpdate, ctx): Promise<AgentToolResult<{ code: number; metrics: Record<string, number> }>> {
      const root = resolveRoot(ctx);
      const sp = sessionPaths(root);
      requireSession(root);
      const config = readConfig(sp.config)!;
      if (existsSync(sp.stop)) {
        return textResult(
          `⏸ Not running: the user requested a stop (${sp.stop} exists). Halt the loop, report with autoresearch-vkf-research-report, and wait. Deleting the file resumes the loop.`,
          { code: -1, metrics: {} },
        );
      }
      const command = params.command ?? config.command;
      if (!command.trim()) {
        return textResult(
          "This is an ideation session — no measure command is configured. The deliverable is a research plan (draft_research_plan). To start experimenting, give init_research (in a fresh workspace) or the session config a measure command.",
          { code: -1, metrics: {} },
        );
      }
      const cwd = params.cwd ?? config.workingDir ?? root;

      const started = Date.now();
      const result = await pi.exec("bash", ["-lc", command], { cwd, timeout: params.timeout, signal: signal ?? undefined });
      const durationMs = Date.now() - started;
      const metrics = parseMetrics(result.stdout + "\n" + result.stderr);

      appendLog(sp.log, { event: "run", claim_id: params.claim_id, command, cwd, code: result.code, killed: result.killed, durationMs, metrics });

      const metricLine =
        Object.keys(metrics).length > 0
          ? Object.entries(metrics).map(([k, v]) => `${k}=${v}`).join("  ")
          : "(no METRIC lines found — print `METRIC " + config.metricName + "=<value>`)";
      const body = [
        `$ ${command}`,
        `(cwd: ${cwd} · exit ${result.code}${result.killed ? " · killed/timeout" : ""} · ${durationMs}ms)`,
        `metrics: ${metricLine}`,
        "",
        "── stdout ──",
        truncate(result.stdout || "(empty)"),
        "── stderr ──",
        truncate(result.stderr || "(empty)"),
      ].join("\n");
      return { content: [{ type: "text", text: body }], details: { code: result.code, metrics } };
    },
  });

  // ── vkf_log_experiment ───────────────────────────────────────────────────────
  const LogParams = Type.Object({
    description: Type.String({ description: "What was changed in this experiment, in words." }),
    value: Type.Number({ description: "The metric value obtained." }),
    claim_id: Type.Optional(Type.String({ description: "The claim/idea this tested (a VKF id). Updates that claim's belief and lifecycle." })),
    parent_id: Type.Optional(Type.String({ description: "The experiment node this one branched from (a prior 'exp-NNN' id). Defaults to the best node so far. Outcome is judged against this parent's value — that's what makes the search a tree, not a flat line. Use plan_next_step to choose it." })),
    node_kind: Type.Optional(Type.Union([Type.Literal("draft"), Type.Literal("improve"), Type.Literal("debug"), Type.Literal("branch")], { description: "What kind of move this is: draft (from scratch), improve (build on parent), debug (fix a broken parent), branch (explore an alternative). Defaults from plan_next_step." })),
    baseline: Type.Optional(Type.Number({ description: "Override the comparison baseline. Defaults to the parent node's value (the tree baseline), then the session baseline." })),
    outcome: Type.Optional(Type.Union([Type.Literal("win"), Type.Literal("loss"), Type.Literal("inconclusive")], { description: "Override the derived outcome. Normally leave unset — it's derived from value vs the parent-node baseline and metric direction." })),
    kept: Type.Optional(Type.Boolean({ description: "Whether the change was kept (vs reverted)." })),
    conditions: Type.Optional(Type.String({ description: "Conditions under which this holds (model size, dataset, etc.) — recorded on the memory card." })),
    notes: Type.Optional(Type.String({ description: "Deviations, surprises, next tests." })),
    next_suggestions: Type.Optional(Type.Array(Type.String(), { description: "Structured next-step ideas this result suggests (RD-Agent-style feedback). Recorded on the experiment card to seed the next iteration." })),
    commit: Type.Optional(Type.String({ description: "Git commit capturing the change, if any. Defaults to the current HEAD of the working dir." })),
    metrics: Type.Optional(Type.Record(Type.String(), Type.Number(), { description: "All `METRIC name=value` pairs from the run (from vkf_run_experiment), so the dashboard can show every metric — not just the primary one." })),
  });

  pi.registerTool({
    name: "vkf_log_experiment",
    label: "Log experiment",
    description:
      "Record an experiment's result as a node in the search tree. Appends to the session log AND writes an experiment card back to the VKF memory (a win OR a loss is durable knowledge) with a profile-2 reproduction block, updating the tested claim's belief (from accumulated evidence) and lifecycle. The node branches from parent_id (default: the best node so far) and is judged against the parent's value. This write-back is what lets future runs avoid repeating work and lets the loop backtrack.",
    parameters: LogParams,
    async execute(_id, params: Static<typeof LogParams>, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ outcome: Outcome; experiment_id: string }>> {
      const root = resolveRoot(ctx);
      const sp = sessionPaths(root);
      requireSession(root);
      const config = readConfig(sp.config)!;

      const experiments = readExperiments(sp.experiments);

      // Resolve the parent node in the search tree. Default to the best node so
      // far, so the loop builds on what works unless the agent branches elsewhere.
      const best = bestNode(experiments, config.direction);
      const parentId =
        params.parent_id && experiments.some((e) => e.id === params.parent_id)
          ? params.parent_id
          : best?.id;
      // Judge against the parent node's value (the tree baseline), not a single
      // global scalar — that's what makes a branch's outcome attributable.
      const baseline = params.baseline ?? nodeBaseline(experiments, parentId, config.baseline);
      const outcome: Outcome = params.outcome ?? deriveOutcome(baseline, params.value, config.direction);
      const parentDepth = parentId ? (depths(experiments).get(parentId) ?? 0) : -1;
      const nodeKind: NodeKind = params.node_kind ?? (parentId ? "improve" : "draft");

      // Record every metric (primary included).
      const metrics = { ...(params.metrics ?? {}) };
      if (metrics[config.metricName] === undefined) metrics[config.metricName] = params.value;

      // Inherit lever/altitude from the tested claim so coverage reflects what we ran.
      const testedClaim = params.claim_id ? findCard(root, params.claim_id) : undefined;
      const lever = testedClaim?.meta["lever"] as string | undefined;
      const altitude = testedClaim?.meta["altitude"] as string | undefined;

      const seq = String(experiments.length + 1).padStart(3, "0");
      const expId = `exp-${seq}`;

      // Snapshot the change onto a per-idea branch (`autoresearch-vkf-<idea>`) so a
      // reverted regression is never lost and each node links to an exact commit.
      // Non-destructive: HEAD/index/working tree are untouched (see git.ts). Falls
      // back to the explicit `commit` param (or HEAD) when there's nothing to
      // snapshot or the working dir isn't a git repo.
      const cwd = config.workingDir ?? root;
      const branch = branchNameForIdea(params.claim_id ?? params.description);
      const message = `[autoresearch] ${expId} · ${outcome}: ${params.description}`.slice(0, 200);
      const snap = snapshotToBranch(cwd, branch, message, { name: config.owner });
      const commit = snap?.short ?? shortCommit(params.commit, cwd);
      const commitUrl = snap ? remoteCommitUrl(cwd, snap.full) : undefined;

      const expEntry: Experiment = {
        id: expId,
        description: params.description,
        claim_id: params.claim_id,
        parent_id: parentId,
        node_kind: nodeKind,
        depth: parentDepth + 1,
        value: params.value,
        metrics,
        commit,
        branch: snap?.branch,
        commit_url: commitUrl,
        lever,
        altitude,
        baseline,
        outcome,
        kept: params.kept,
        notes: params.notes,
        ts: new Date().toISOString(),
      };

      // Write-back: durable experiment card in the memory bundle, with a profile-2
      // reproduction block (the measure command + expected value) and tree edges.
      const parentCard = parentId
        ? experiments.find((e) => e.id === parentId)?.memory_card
        : undefined;
      const card = buildExperimentCard({
        title: params.description.slice(0, 70),
        hypothesis: params.claim_id ? `Testing ${params.claim_id}: ${params.description}` : params.description,
        claim_id: params.claim_id && findCard(root, params.claim_id) ? params.claim_id : undefined,
        parent_id: parentCard,
        node_kind: nodeKind,
        metric_name: config.metricName,
        baseline,
        value: params.value,
        outcome: outcome === "pending" ? "inconclusive" : outcome,
        conditions: params.conditions,
        notes: params.notes,
        next_suggestions: params.next_suggestions,
        reproduction: { command: config.command, metric_name: config.metricName, value: params.value },
        commit: snap?.full ?? params.commit,
        lever: lever as Parameters<typeof buildExperimentCard>[0]["lever"],
        altitude: altitude as Parameters<typeof buildExperimentCard>[0]["altitude"],
        owner: config.owner,
      });
      writeCard(root, "verified", card.file, card.content);
      expEntry.memory_card = card.id;
      writeTransaction(root, {
        action: "created",
        target: card.id,
        actor: config.owner,
        reason: `Experiment result (${outcome}) for ${config.metricName}=${params.value}.`,
        changedFields: [`created ${card.id} (status: verified)`],
        requiresHumanApproval: false,
      });

      // Belief + lifecycle update on the tested claim, from accumulated evidence
      // (win/loss tally) rather than nudging a scalar — repeated tests compound.
      let beliefNote = "";
      if (params.claim_id) {
        const claim = findCard(root, params.claim_id);
        if (claim) {
          const prev = typeof claim.meta["belief"] === "number" ? (claim.meta["belief"] as number) : 0.5;
          let wins = typeof claim.meta["evidence_wins"] === "number" ? (claim.meta["evidence_wins"] as number) : 0;
          let losses = typeof claim.meta["evidence_losses"] === "number" ? (claim.meta["evidence_losses"] as number) : 0;
          if (outcome === "win") wins += 1;
          else if (outcome === "loss") losses += 1;
          const next = beliefFromEvidence(wins, losses, prev);
          const newState: MemoryState =
            outcome === "win"
              ? "locally_tested"
              : outcome === "loss" && next < 0.2
                ? "contradicted"
                : (claim.meta["memory_state"] as MemoryState);
          transitionCard(root, params.claim_id, newState, {
            verification: outcome === "loss" ? "contradicted_by_local_experiment" : "verified_by_local_experiment",
            confidence: next,
            evidence: { wins, losses },
          });
          writeTransaction(root, {
            action: outcome === "win" ? "promoted" : "updated",
            target: params.claim_id,
            actor: config.owner,
            reason: `Belief updated by ${card.id} (${outcome}); evidence now ${wins}W/${losses}L.`,
            changedFields: [`belief: ${prev.toFixed(2)} → ${next.toFixed(2)}`, `memory_state → ${newState}`],
          });
          beliefNote = `Claim ${params.claim_id}: belief ${prev.toFixed(2)} → ${next.toFixed(2)} (${confidenceLabel(next)}, ${wins}W/${losses}L), state → ${newState}.`;
        }
      }

      writeExperiments(sp.experiments, appendExperiment(experiments, expEntry));
      appendLog(sp.log, { event: "result", experiment_id: expEntry.id, claim_id: params.claim_id, value: params.value, baseline, outcome, kept: params.kept });

      // Keep the running baseline at the best kept value.
      if (params.kept && outcome === "win") {
        config.baseline = params.value;
        writeConfig(sp.config, config);
      } else if (config.baseline === undefined) {
        config.baseline = params.value;
        writeConfig(sp.config, config);
      }

      // Refresh the browser progress page so an open tab tracks the loop live.
      writeProgressDashboard(root);
      refreshWidget(ctx, root);
      const summary = summarize(readExperiments(sp.experiments), config.direction);
      return textResult(
        [
          `${expEntry.id}: ${outcome} (${config.metricName}=${params.value}${baseline !== undefined ? `, baseline ${baseline}` : ""}).`,
          `Wrote ${card.id} to memory.`,
          snap
            ? `Snapshotted change to branch ${snap.branch} @ ${snap.short}${commitUrl ? ` — ${commitUrl}` : ""}.`
            : "",
          beliefNote,
          validationNote(root, config.memoryProfile),
          `Session: ${summary.win} win / ${summary.loss} loss / ${summary.inconclusive} inconclusive (best ${config.metricName}: ${summary.best ?? "—"}).`,
          continuationNote(root, config),
        ]
          .filter(Boolean)
          .join("\n"),
        { outcome, experiment_id: expEntry.id },
      );
    },
  });

  // ── promote_to_global ──────────────────────────────────────────────────────
  const PromoteParams = Type.Object({
    id: Type.String({ description: "VKF id of a trusted card to promote to the global, cross-project memory." }),
    reason: Type.Optional(Type.String({ description: "Why this is worth sharing across projects." })),
  });

  pi.registerTool({
    name: "promote_to_global",
    label: "Promote to global",
    description:
      "Copy a trusted card (source_verified, locally_tested, or replicated) from this project's memory into the global, cross-project bundle, so future runs in other repos can recall it. Only durable, verified knowledge should be promoted. Writes a transaction in the global bundle.",
    parameters: PromoteParams,
    async execute(_id, params: Static<typeof PromoteParams>, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ promoted: boolean }>> {
      const root = resolveRoot(ctx);
      const sp = sessionPaths(root);
      requireSession(root);
      const config = readConfig(sp.config)!;

      const card = findCard(root, params.id);
      if (!card) return textResult(`No card "${params.id}" in this project's memory.`, { promoted: false });
      const state = card.meta["memory_state"] as MemoryState;
      if (!isTrustedForHypotheses(state)) {
        return textResult(
          `${params.id} is "${state}" — only source_verified / locally_tested / replicated cards may be promoted. Verify or test it first.`,
          { promoted: false },
        );
      }

      const gRoot = globalRoot();
      scaffoldMemoryBundle(gRoot, "global", config.memoryProfile);
      if (findCard(gRoot, params.id)) {
        return textResult(`${params.id} is already in global memory.`, { promoted: false });
      }
      const content = readFileSync(card.path, "utf8");
      writeCard(gRoot, "verified", basename(card.path), content);
      writeTransaction(gRoot, {
        action: "promoted",
        target: params.id,
        actor: config.owner,
        reason: params.reason ?? `Promoted from project "${config.name}" (${state}).`,
        changedFields: [`copied ${params.id} into global memory (from project ${config.name})`],
      });
      appendLog(sp.log, { event: "note", note: "promote_to_global", claim_id: params.id });

      const gv = validationNote(gRoot, config.memoryProfile);
      return textResult(
        [`Promoted ${params.id} (${state}) to global memory at ${memoryPaths(gRoot).dir}.`, gv].join("\n"),
        { promoted: true },
      );
    },
  });

  // ── export_dashboard ─────────────────────────────────────────────────────────
  const ExportParams = Type.Object({
    refresh_seconds: Type.Optional(Type.Number({ description: "Auto-refresh interval for the progress page, in seconds (0 disables). Default 5 — handy to keep a browser tab live while the loop runs." })),
    open: Type.Optional(Type.Boolean({ description: "Best-effort open the progress page in the default browser after writing. Default false." })),
  });

  pi.registerTool({
    name: "export_dashboard",
    label: "Export dashboard",
    description:
      "Build the interactive idea-lineage graph (.autoresearch-vkf/session/dashboard.html — paper → claim → experiment, via the vkf CLI) and refresh the progress page. The progress page (progress.html — metric-over-time chart, experiment timeline, memory lifecycle) is also written automatically on init and after each remember/verify/experiment, and meta-refreshes itself, so an open browser tab tracks the loop live without re-running this. Use this tool for the lineage graph, a custom refresh interval, or to open the page in a browser.",
    parameters: ExportParams,
    async execute(_id, params: Static<typeof ExportParams>, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ progress: string; lineage?: string }>> {
      const root = resolveRoot(ctx);
      const sp = sessionPaths(root);
      requireSession(root);
      const config = readConfig(sp.config)!;

      // Progress page (self-contained, no CLI needed). Same generator the loop
      // calls automatically on init and after each experiment. Include the typed
      // graph here since this is the explicit, heavier export path.
      writeProgressDashboard(root, params.refresh_seconds, true);

      // Lineage graph via the vkf CLI (best-effort).
      const lineage = vkf.html(memoryPaths(root).dir, sp.dashboardHtml, `Research memory — ${config.name}`);
      const lineageLine = lineage.available
        ? lineage.ok
          ? `Lineage graph: ${sp.dashboardHtml}`
          : `Lineage graph skipped (vkf html failed: ${lineage.raw.trim().split("\n")[0] ?? "unknown error"}).`
        : "Lineage graph skipped (vkf CLI not found — install it for the idea-lineage view).";

      if (params.open) {
        const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        try {
          await pi.exec("bash", ["-lc", `${opener} ${JSON.stringify(sp.progressHtml)} >/dev/null 2>&1 || true`], { cwd: root });
        } catch {
          // best-effort only
        }
      }

      appendLog(sp.log, { event: "note", note: "export_dashboard" });
      return textResult(
        [
          `Progress dashboard: ${sp.progressHtml}`,
          lineageLine,
          "",
          `Open the progress page in a browser to watch the run live:  open ${sp.progressHtml}`,
        ].join("\n"),
        { progress: sp.progressHtml, lineage: lineage.ok ? sp.dashboardHtml : undefined },
      );
    },
  });

  // ── research_status ──────────────────────────────────────────────────────────
  pi.registerTool({
    name: "research_status",
    label: "Research status",
    description: "Show the current loop status: session experiments and the research-memory lifecycle.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ ok: boolean }>> {
      const root = resolveRoot(ctx);
      requireSession(root);
      refreshWidget(ctx, root);
      return textResult(buildFullscreenLines(root).join("\n"), { ok: true });
    },
  });

  // ── research_graph ───────────────────────────────────────────────────────────
  const GraphParams = Type.Object({
    limit: Type.Optional(Type.Number({ description: "Max nodes/edges to list. Default 40." })),
  });
  pi.registerTool({
    name: "research_graph",
    label: "Research graph",
    description:
      "Return the typed knowledge graph of the memory bundle from `vkf graph` — nodes (papers, claims, experiments) and edges (depends_on, conflicts_with, the experiment search tree). Use it to trace lineage (which paper/claim a result came from), find orphaned or conflicting cards, and see the shape of the search. Degrades cleanly when the vkf CLI is absent.",
    parameters: GraphParams,
    async execute(_id, params: Static<typeof GraphParams>, _signal, _onUpdate, ctx): Promise<AgentToolResult<{ available: boolean; nodes: number; edges: number }>> {
      const root = resolveRoot(ctx);
      requireSession(root);
      const limit = params.limit ?? 40;
      const g = vkf.graph(memoryPaths(root).dir);
      if (!g.available) {
        return textResult(
          "vkf CLI not found — the typed graph is unavailable. Set $PI_AUTORESEARCH_VKF or install the VKF env. (Memory still works; recall_memory and the dashboard's search tree don't need the CLI.)",
          { available: false, nodes: 0, edges: 0 },
        );
      }
      const idOf = (n: unknown): string =>
        typeof n === "string" ? n : n && typeof n === "object" ? String((n as { id?: unknown }).id ?? JSON.stringify(n)) : String(n);
      const edgeStr = (e: unknown): string => {
        if (e && typeof e === "object") {
          const o = e as { source?: unknown; target?: unknown; from?: unknown; to?: unknown; type?: unknown; rel?: unknown };
          const a = o.source ?? o.from;
          const b = o.target ?? o.to;
          const rel = o.type ?? o.rel;
          return `${idOf(a)} ──${rel ? String(rel) : ""}──▶ ${idOf(b)}`;
        }
        return String(e);
      };
      const nodeLines = g.nodes.slice(0, limit).map((n) => `  • ${idOf(n)}`);
      const edgeLines = g.edges.slice(0, limit).map((e) => `  • ${edgeStr(e)}`);
      return textResult(
        [
          `Knowledge graph: ${g.nodes.length} node(s), ${g.edges.length} edge(s).`,
          "",
          "NODES:",
          ...(nodeLines.length ? nodeLines : ["  (none)"]),
          "",
          "EDGES:",
          ...(edgeLines.length ? edgeLines : ["  (none)"]),
        ].join("\n"),
        { available: true, nodes: g.nodes.length, edges: g.edges.length },
      );
    },
  });

  // ── WebSearch ────────────────────────────────────────────────────────────────
  // The pi host ships no web tools, but the gather skill needs them. These two
  // tools give the agent keyless web access: WebSearch (DuckDuckGo HTML) to
  // discover sources, WebFetch to read pages and hit free APIs (arXiv, OpenAlex,
  // Crossref, Semantic Scholar). Named to match the skill text and pi-ai's
  // Claude-Code tool-name table so prompt caching stays aligned.
  const WebSearchParams = Type.Object({
    query: Type.String({ description: "Search query. Prefer the mechanism of the problem over bare keywords." }),
    max_results: Type.Optional(Type.Number({ description: "Max results to return (default 8, capped at 25)." })),
  });

  pi.registerTool({
    name: "WebSearch",
    label: "Web search",
    description:
      "Search the web with no API key (via DuckDuckGo) and return result titles, URLs, and snippets. Discovery step for the autoresearch gather skill — then read the hits with WebFetch.",
    parameters: WebSearchParams,
    async execute(_id, params: Static<typeof WebSearchParams>, signal): Promise<AgentToolResult<{ results: WebSearchHit[] }>> {
      const limit = Math.max(1, Math.min(params.max_results ?? 8, 25));
      const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`;
      let fetched: FetchedText;
      try {
        fetched = await fetchText(endpoint, signal ?? undefined, 20_000);
      } catch (e) {
        return textResult(`Web search failed: ${(e as Error).message}`, { results: [] });
      }
      const results = parseDdgResults(fetched.body, limit);
      if (results.length === 0) {
        return textResult(
          `No results parsed for "${params.query}" (HTTP ${fetched.status}). The search backend may be rate-limiting; fall back to WebFetch against a known API (arXiv, OpenAlex, Crossref, Semantic Scholar).`,
          { results: [] },
        );
      }
      const body = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
      return textResult(truncate(body), { results });
    },
  });

  // ── WebFetch ─────────────────────────────────────────────────────────────────
  const WebFetchParams = Type.Object({
    url: Type.String({ description: "http(s) URL to fetch. JSON/text is returned verbatim; HTML is reduced to readable text." }),
    max_chars: Type.Optional(Type.Number({ description: `Max characters of content to return (default ${MAX_OUTPUT_CHARS}).` })),
  });

  pi.registerTool({
    name: "WebFetch",
    label: "Web fetch",
    description:
      "Fetch a URL with no API key — JSON/text verbatim, HTML reduced to readable text. Use for the free literature APIs (arXiv, OpenAlex, Crossref, Semantic Scholar) and for reading pages found via WebSearch.",
    parameters: WebFetchParams,
    async execute(_id, params: Static<typeof WebFetchParams>, signal): Promise<AgentToolResult<{ status: number; url: string; content_type: string }>> {
      if (!/^https?:\/\//i.test(params.url)) {
        return textResult(`Refusing to fetch non-http(s) URL: ${params.url}`, { status: 0, url: params.url, content_type: "" });
      }
      let fetched: FetchedText;
      try {
        fetched = await fetchText(params.url, signal ?? undefined, 30_000);
      } catch (e) {
        return textResult(`Fetch failed for ${params.url}: ${(e as Error).message}`, { status: 0, url: params.url, content_type: "" });
      }
      const isHtml = /text\/html|application\/xhtml/i.test(fetched.contentType);
      const text = isHtml ? htmlToText(fetched.body) : fetched.body;
      const cap = Math.max(500, params.max_chars ?? MAX_OUTPUT_CHARS);
      const capped = text.length <= cap ? text : text.slice(0, cap) + `\n…[truncated ${text.length - cap} chars]`;
      const header = `GET ${fetched.finalUrl}\n(HTTP ${fetched.status} · ${fetched.contentType || "unknown"} · ${isHtml ? "html→text" : "raw"})\n\n`;
      return textResult(header + capped, { status: fetched.status, url: fetched.finalUrl, content_type: fetched.contentType });
    },
  });

  // ── shortcut: fullscreen dashboard ───────────────────────────────────────────
  const shortcuts = loadShortcuts();
  if (shortcuts.fullscreenDashboard) {
    pi.registerShortcut(shortcuts.fullscreenDashboard, {
      description: "Fullscreen pi-autoresearch-vkf dashboard",
      handler: async (ctx) => {
        if (!ctx.hasUI) return;
        const root = resolveRoot(ctx);
        await ctx.ui.custom<void>((tui, _theme, _kb, done) => {
          let lines = buildFullscreenLines(root);
          const refresh = (): void => {
            lines = buildFullscreenLines(root);
          };
          // Re-read the session from disk on a timer and ask the TUI to redraw, so
          // the overlay tracks agent progress live while it's open (tool calls
          // write the session files between renders). Cleared on close.
          const timer = setInterval(() => {
            refresh();
            tui.requestRender();
          }, 1000);
          return {
            // Truncate to the viewport width — pi crashes the render if any line
            // overflows. truncateToWidth is ANSI-aware, so our color codes are
            // measured/clipped correctly.
            render: (width: number) => lines.map((l) => truncateToWidth(l, width)),
            invalidate: refresh,
            handleInput: () => done(),
            dispose: () => clearInterval(timer),
          };
        });
      },
    });
  }

  // ── open the live progress page in the default browser ───────────────────────
  const openProgress = async (ctx: ExtensionContext): Promise<void> => {
    const root = resolveRoot(ctx);
    if (!hasSession(root)) {
      if (ctx.hasUI) ctx.ui.notify("No pi-autoresearch-vkf session in this directory yet.", "warning");
      return;
    }
    // Make sure the file exists/is current before handing it to the browser.
    const file = writeProgressDashboard(root);
    if (!file) {
      if (ctx.hasUI) ctx.ui.notify("Could not generate the progress page.", "error");
      return;
    }
    const [cmd, args] = browserOpenCommand(file);
    try {
      await pi.exec(cmd, args, { timeout: 10_000 });
      if (ctx.hasUI) ctx.ui.notify(`Opened progress page in your browser (${cmd}).`, "info");
    } catch (e) {
      if (ctx.hasUI) ctx.ui.notify(`Couldn't launch a browser — open ${file} manually. (${(e as Error).message})`, "error");
    }
  };

  if (shortcuts.openBrowser) {
    pi.registerShortcut(shortcuts.openBrowser, {
      description: "Open the pi-autoresearch-vkf progress page in the browser",
      handler: openProgress,
    });
  }

  pi.registerCommand("research-open", {
    description: "Open the pi-autoresearch-vkf progress page in your browser",
    handler: async (_args, ctx) => {
      await openProgress(ctx);
    },
  });

  // ── lifecycle ────────────────────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    refreshWidget(ctx, resolveRoot(ctx));
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
    runtimeStore.drop(sessionKey(ctx));
  });
}

// ── web helpers ───────────────────────────────────────────────────────────────

const WEB_USER_AGENT = "pi-autoresearch-vkf (+https://github.com/EricJahns/pi-autoresearch-vkf)";

interface FetchedText {
  status: number;
  contentType: string;
  body: string;
  finalUrl: string;
}

interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** Fetch a URL as text, following redirects, aborting on the tool signal or timeout. */
async function fetchText(url: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<FetchedText> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const res = await fetch(url, {
    redirect: "follow",
    signal: composed,
    headers: { "user-agent": WEB_USER_AGENT, accept: "*/*" },
  });
  const body = await res.text();
  return { status: res.status, contentType: res.headers.get("content-type") ?? "", body, finalUrl: res.url || url };
}

/** Reduce an HTML document to readable plain text (best-effort, no DOM). */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** DuckDuckGo HTML wraps result links as //duckduckgo.com/l/?uddg=<encoded>. Unwrap them. */
function decodeDdgHref(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m && m[1]) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      /* fall through to raw href */
    }
  }
  return href.startsWith("//") ? "https:" + href : href;
}

/** Parse titles/urls/snippets out of a DuckDuckGo HTML results page. */
function parseDdgResults(html: string, limit: number): WebSearchHit[] {
  const snippets: string[] = [];
  const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let s: RegExpExecArray | null;
  while ((s = snippetRe.exec(html)) !== null) snippets.push(htmlToText(s[1] ?? ""));

  const hits: WebSearchHit[] = [];
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = linkRe.exec(html)) !== null && hits.length < limit) {
    hits.push({ title: htmlToText(m[2] ?? ""), url: decodeDdgHref(m[1] ?? ""), snippet: snippets[i] ?? "" });
    i++;
  }
  return hits;
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Build the dashboard payload from the current session + memory state.
 * `includeGraph` shells out to `vkf graph` (skip it on hot paths). No-op (returns
 * undefined) when there is no session/config yet.
 */
function buildDashboardPayload(root: string, refreshSeconds?: number, includeGraph = false) {
  const sp = sessionPaths(root);
  const config = readConfig(sp.config);
  if (!config) return undefined;

  const memory: Record<string, number> = Object.fromEntries(MEMORY_STATES.map((s) => [s, 0]));
  const claimCards = listCards(root, { type: "claim" });
  for (const c of claimCards) {
    const st = c.meta["memory_state"] as MemoryState | undefined;
    if (st && st in memory) memory[st]! += 1;
  }
  // Source paper ids a claim depends on, for the lineage graph's evidenced edges.
  const paperIds = (c: (typeof claimCards)[number]): string[] =>
    (Array.isArray(c.meta["depends_on"]) ? (c.meta["depends_on"] as unknown[]) : [])
      .map(String)
      .filter((d) => d.startsWith("paper:"));
  const claims = claimCards
    .filter((c) => c.bucket === "verified")
    .slice(0, 16)
    .map((c) => ({
      id: String(c.meta["id"]),
      title: String(c.meta["title"] ?? c.meta["id"]),
      confidence: String(c.meta["confidence"] ?? "—"),
      belief: typeof c.meta["belief"] === "number" ? (c.meta["belief"] as number) : 0.5,
      state: String(c.meta["memory_state"] ?? "—"),
    }));
  // Every claim (any bucket) feeds the lineage graph, so tested candidates show too.
  const lineageClaims = claimCards.map((c) => ({
    id: String(c.meta["id"]),
    title: String(c.meta["title"] ?? c.meta["id"]),
    belief: typeof c.meta["belief"] === "number" ? (c.meta["belief"] as number) : undefined,
    state: c.meta["memory_state"] ? String(c.meta["memory_state"]) : undefined,
    paper_ids: paperIds(c),
  }));
  const papers = listCards(root, { type: "paper" }).map((c) => ({
    id: String(c.meta["id"]),
    title: String(c.meta["title"] ?? c.meta["id"]),
  }));

  const g = includeGraph ? vkf.graph(memoryPaths(root).dir) : undefined;
  return buildDashboardData({
    name: config.name,
    goal: config.goal,
    metricName: config.metricName,
    direction: config.direction,
    mode: sessionMode(config),
    autonomy: autonomyMode(config),
    maxIterations: config.maxIterations,
    stopRequested: existsSync(sp.stop),
    researchPlan: existsSync(sp.researchPlan) ? readFileSync(sp.researchPlan, "utf8") : undefined,
    baseline: config.baseline,
    experiments: readExperiments(sp.experiments),
    memory,
    claims,
    papers,
    lineageClaims,
    graph: g?.available ? { nodes: g.nodes, edges: g.edges } : undefined,
    generatedAt: new Date().toISOString(),
    refreshSeconds,
    version: VERSION,
  });
}

/**
 * (Re)generate the interactive progress dashboard. Writes the HTML shell
 * (progress.html) plus the live data sidecar (data.json); the page polls the
 * sidecar and re-renders in place. Pure-JS and cheap (no CLI on this path), so it
 * is safe to call on every state change. No-op (returns undefined) when there is
 * no session/config yet. The typed idea-lineage graph (dashboard.html via
 * `vkf html`) is heavier and stays in export_dashboard.
 */
function writeProgressDashboard(root: string, refreshSeconds?: number, includeGraph = false): string | undefined {
  const sp = sessionPaths(root);
  const data = buildDashboardPayload(root, refreshSeconds, includeGraph);
  if (!data) return undefined;
  writeFileSync(sp.progressData, JSON.stringify(data), "utf8");
  writeFileSync(sp.progressHtml, renderDashboardHtml(data), "utf8");
  return sp.progressHtml;
}

/**
 * Normalize a commit reference to a 7-char short hash. Uses the explicit value
 * if given, otherwise best-effort reads the working dir's current HEAD. Returns
 * `undefined` when there is no resolvable commit (not a repo, git missing, …).
 */
function shortCommit(explicit: string | undefined, cwd: string): string | undefined {
  const trim = (s: string): string | undefined => {
    const h = s.trim().replace(/^[^0-9a-f]*/i, "");
    return /^[0-9a-f]{7,}$/i.test(h) ? h.slice(0, 7) : undefined;
  };
  if (explicit) return trim(explicit) ?? (explicit.trim().slice(0, 7) || undefined);
  try {
    return trim(execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return undefined;
  }
}

/** The platform command that opens a file/URL in the user's default browser. */
function browserOpenCommand(target: string): [string, string[]] {
  switch (process.platform) {
    case "darwin":
      return ["open", [target]];
    case "win32":
      // `start` is a cmd builtin; the empty "" is the window-title placeholder.
      return ["cmd", ["/c", "start", "", target]];
    default:
      return ["xdg-open", [target]];
  }
}

function writeFileIfAbsent(path: string, contents: string): void {
  if (!existsSync(path)) writeFileSync(path, contents, "utf8");
}

function measureStub(command: string): string {
  return `#!/usr/bin/env bash
# Measurement script for this research loop.
# Print one or more lines of the form:  METRIC <name>=<number>
# The configured command is:
#   ${command}
set -euo pipefail

echo "TODO: measure and print 'METRIC <name>=<value>'"
`;
}

/**
 * The structured handoff document. A fresh agent (after a restart or context
 * reset) must be able to resume the loop from this file alone, so it carries the
 * autonomy directive and a fixed schema the skills keep current — not free prose.
 */
function promptStub(config: ResearchConfig): string {
  const ideate = sessionMode(config) === "ideate";
  const autonomy =
    autonomyMode(config) === "continuous"
      ? `**continuous (pre-authorized)** — do not pause to ask between iterations; the user halts via \`session/STOP\`${config.maxIterations ? `; budget ${config.maxIterations} iterations` : ""}`
      : "confirm-each — check in with the user before every experiment";
  return `# ${config.name}

**Goal:** ${config.goal}

**Mode:** ${ideate ? "ideation (deliverable: research_plan.md)" : `optimize — metric \`${config.metricName}\` (${config.direction} is better)`}

**Autonomy:** ${autonomy}

> Structured handoff document. Keep every section current after each iteration —
> a fresh agent must be able to resume the loop from this file plus \`recall_memory\`.

## Current state

- iteration: 0
- best node: (none yet)
- last action: initialized
- next action: ${ideate ? "recall_memory, then gather literature" : "recall_memory, then gather literature and plan_next_step"}

## Open questions

(What the last result left unresolved — the next iteration's research focus.)

## Dead ends / negative results

## Key wins

## Open directions
`;
}
