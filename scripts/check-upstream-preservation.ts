#!/usr/bin/env node

import {
  formatCliError,
  parseCliArgs,
  runPreservation,
} from "./lib/upstream-preservation/index.ts";

const main = (): number => {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const report = runPreservation(options);
    process.stdout.write(`${report.lines.join("\n")}\n`);
    return report.exitCode;
  } catch (error) {
    process.stderr.write(`${formatCliError(error)}\n`);
    return 1;
  }
};

process.exitCode = main();
