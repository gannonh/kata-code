import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { projectColorClass } from "../Sidebar.logic";

export interface SidebarProjectPickerOption {
  projectKey: string;
  displayName: string;
  threadCount: number;
}

interface SidebarProjectPickerProps {
  projects: readonly SidebarProjectPickerOption[];
  selectedProjectKey: string | null;
  onSelect: (projectKey: string | null) => void;
}

export const SidebarProjectPicker = memo(function SidebarProjectPicker(
  props: SidebarProjectPickerProps,
) {
  const { projects, selectedProjectKey, onSelect } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const selected = selectedProjectKey
    ? (projects.find((project) => project.projectKey === selectedProjectKey) ?? null)
    : null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleToggle = useCallback(() => {
    setOpen((current) => !current);
  }, []);

  const handleSelectAll = useCallback(() => {
    onSelect(null);
    setOpen(false);
  }, [onSelect]);

  const handleSelectProject = useCallback(
    (projectKey: string) => {
      onSelect(projectKey);
      setOpen(false);
    },
    [onSelect],
  );

  const handleClear = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect(null);
      setOpen(false);
    },
    [onSelect],
  );

  return (
    <div className="sb-picker-bar" ref={rootRef} data-testid="sidebar-project-picker">
      <button
        type="button"
        className={`sb-picker-btn${open ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        data-testid="sidebar-project-picker-trigger"
        onClick={handleToggle}
      >
        {selected ? (
          <>
            <span className={`sb-pdot ${projectColorClass(selected.projectKey)}`} />
            <span className="min-w-0 truncate">{selected.displayName}</span>
            <span
              className="sb-clear"
              onClick={handleClear}
              data-testid="sidebar-project-picker-clear"
            >
              Clear
            </span>
          </>
        ) : (
          <>
            <span>All projects</span>
            <span className="sb-chev">▾</span>
          </>
        )}
        {selected ? null : null}
      </button>
      <div
        id={menuId}
        role="listbox"
        className={`sb-picker-menu${open ? " open" : ""}`}
        data-testid="sidebar-project-picker-menu"
      >
        <button
          type="button"
          role="option"
          aria-selected={selectedProjectKey === null}
          className={`sb-picker-item${selectedProjectKey === null ? " active" : ""}`}
          data-testid="sidebar-project-picker-all"
          onClick={handleSelectAll}
        >
          All projects
          <span className="sb-pc">
            {projects.reduce((sum, project) => sum + project.threadCount, 0)}
          </span>
        </button>
        {projects.map((project) => (
          <button
            key={project.projectKey}
            type="button"
            role="option"
            aria-selected={selectedProjectKey === project.projectKey}
            className={`sb-picker-item${selectedProjectKey === project.projectKey ? " active" : ""}`}
            data-testid={`sidebar-project-picker-item-${project.projectKey}`}
            onClick={() => {
              handleSelectProject(project.projectKey);
            }}
          >
            <span className={`sb-pdot ${projectColorClass(project.projectKey)}`} />
            <span className="min-w-0 truncate">{project.displayName}</span>
            <span className="sb-pc">{project.threadCount}</span>
          </button>
        ))}
      </div>
    </div>
  );
});
