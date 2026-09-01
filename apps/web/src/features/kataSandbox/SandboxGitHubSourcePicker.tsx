"use client";

import type { SandboxGitHubRepositorySummary } from "@kata-sh/code-kata-sandbox-contracts/http";
import { GitBranchIcon, GithubIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "../../components/ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
} from "../../components/ui/combobox";
import { fetchSandboxGitHubBranches, fetchSandboxGitHubRepositories } from "./api";
import {
  appendUniqueBy,
  createRequestGeneration,
  filterByQuery,
} from "./SandboxGitHubSourcePicker.logic";

interface SandboxGitHubSourcePickerProps {
  readonly idPrefix: string;
  readonly repository: string;
  readonly ref: string;
  readonly disabled: boolean;
  readonly onRepositoryChange: (repository: string) => void;
  readonly onRefChange: (ref: string) => void;
}

type LoadState = "idle" | "loading" | "error";

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== "" ? error.message : fallback;
}

export function SandboxGitHubSourcePicker({
  idPrefix,
  repository,
  ref,
  disabled,
  onRepositoryChange,
  onRefChange,
}: SandboxGitHubSourcePickerProps) {
  const [repositoryOpen, setRepositoryOpen] = useState(false);
  const [repositoryQuery, setRepositoryQuery] = useState("");
  const [repositories, setRepositories] = useState<ReadonlyArray<SandboxGitHubRepositorySummary>>(
    [],
  );
  const [repositoryState, setRepositoryState] = useState<LoadState>("idle");
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [repositoryPage, setRepositoryPage] = useState(0);
  const [repositoryHasMore, setRepositoryHasMore] = useState(false);

  const [branchOpen, setBranchOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [branches, setBranches] = useState<ReadonlyArray<string>>([]);
  const [branchState, setBranchState] = useState<LoadState>("idle");
  const [branchError, setBranchError] = useState<string | null>(null);
  const [branchPage, setBranchPage] = useState(0);
  const [branchHasMore, setBranchHasMore] = useState(false);

  const [repositoryRequests] = useState(createRequestGeneration);
  const [branchRequests] = useState(createRequestGeneration);

  const loadRepositories = useCallback(
    async (page: number) => {
      const generation = repositoryRequests.begin();
      setRepositoryState("loading");
      setRepositoryError(null);
      try {
        const result = await fetchSandboxGitHubRepositories(page);
        if (!repositoryRequests.isCurrent(generation)) return;
        setRepositories((current) =>
          page === 1
            ? appendUniqueBy([], result.repositories, (item) => item.nameWithOwner)
            : appendUniqueBy(current, result.repositories, (item) => item.nameWithOwner),
        );
        setRepositoryPage(result.page);
        setRepositoryHasMore(result.hasMore);
        setRepositoryState("idle");
      } catch (error) {
        if (!repositoryRequests.isCurrent(generation)) return;
        setRepositoryState("error");
        setRepositoryError(message(error, "Failed to load repositories."));
      }
    },
    [repositoryRequests],
  );

  const loadBranches = useCallback(
    async (selectedRepository: string, page: number) => {
      const generation = branchRequests.begin();
      setBranchState("loading");
      setBranchError(null);
      try {
        const result = await fetchSandboxGitHubBranches({
          repository: selectedRepository,
          page,
        });
        if (!branchRequests.isCurrent(generation)) return;
        setBranches((current) =>
          page === 1
            ? appendUniqueBy([], result.branches, String)
            : appendUniqueBy(current, result.branches, String),
        );
        setBranchPage(result.page);
        setBranchHasMore(result.hasMore);
        setBranchState("idle");
      } catch (error) {
        if (!branchRequests.isCurrent(generation)) return;
        setBranchState("error");
        setBranchError(message(error, "Failed to load branches."));
      }
    },
    [branchRequests],
  );

  useEffect(
    () => () => {
      repositoryRequests.invalidate();
      branchRequests.invalidate();
    },
    [branchRequests, repositoryRequests],
  );

  useEffect(() => {
    if (repositoryOpen && repositoryState === "idle" && repositories.length === 0) {
      void loadRepositories(1);
    }
  }, [loadRepositories, repositories.length, repositoryOpen, repositoryState]);

  useEffect(() => {
    if (branchOpen && repository && branchState === "idle" && branches.length === 0) {
      void loadBranches(repository, 1);
    }
  }, [branchOpen, branchState, branches.length, loadBranches, repository]);

  const filteredRepositories = useMemo(
    () => filterByQuery(repositories, repositoryQuery, (item) => item.nameWithOwner),
    [repositories, repositoryQuery],
  );
  const filteredBranches = useMemo(
    () => filterByQuery(branches, branchQuery),
    [branches, branchQuery],
  );

  const closeRepositories = useCallback(() => {
    repositoryRequests.invalidate();
    setRepositoryOpen(false);
    setRepositoryQuery("");
    setRepositoryState((state) => (state === "loading" ? "idle" : state));
  }, [repositoryRequests]);

  const closeBranches = useCallback(() => {
    branchRequests.invalidate();
    setBranchOpen(false);
    setBranchQuery("");
    setBranchState((state) => (state === "loading" ? "idle" : state));
  }, [branchRequests]);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <label className="text-xs font-medium text-foreground" htmlFor={`${idPrefix}-repository`}>
          GitHub repository
        </label>
        <Combobox<string>
          items={filteredRepositories.map((item) => item.nameWithOwner)}
          open={repositoryOpen}
          onOpenChange={(open) => {
            if (disabled) return;
            if (!open) {
              closeRepositories();
              return;
            }
            setRepositoryOpen(true);
          }}
          value={repository || null}
          onValueChange={(next) => {
            if (!next) return;
            const selected = repositories.find((item) => item.nameWithOwner === next);
            branchRequests.invalidate();
            setBranches([]);
            setBranchPage(0);
            setBranchHasMore(false);
            setBranchError(null);
            setBranchState("idle");
            setBranchOpen(false);
            onRepositoryChange(next);
            onRefChange(selected?.defaultBranch ?? "");
            closeRepositories();
          }}
        >
          <ComboboxTrigger
            id={`${idPrefix}-repository`}
            render={<Button variant="outline" size="sm" className="w-full justify-between" />}
            disabled={disabled}
          >
            <span className="flex min-w-0 items-center gap-2">
              <GithubIcon className="size-3.5 shrink-0 opacity-70" />
              <span className="truncate">{repository || "Select a repository"}</span>
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
                  value={repositoryQuery}
                  onChange={(event) => setRepositoryQuery(event.target.value)}
                  aria-label="Search GitHub repositories"
                />
              </div>
            </div>
            <ComboboxEmpty>
              {repositoryState === "loading" ? "Loading…" : "No repositories found."}
            </ComboboxEmpty>
            <ComboboxList className="max-h-56">
              {filteredRepositories.map((item) => (
                <ComboboxItem key={item.nameWithOwner} value={item.nameWithOwner}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{item.nameWithOwner}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {item.visibility} · default {item.defaultBranch}
                    </span>
                  </span>
                </ComboboxItem>
              ))}
            </ComboboxList>
            {repositoryHasMore && repositoryState !== "loading" ? (
              <div className="px-2 pb-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => void loadRepositories(repositoryPage + 1)}
                >
                  Load more
                </Button>
              </div>
            ) : null}
            {repositoryState === "loading" ? (
              <ComboboxStatus>Loading repositories…</ComboboxStatus>
            ) : repositoryState === "error" ? (
              <ComboboxStatus className="flex items-center justify-between gap-2">
                <span>{repositoryError ?? "Failed to load repositories."}</span>
                <Button variant="ghost" size="sm" onClick={() => void loadRepositories(1)}>
                  Retry
                </Button>
              </ComboboxStatus>
            ) : null}
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
            if (disabled || !repository) return;
            if (!open) {
              closeBranches();
              return;
            }
            setBranchOpen(true);
          }}
          value={branches.includes(ref) ? ref : null}
          onValueChange={(next) => {
            if (!next) return;
            onRefChange(next);
            closeBranches();
          }}
        >
          <ComboboxTrigger
            id={`${idPrefix}-branch`}
            render={<Button variant="outline" size="sm" className="w-full justify-between" />}
            disabled={disabled || !repository}
          >
            <span className="flex min-w-0 items-center gap-2">
              <GitBranchIcon className="size-3.5 shrink-0 opacity-70" />
              <span className="truncate">
                {ref || (repository ? "Select a branch" : "Select a repository first")}
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
              {filteredBranches.map((branch) => (
                <ComboboxItem key={branch} value={branch}>
                  {branch}
                </ComboboxItem>
              ))}
            </ComboboxList>
            {branchHasMore && branchState !== "loading" ? (
              <div className="px-2 pb-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => void loadBranches(repository, branchPage + 1)}
                >
                  Load more
                </Button>
              </div>
            ) : null}
            {branchState === "loading" ? (
              <ComboboxStatus>Loading branches…</ComboboxStatus>
            ) : branchState === "error" ? (
              <ComboboxStatus className="flex items-center justify-between gap-2">
                <span>{branchError ?? "Failed to load branches."}</span>
                <Button variant="ghost" size="sm" onClick={() => void loadBranches(repository, 1)}>
                  Retry
                </Button>
              </ComboboxStatus>
            ) : null}
          </ComboboxPopup>
        </Combobox>
      </div>
    </div>
  );
}
