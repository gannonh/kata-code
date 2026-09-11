import * as NodeModule from "node:module";
const require = NodeModule.createRequire(
  new URL("../../../apps/server/package.json", import.meta.url),
);
const { Cron, Result } = await import(require.resolve("effect"));
const samples = [
  ["spring", "30 2 * * *", "2027-03-14T00:00:00-08:00"],
  ["fall", "30 1 * * *", "2026-11-01T00:00:00-07:00"],
];
for (const [name, expression, start] of samples) {
  const c = Result.getOrThrow(Cron.parse(expression, "America/Los_Angeles"));
  const results = [];
  let cursor = new Date(start);
  for (let i = 0; i < 3; i++) {
    cursor = Cron.next(c, cursor);
    results.push(cursor.toISOString());
  }
  console.log(JSON.stringify({ name, expression, start, results }));
}
