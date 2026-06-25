export function logHarnessPhase(message: string): void {
  process.stdout.write(`[mobile-e2e] ${message}\n`);
}
