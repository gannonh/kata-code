"use client";

import { GitBranchIcon, GithubIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  SandboxGitHubRepository,
  SandboxListGitHubBranchesResult,
  SandboxSearchGitHubRepositoriesResult,
} from "@kata-sh/code-contracts";

import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
} from "../ui/combobox";

interface VercelSourcePickerProps {
  readonly idPrefix: string;
  readonly repository: string | undefined;
  readonly branch: string | undefined;
  /** True once a sandbox exists (running or stopped): source is locked. */
  readonly locked: boolean;
  readonly onRepositoryChange: (input: { repository: string; defaultBranch: string }) => void;
  readonly onBranchChange: (branch: string) => void;
}

type LoadState = "idle" | "loading" | "error";

/**
 * GitHub repository + branch source pickers for a Vercel sandbox target. Both
 * are keyboard-accessible searchable comboboxes backed by the host `gh`
 * session (no token reaches the browser). The repository picker initializes the
 * branch to the repository's default branch. Source controls lock once a
 * sandbox exists.
 */
export function VercelSourcePicker({
  idPrefix,
  repository,
  branch,
  locked,
  onRepositoryChange,
  onBranchChange,
}: VercelSourcePickerProps) {
  const [repoOpen, setRepoOpen] = useState(false);
  const [repoQuery, setRepoQuery] = useState("");
  const [repos, setRepos] = useState<ReadonlyArray<SandboxGitHubRepository>>([]);
  const [repoState, setRepoState] = useState<LoadState>("idle");
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoPage, setRepoPage] = useState(0);
  const [repoHasMore, setRepoHasMore] = useState(false);

  const [branchOpen, setBranchOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [branches, setBranches] = useState<ReadonlyArray<string>>([]);
  const [branchState, setBranchState] = useState<LoadState>("idle");
  const [branchError, setBranchError] = useState<string | null>(null);
  const [branchPage, setBranchPage] = useState(0);
  const [branchHasMore, setBranchHasMore] = useState(false);

  const loadRepositories = useCallback(async (page: number) => {
    setRepoState("loading");
    setRepoError(null);
    try {
      const result: SandboxSearchGitHubRepositoriesResult =
        await getPrimaryEnvironmentConnection().client.sandbox.searchGitHubRepositories({ page });
      setRepos((prev) => (page <= 1 ? result.repositories : [...prev, ...result.repositories]));
      setRepoPage(page);
      setRepoHasMore(result.hasMore);
      setRepoState("idle");
    } catch (error) {
      setRepoState("error");
      setRepoError(error instanceof Error ? error.message : "Failed to load repositories.");
    }
  }, []);

  const loadBranches = useCallback(async (repo: string, page: number) => {
    setBranchState("loading");
    setBranchError(null);
    try {
      const result: SandboxListGitHubBranchesResult =
        await getPrimaryEnvironmentConnection().client.sandbox.listGitHubBranches({
          repository: repo,
          page,
        });
      setBranches((prev) => (page <= 1 ? result.branches : [...prev, ...result.branches]));
      setBranchPage(page);
      setBranchHasMore(result.hasMore);
      setBranchState("idle");
    } catch (error) {
      setBranchState("error");
      setBranchError(error instanceof Error ? error.message : "Failed to load branches.");
    }
  }, []);

  useEffect(() => {
    if (repoOpen && repoState === "idle" && repos.length === 0) {
      void loadRepositories(1);
    }
  }, [repoOpen, repoState, repos.length, loadRepositories]);

  useEffect(() => {
    // Reload the first page of branches whenever the popup opens for the
    // current repository.
    if (branchOpen && repository) {
      void loadBranches(repository, 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchOpen, repository]);

  const filteredRepos = useMemo(() => {
    const q = repoQuery.trim().toLowerCase();
    if (q.length === 0) return repos;
    return repos.filter((repo) => repo.nameWithOwner.toLowerCase().includes(q));
  }, [repos, repoQuery]);

  const filteredBranches = useMemo(() => {
    const q = branchQuery.trim().toLowerCase();
    if (q.length === 0) return branches;
    return branches.filter((name) => name.toLowerCase().includes(q));
  }, [branches, branchQuery]);

  const repoStatusText =
    repoState === "loading"
      ? "Loading repositories…"
      : repoState === "error"
        ? (repoError ?? "Failed to load repositories.")
        : null;
  const branchStatusText =
    branchState === "loading"
      ? "Loading branches…"
      : branchState === "error"
        ? (branchError ?? "Failed to load branches.")
        : null;

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <label className="text-xs font-medium text-foreground" htmlFor={`${idPrefix}-repository`}>
          GitHub repository
        </label>
        <Combobox<string>
          items={filteredRepos.map((repo) => repo.nameWithOwner)}
          open={repoOpen}
          onOpenChange={(open) => {
            if (locked) return;
            setRepoOpen(open);
            if (!open) setRepoQuery("");
          }}
          value={repository ?? null}
          onValueChange={(next) => {
            if (!next) return;
            const selected = repos.find((repo) => repo.nameWithOwner === next);
            onRepositoryChange({
              repository: next,
              defaultBranch: selected?.defaultBranch ?? "",
            });
            setRepoOpen(false);
          }}
        >
          <ComboboxTrigger
            id={`${idPrefix}-repository`}
            render={<Button variant="outline" size="sm" className="w-full justify-between" />}
            disabled={locked}
          >
            <span className="flex min-w-0 items-center gap-2">
              <GithubIcon className="size-3.5 shrink-0 opacity-70" />
              <span className="truncate">{repository ?? "Select a repository"}</span>
            </span>
          </ComboboxTrigger>
          <ComboboxPopup className="flex w-[min(28rem,90vw)] flex-col" align="start">
            <div className="shrink-0 px-3 pt-2.5">
              <div className="relative -translate-y-px border-b border-border/70 pb-1.5 focus-within:border-ring">
                <SearchIcon
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1.5 left-0 size-4 text-muted-foreground/55"
                />
                <ComboboxInput
                  className="[&_input]:h-6.5 [&_input]:ps-5"
                  inputClassName="rounded-none bg-transparent text-sm"
                  placeholder="Search repositories…"
                  showTrigger={false}
                  size="sm"
                  unstyled
                  value={repoQuery}
                  onChange={(event) => setRepoQuery(event.target.value)}
                  aria-label="Search GitHub repositories"
                />
              </div>
            </div>
            <ComboboxEmpty>
              {repoState === "loading" ? "Loading…" : "No repositories found."}
            </ComboboxEmpty>
            <ComboboxList className="max-h-56">
              {filteredRepos.map((repo) => (
                <ComboboxItem key={repo.nameWithOwner} value={repo.nameWithOwner}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{repo.nameWithOwner}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {repo.visibility} · default {repo.defaultBranch}
                    </span>
                  </span>
                </ComboboxItem>
              ))}
            </ComboboxList>
            {repoHasMore && repoState !== "loading" ? (
              <div className="px-2 pb-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => void loadRepositories(repoPage + 1)}
                >
                  Load more
                </Button>
              </div>
            ) : null}
            {repoStatusText ? <ComboboxStatus>{repoStatusText}</ComboboxStatus> : null}
          </ComboboxPopup>
        </Combobox>
      </div>

      <div className="grid gap-1.5">
        <label className="text-xs font-medium text-foreground" htmlFor={`${idPrefix}-branch`}>
          Branch
        </label>
        <Combobox<string>
          items={filteredBranches}
          open={branchOpen}
          onOpenChange={(open) => {
            if (locked || !repository) return;
            setBranchOpen(open);
            if (!open) setBranchQuery("");
          }}
          value={branch ?? null}
          onValueChange={(next) => {
            if (!next) return;
            onBranchChange(next);
            setBranchOpen(false);
          }}
        >
          <ComboboxTrigger
            id={`${idPrefix}-branch`}
            render={<Button variant="outline" size="sm" className="w-full justify-between" />}
            disabled={locked || !repository}
          >
            <span className="flex min-w-0 items-center gap-2">
              <GitBranchIcon className="size-3.5 shrink-0 opacity-70" />
              <span className="truncate">
                {branch ?? (repository ? "Select a branch" : "Select a repository first")}
              </span>
            </span>
          </ComboboxTrigger>
          <ComboboxPopup className="flex w-[min(28rem,90vw)] flex-col" align="start">
            <div className="shrink-0 px-3 pt-2.5">
              <div className="relative -translate-y-px border-b border-border/70 pb-1.5 focus-within:border-ring">
                <SearchIcon
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1.5 left-0 size-4 text-muted-foreground/55"
                />
                <ComboboxInput
                  className="[&_input]:h-6.5 [&_input]:ps-5"
                  inputClassName="rounded-none bg-transparent text-sm"
                  placeholder="Search branches…"
                  showTrigger={false}
                  size="sm"
                  unstyled
                  value={branchQuery}
                  onChange={(event) => setBranchQuery(event.target.value)}
                  aria-label="Search branches"
                />
              </div>
            </div>
            <ComboboxEmpty>
              {branchState === "loading" ? "Loading…" : "No branches found."}
            </ComboboxEmpty>
            <ComboboxList className="max-h-56">
              {filteredBranches.map((name) => (
                <ComboboxItem key={name} value={name}>
                  {name}
                </ComboboxItem>
              ))}
            </ComboboxList>
            {branchHasMore && branchState !== "loading" ? (
              <div className="px-2 pb-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() =>
                    repository ? void loadBranches(repository, branchPage + 1) : undefined
                  }
                >
                  Load more
                </Button>
              </div>
            ) : null}
            {branchStatusText ? <ComboboxStatus>{branchStatusText}</ComboboxStatus> : null}
          </ComboboxPopup>
        </Combobox>
      </div>

      {locked ? (
        <p className="text-xs text-muted-foreground">
          Delete this sandbox to change its repository or branch.
        </p>
      ) : null}
    </div>
  );
}
