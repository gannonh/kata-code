"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ProviderInstanceEnvironmentVariable,
  RepositoryCanonicalKey,
  SavedEnvironmentTerminal,
  SavedSandboxEnvironment,
  SavedSandboxEnvironmentMap,
} from "@kata-sh/code-contracts";

import type { Project } from "../../types";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { ProviderEnvironmentSection } from "./ProviderInstanceCard";
import {
  applySavedEnvironmentFieldPatch,
  applySavedEnvironmentTerminalPatch,
  removeSavedEnvironmentTerminal,
} from "./SavedEnvironmentEditor.logic";

const UNSET_NETWORK_ACCESS = "__kata_default_network_access__";
let terminalDraftId = 0;

type RepositoryProject = Project & {
  readonly repositoryIdentity: NonNullable<Project["repositoryIdentity"]>;
};

type TerminalDraftRow = SavedEnvironmentTerminal & {
  readonly id: string;
};

interface SavedEnvironmentEditorProps {
  readonly projects: ReadonlyArray<Project>;
  readonly savedSandboxEnvironments: SavedSandboxEnvironmentMap | undefined;
  readonly selectedRepositoryKey: string | undefined;
  readonly onSelectedRepositoryKeyChange: (repositoryKey: string) => void;
  readonly onChange: (next: SavedSandboxEnvironmentMap) => void;
}

function projectRepositoryKey(project: RepositoryProject): string {
  return project.repositoryIdentity.canonicalKey as string;
}

function projectLabel(project: RepositoryProject): string {
  const owner = project.repositoryIdentity.owner?.trim();
  const name = project.repositoryIdentity.name?.trim();
  return owner && name
    ? `${owner}/${name}`
    : (project.repositoryIdentity.displayName ?? project.name);
}

function makeTerminalDraftRow(terminal: SavedEnvironmentTerminal, index: number): TerminalDraftRow {
  return {
    id: `${index}:${terminal.name}:${terminal.command}`,
    name: terminal.name,
    command: terminal.command,
  };
}

function nextTerminalDraftId(): string {
  terminalDraftId += 1;
  return `new:${terminalDraftId}`;
}

function findSelectedProject(
  projects: ReadonlyArray<RepositoryProject>,
  selectedRepositoryKey: string | undefined,
): RepositoryProject | undefined {
  if (!selectedRepositoryKey) return projects[0];
  return projects.find((project) => projectRepositoryKey(project) === selectedRepositoryKey);
}

export function SavedEnvironmentEditor({
  projects,
  savedSandboxEnvironments,
  selectedRepositoryKey,
  onSelectedRepositoryKeyChange,
  onChange,
}: SavedEnvironmentEditorProps) {
  const repositoryProjects = useMemo(() => {
    const seen = new Set<string>();
    return projects.filter((project): project is RepositoryProject => {
      const key = project.repositoryIdentity?.canonicalKey;
      if (!key) return false;
      const keyStr = key as string;
      if (seen.has(keyStr)) return false;
      seen.add(keyStr);
      return true;
    });
  }, [projects]);
  const selectedProject = findSelectedProject(repositoryProjects, selectedRepositoryKey);
  const repositoryKey = selectedProject ? projectRepositoryKey(selectedProject) : undefined;
  const savedEnvironment: SavedSandboxEnvironment | undefined = repositoryKey
    ? savedSandboxEnvironments?.[repositoryKey as RepositoryCanonicalKey]
    : undefined;

  const [terminalDrafts, setTerminalDrafts] = useState<ReadonlyArray<TerminalDraftRow>>(() =>
    (savedEnvironment?.terminals ?? []).map(makeTerminalDraftRow),
  );

  useEffect(() => {
    setTerminalDrafts((savedEnvironment?.terminals ?? []).map(makeTerminalDraftRow));
  }, [savedEnvironment?.terminals]);

  if (repositoryProjects.length === 0) {
    return (
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Saved environment</span>
        <p className="text-xs text-muted-foreground">
          Add or open a git-backed project to save per-repo install, start, terminal, and secret
          settings.
        </p>
      </div>
    );
  }

  if (!repositoryKey) {
    return null;
  }

  const publishFieldPatch = (patch: Parameters<typeof applySavedEnvironmentFieldPatch>[2]) => {
    onChange(applySavedEnvironmentFieldPatch(savedSandboxEnvironments, repositoryKey, patch));
  };

  const updateTerminal = (
    index: number,
    id: string,
    patch: Partial<Omit<TerminalDraftRow, "id">>,
  ) => {
    const nextRows = terminalDrafts.map((row) => (row.id === id ? { ...row, ...patch } : row));
    setTerminalDrafts(nextRows);
    onChange(
      applySavedEnvironmentTerminalPatch(savedSandboxEnvironments, repositoryKey, index, {
        name: nextRows[index]?.name ?? "",
        command: nextRows[index]?.command ?? "",
      }),
    );
  };

  const removeTerminal = (index: number, id: string) => {
    setTerminalDrafts(terminalDrafts.filter((row) => row.id !== id));
    onChange(removeSavedEnvironmentTerminal(savedSandboxEnvironments, repositoryKey, index));
  };

  const updateEnvironment = (environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>) => {
    publishFieldPatch({ environment });
  };

  return (
    <div className="grid gap-4" data-testid="saved-environment-editor">
      <div className="grid gap-1.5">
        <label
          className="text-xs font-medium text-foreground"
          htmlFor={`saved-environment-repo-${repositoryKey}`}
        >
          Saved environment
        </label>
        <Select
          value={repositoryKey}
          onValueChange={(nextKey) => {
            if (nextKey) onSelectedRepositoryKeyChange(nextKey);
          }}
        >
          <SelectTrigger id={`saved-environment-repo-${repositoryKey}`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {repositoryProjects.map((project) => {
              const key = projectRepositoryKey(project);
              return (
                <SelectItem key={key} value={key}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{projectLabel(project)}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{key}</span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectPopup>
        </Select>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1.5" htmlFor={`saved-environment-install-${repositoryKey}`}>
          <span className="text-xs font-medium text-foreground">Install</span>
          <DraftInput
            id={`saved-environment-install-${repositoryKey}`}
            value={savedEnvironment?.install ?? ""}
            onCommit={(install) => publishFieldPatch({ install })}
            placeholder="pnpm install"
            spellCheck={false}
          />
        </label>
        <label className="grid gap-1.5" htmlFor={`saved-environment-start-${repositoryKey}`}>
          <span className="text-xs font-medium text-foreground">Start</span>
          <DraftInput
            id={`saved-environment-start-${repositoryKey}`}
            value={savedEnvironment?.start ?? ""}
            onCommit={(start) => publishFieldPatch({ start })}
            placeholder="pnpm dev --host 0.0.0.0"
            spellCheck={false}
          />
        </label>
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Network access</span>
        <Select
          value={savedEnvironment?.networkAccess ?? UNSET_NETWORK_ACCESS}
          onValueChange={(networkAccess) => {
            if (!networkAccess) return;
            publishFieldPatch({
              networkAccess: networkAccess === UNSET_NETWORK_ACCESS ? "" : networkAccess,
            });
          }}
        >
          <SelectTrigger className="w-full sm:w-56" aria-label="Network access">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            <SelectItem value={UNSET_NETWORK_ACCESS}>Default</SelectItem>
            <SelectItem value="private-network">Private network</SelectItem>
            <SelectItem value="public">Public</SelectItem>
          </SelectPopup>
        </Select>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-foreground">Terminals</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-xs"
            aria-label="Add saved environment terminal"
            onClick={() =>
              setTerminalDrafts([
                ...terminalDrafts,
                {
                  id: nextTerminalDraftId(),
                  name: "",
                  command: "",
                },
              ])
            }
          >
            <PlusIcon className="size-3" />
            Add
          </Button>
        </div>
        {terminalDrafts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Add named commands to keep alongside the start process.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border/70">
            <Table>
              <TableHeader className="bg-muted/25 text-[11px] text-muted-foreground">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Command</TableHead>
                  <TableHead className="w-12 text-right">
                    <span className="sr-only">Options</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {terminalDrafts.map((terminal, index) => (
                  <TableRow
                    key={terminal.id}
                    className="border-border/60 odd:bg-muted/20 even:bg-background/20"
                  >
                    <TableCell>
                      <DraftInput
                        value={terminal.name}
                        onCommit={(name) => updateTerminal(index, terminal.id, { name })}
                        placeholder="web"
                        spellCheck={false}
                        aria-label={`Terminal name ${index + 1}`}
                      />
                    </TableCell>
                    <TableCell>
                      <DraftInput
                        value={terminal.command}
                        onCommit={(command) => updateTerminal(index, terminal.id, { command })}
                        placeholder="pnpm dev"
                        spellCheck={false}
                        aria-label={`Terminal command ${index + 1}`}
                      />
                    </TableCell>
                    <TableCell className="w-12">
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          onClick={() => removeTerminal(index, terminal.id)}
                          aria-label={`Remove terminal ${terminal.name || index + 1}`}
                        >
                          <XIcon className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ProviderEnvironmentSection
        environment={savedEnvironment?.environment ?? []}
        onChange={updateEnvironment}
        title="Repository environment variables"
        description="Apply only when starting a session for this repository (merged on top of the target’s runtime variables)."
      />
    </div>
  );
}
