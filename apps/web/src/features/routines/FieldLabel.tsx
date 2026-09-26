import type { ReactNode } from "react";

export function FieldLabel({
  children,
  htmlFor,
}: {
  readonly children: ReactNode;
  readonly htmlFor: string;
}) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
      {children}
    </label>
  );
}
