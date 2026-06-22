export function logHarnessPhase(message: string): void {
  process.stdout.write(`[e2e] ${message}\n`);
}
