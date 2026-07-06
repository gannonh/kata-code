/**
 * `ProviderSignInDialog` — interactive "Sign in <provider>" flow for a running
 * sandbox session. Drives `client.sandbox.providerLoginStart` (stream) on mount
 * and `providerLoginSubmitCode` on submit. States: starting -> url shown ->
 * code input -> submitting -> success | invalid-code | error.
 *
 * V1 targets Claude (AC-3b.11). The provider list is hardcoded client-side
 * pending the maintainer-local spike UAT that confirms the login command.
 *
 * @module ProviderSignInDialog
 */
import { useEffect, useState } from "react";

import { getPrimaryEnvironmentConnection } from "../../environments/runtime/service";
import { Dialog, DialogClose, DialogFooter, DialogPopup, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { toastManager } from "../ui/toast";

interface ProviderSignInDialogProps {
  readonly instanceId: string;
  readonly providerId: string;
  readonly onClose: () => void;
}

type Stage = "starting" | "awaiting-url" | "awaiting-code" | "submitting" | "done";

export function ProviderSignInDialog({
  instanceId,
  providerId,
  onClose,
}: ProviderSignInDialogProps) {
  const [stage, setStage] = useState<Stage>("starting");
  const [url, setUrl] = useState<string | null>(null);
  const [loginSessionId, setLoginSessionId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getPrimaryEnvironmentConnection()
      .client.sandbox.providerLoginStart(
        { instanceId: instanceId as never, providerId: providerId as never },
        (event) => {
          if (cancelled) return;
          switch (event.stage) {
            case "started":
              setLoginSessionId(event.loginSessionId);
              setStage("awaiting-url");
              break;
            case "url":
              setUrl(event.url);
              setStage("awaiting-code");
              break;
            case "awaiting-code":
              setStage("awaiting-code");
              break;
            case "error":
              setError(event.message);
              setStage("done");
              break;
          }
        },
      )
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Sign-in failed.");
        setStage("done");
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId, providerId, onClose]);

  const handleSubmit = async () => {
    if (loginSessionId === null) return;
    setStage("submitting");
    setError(null);
    try {
      const result = await getPrimaryEnvironmentConnection().client.sandbox.providerLoginSubmitCode(
        {
          instanceId: instanceId as never,
          loginSessionId: loginSessionId as never,
          code: code as never,
        },
      );
      if (result.accepted) {
        setStage("done");
        toastManager.add({
          type: "success",
          title: "Credential stored",
          description: "Credential stored for future deployments.",
        });
        onClose();
      } else {
        setError("Invalid code. Try again.");
        setStage("awaiting-code");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed.");
      setStage("awaiting-code");
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-lg overflow-hidden">
        <DialogTitle>Sign in {providerId}</DialogTitle>
        <div className="flex flex-col gap-3 p-4">
          {stage === "starting" ? (
            <p className="text-xs text-muted-foreground">Starting sign-in…</p>
          ) : null}
          {url ? (
            <div className="flex flex-col gap-1">
              <Label>OAuth URL</Label>
              <div className="flex items-center gap-2">
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-600 underline"
                >
                  Open sign-in page
                </a>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigator.clipboard.writeText(url).catch(() => undefined)}
                >
                  Copy URL
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Complete sign-in, then paste the code below.
              </p>
            </div>
          ) : null}
          {stage === "awaiting-code" || stage === "submitting" ? (
            <div className="flex flex-col gap-1">
              <Label htmlFor="sandbox-signin-code">Code</Label>
              <Input
                id="sandbox-signin-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                spellCheck={false}
              />
            </div>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          {stage === "awaiting-code" || stage === "submitting" ? (
            <Button
              onClick={() => void handleSubmit()}
              disabled={stage === "submitting" || code.trim().length === 0}
            >
              {stage === "submitting" ? "Submitting…" : "Submit code"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
