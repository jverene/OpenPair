/**
 * ui.ts — terminal output. Agent names are color-coded, phase transitions
 * and handoffs are visible, per the PRD's first-run experience:
 *
 *   [Executor]  Done. Wrote execution.md.
 *   [Vision]    Reading execution.md and reviewing...
 */
import pc from "picocolors";

export class UI {
  constructor(private readonly quiet = false) {}

  phase(title: string): void {
    this.line(pc.bold(pc.white(`\n── ${title} ${"─".repeat(Math.max(2, 50 - title.length))}`)));
  }

  vision(message: string): void {
    this.line(`${pc.cyan(pc.bold("[Vision]"))}    ${message}`);
  }

  executor(message: string): void {
    this.line(`${pc.magenta(pc.bold("[Executor]"))}  ${message}`);
  }

  system(message: string): void {
    this.line(pc.gray(message));
  }

  human(message: string): void {
    this.line(pc.yellow(pc.bold(`\n[Human] ${message}`)));
  }

  private line(text: string): void {
    if (!this.quiet) console.log(text);
  }
}
