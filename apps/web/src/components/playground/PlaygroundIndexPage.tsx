import { Link } from "@tanstack/react-router";

export type PlaygroundExperiment = {
  id: string;
  title: string;
  description: string;
  to: "/playground/sidebar" | "/playground/task-mode";
  status: "active" | "archived";
};

/** Catalog of dev-only playground experiments. Add new entries as routes land. */
export const PLAYGROUND_EXPERIMENTS: readonly PlaygroundExperiment[] = [
  {
    id: "task-mode-ux",
    title: "Task mode UX",
    description:
      "Explore the accepted conversation-plus-panel Task workspace across shared history and revision fixtures.",
    to: "/playground/task-mode",
    status: "active",
  },
  {
    id: "sidebar-v2",
    title: "Sidebar v2",
    description:
      "Attention-tier sidebar fixtures for UAT: Waiting, Working, Blocked, Idle, picker scope, and scroll density.",
    to: "/playground/sidebar",
    status: "active",
  },
];

/**
 * Dev-only index of playground experiments.
 * Open via `/playground` while `pnpm run dev` is running.
 */
export function PlaygroundIndexPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Dev only
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Playground</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Fixture and prototype surfaces for maintainer UAT. Production builds redirect away from
            these routes.
          </p>
        </header>

        <ul className="flex flex-col gap-3" data-testid="playground-experiment-list">
          {PLAYGROUND_EXPERIMENTS.map((experiment) => (
            <li key={experiment.id}>
              <Link
                to={experiment.to}
                className="group flex flex-col gap-1 rounded-xl border border-border bg-card/80 px-4 py-3 transition-colors hover:border-foreground/25 hover:bg-card"
                data-testid={`playground-experiment-${experiment.id}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground group-hover:underline">
                    {experiment.title}
                  </span>
                  <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    {experiment.status}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{experiment.description}</p>
                <span className="mt-1 font-mono text-xs text-muted-foreground/80">
                  {experiment.to}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
