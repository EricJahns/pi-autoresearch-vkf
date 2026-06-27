/**
 * Append-only JSONL log helpers for `.auto/log.jsonl`.
 *
 * Every loop event — a remembered claim, a verification, an experiment run, a
 * logged result — is recorded as one JSON object per line so the history is
 * append-only, greppable, and survives crashes mid-run. This is the session-level
 * trace; durable knowledge additionally lands in the VKF memory bundle.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";

/** A single log entry. `event` discriminates the kind of action. */
export interface LogEntry {
  ts: string;
  event: "init" | "remember" | "verify" | "recall" | "run" | "result" | "note";
  [key: string]: unknown;
}

/** Append one entry, stamping `ts` if the caller did not provide one. */
export function appendLog(
  logPath: string,
  entry: Omit<LogEntry, "ts"> & { ts?: string },
): void {
  const withTs: LogEntry = { ts: entry.ts ?? new Date().toISOString(), ...entry } as LogEntry;
  appendFileSync(logPath, JSON.stringify(withTs) + "\n", "utf8");
}

/** Read all entries, skipping blank or unparseable lines. */
export function readLog(logPath: string): LogEntry[] {
  if (!existsSync(logPath)) return [];
  const out: LogEntry[] = [];
  for (const line of readFileSync(logPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as LogEntry);
    } catch {
      // Skip corrupt lines rather than failing the whole read.
    }
  }
  return out;
}
