/**
 * Benchmark scenarios — simulated research environments with known ground truth.
 *
 * Each scenario is a pool of candidate ideas (some are obvious playbook moves with
 * small real effect, some are dead ends, some are genuinely good) plus a *combo*:
 * a strong idea that exists only as the synthesis of two parent ideas. The combo's
 * parents are deliberately constructed to be flagged by the real contradiction
 * miner (same context/goal, different mechanism), so reaching the optimum requires
 * the synthesis machinery — a blind loop cannot get there.
 */
import type { Scenario } from "./harness.ts";

const tinyLM: Scenario = {
  name: "Tiny-LM validation loss (budget 10)",
  baseline: 1.0,
  budget: 10,
  optimumImprovement: 0.1,
  ideas: [
    // Playbook: obvious, high prior attraction, small real effect, stale.
    { id: "clip", title: "Gradient clipping", mechanism: "static gradient norm clipping", context: "training optimization tuning", trueDelta: 0.015, isPlaybook: true, priorEV: 0.82, recency: 0.2, reliability: 0.5 },
    { id: "cosine", title: "Cosine schedule", mechanism: "cosine learning rate decay schedule", context: "training optimization tuning", trueDelta: 0.02, isPlaybook: true, priorEV: 0.8, recency: 0.2, reliability: 0.5 },
    { id: "dropout", title: "Dropout tuning", mechanism: "dropout regularization rate", context: "training optimization tuning", trueDelta: 0.01, isPlaybook: true, priorEV: 0.78, recency: 0.2, reliability: 0.5 },
    { id: "wd", title: "Weight decay tuning", mechanism: "weight decay coefficient tuning", context: "training optimization tuning", trueDelta: 0.012, isPlaybook: true, priorEV: 0.76, recency: 0.2, reliability: 0.5 },
    { id: "ls", title: "Label smoothing", mechanism: "label smoothing factor", context: "training optimization tuning", trueDelta: 0.01, isPlaybook: true, priorEV: 0.74, recency: 0.2, reliability: 0.5 },
    // Dead-end family: tempting (high prior attraction) but all bad. Trying one
    // should teach you to abandon the whole region — a blind loop keeps reaching
    // back in because each member looks individually attractive.
    { id: "lr_hi", title: "Aggressive LR increase", mechanism: "raise base learning rate aggressively", context: "learning rate magnitude regime", trueDelta: -0.03, priorEV: 0.7, recency: 0.6, reliability: 0.5, deadEndGroup: "lr-mag" },
    { id: "lr_peak", title: "Very high peak LR", mechanism: "use very large peak learning rate value", context: "learning rate magnitude regime", trueDelta: -0.04, priorEV: 0.69, recency: 0.6, reliability: 0.5, deadEndGroup: "lr-mag" },
    { id: "lr_dbl", title: "LR doubling", mechanism: "double the learning rate each phase", context: "learning rate magnitude regime", trueDelta: -0.05, priorEV: 0.68, recency: 0.6, reliability: 0.5, deadEndGroup: "lr-mag" },
    // Genuinely good, novel — and the two combo parents (same goal, diff mechanism).
    { id: "adagc", title: "Adaptive gradient clipping", mechanism: "adaptive ema gradient norm thresholding", context: "training stability control regime", trueDelta: 0.06, priorEV: 0.55, recency: 0.9, reliability: 0.6 },
    { id: "dsinit", title: "Depth-scaled init", mechanism: "depth dependent weight initialization scaling", context: "training stability control regime", trueDelta: 0.055, priorEV: 0.5, recency: 0.85, reliability: 0.55 },
    // Other novel ideas (breadth).
    { id: "muon", title: "Muon optimizer", mechanism: "muon orthogonalized momentum optimizer", context: "optimizer geometry", trueDelta: 0.05, priorEV: 0.5, recency: 0.9, reliability: 0.5 },
    { id: "qknorm", title: "QK normalization", mechanism: "query key normalization in attention", context: "attention numerical stability", trueDelta: 0.045, priorEV: 0.45, recency: 0.85, reliability: 0.5 },
  ],
  combos: [
    {
      id: "unified_scale",
      title: "Unified adaptive-init scale controller",
      mechanism: "unified dynamic scale control combining adaptive clipping and depth init",
      context: "training stability control regime",
      parents: ["adagc", "dsinit"],
      trueDelta: 0.13,
      priorEV: 0.6,
      recency: 0.95,
      reliability: 0.6,
    },
  ],
};

const inferenceLatency: Scenario = {
  name: "Inference latency (budget 8)",
  baseline: 1.0,
  budget: 8,
  optimumImprovement: 0.12,
  ideas: [
    { id: "o2", title: "Compiler -O2", mechanism: "enable compiler optimization flags", context: "build configuration tuning", trueDelta: 0.02, isPlaybook: true, priorEV: 0.8, recency: 0.2, reliability: 0.5 },
    { id: "cache", title: "Result caching", mechanism: "memoize repeated computations", context: "build configuration tuning", trueDelta: 0.025, isPlaybook: true, priorEV: 0.78, recency: 0.2, reliability: 0.5 },
    { id: "batchsz", title: "Batch size sweep", mechanism: "tune inference batch size", context: "build configuration tuning", trueDelta: 0.015, isPlaybook: true, priorEV: 0.76, recency: 0.2, reliability: 0.5 },
    { id: "thread_max", title: "Max out threads", mechanism: "raise worker thread count aggressively", context: "thread oversubscription regime", trueDelta: -0.03, priorEV: 0.7, recency: 0.6, reliability: 0.5, deadEndGroup: "threads" },
    { id: "thread_spin", title: "Busy-spin workers", mechanism: "spin lock worker threads for latency", context: "thread oversubscription regime", trueDelta: -0.04, priorEV: 0.69, recency: 0.6, reliability: 0.5, deadEndGroup: "threads" },
    { id: "thread_pin", title: "Aggressive core pinning", mechanism: "pin every worker to dedicated cores oversubscribed", context: "thread oversubscription regime", trueDelta: -0.05, priorEV: 0.68, recency: 0.6, reliability: 0.5, deadEndGroup: "threads" },
    // Combo parents: same goal (memory traffic reduction), different mechanism.
    { id: "quant", title: "Activation quantization", mechanism: "int8 activation quantization reduces bandwidth", context: "memory bandwidth reduction regime", trueDelta: 0.06, priorEV: 0.55, recency: 0.9, reliability: 0.6 },
    { id: "fuse", title: "Kernel fusion", mechanism: "operator fusion reduces memory round trips", context: "memory bandwidth reduction regime", trueDelta: 0.055, priorEV: 0.5, recency: 0.85, reliability: 0.55 },
    { id: "sparse", title: "Sparse routing", mechanism: "event driven sparse activation routing", context: "conditional computation", trueDelta: 0.05, priorEV: 0.5, recency: 0.9, reliability: 0.5 },
  ],
  combos: [
    {
      id: "fused_quant",
      title: "Fused quantized kernels",
      mechanism: "combine int8 quantization with operator fusion to cut bandwidth twice",
      context: "memory bandwidth reduction regime",
      parents: ["quant", "fuse"],
      trueDelta: 0.15,
      priorEV: 0.6,
      recency: 0.95,
      reliability: 0.6,
    },
  ],
};

export const SCENARIOS: Scenario[] = [tinyLM, inferenceLatency];
