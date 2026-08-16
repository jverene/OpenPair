/**
 * harness/types.ts — the single harness interface.
 *
 * harness/opencode.ts and harness/fallback.ts both implement this, so the
 * Executor never branches on which harness is active; selection happens
 * once, at harness construction (see harness/index.ts).
 */
export interface HarnessResult {
  ok: boolean;
  output: string;
  /** Actionable troubleshooting text when ok is false. */
  error?: string;
}

export interface Harness {
  readonly name: string;
  /**
   * Mandatory smoke test run before every real task. A 15-second failure
   * beats a 5-minute mystery: if preflight fails, the real task must not
   * proceed and the error lands in execution.md.
   */
  preflight(): Promise<HarnessResult>;
  execute(task: string, context: string): Promise<HarnessResult>;
}
