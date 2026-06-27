import { memo, useEffect, useState } from "react";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { ChevronDownIcon, CircleAlertIcon, XIcon } from "lucide-react";
import { cn } from "~/lib/utils";

const ERROR_EXPAND_THRESHOLD = 180;

function shouldOfferErrorDetails(error: string): boolean {
  return error.length > ERROR_EXPAND_THRESHOLD || error.includes("\n");
}

export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  threadId,
  onDismiss,
}: {
  error: string | null;
  threadId?: string;
  onDismiss?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Reset the expander when the error text or the active thread changes, so
  // switching to another thread with the same error doesn't preserve the old
  // expanded/collapsed state.
  useEffect(() => {
    setExpanded(false);
  }, [error, threadId]);

  if (!error) return null;

  const canExpand = shouldOfferErrorDetails(error);

  return (
    <div className="w-full px-3 pt-3 sm:px-5">
      <div className="mx-auto w-full max-w-3xl">
        <Alert variant="error">
          <CircleAlertIcon />
          <AlertDescription className="min-w-0 text-destructive-foreground/80">
            <div
              className={cn(
                "break-words whitespace-pre-wrap",
                canExpand && !expanded && "line-clamp-3",
              )}
            >
              {error}
            </div>
            {canExpand ? (
              <button
                aria-expanded={expanded}
                className="mt-1 inline-flex cursor-pointer items-center gap-1 rounded-md py-0.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setExpanded((value) => !value)}
                type="button"
              >
                <ChevronDownIcon
                  aria-hidden
                  className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")}
                />
                {expanded ? "Hide details" : "Show details"}
              </button>
            ) : null}
          </AlertDescription>
          {onDismiss ? (
            <AlertAction>
              <Button variant="ghost" size="icon-xs" aria-label="Dismiss error" onClick={onDismiss}>
                <XIcon className="text-destructive" />
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      </div>
    </div>
  );
});
