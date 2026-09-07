/**
 * Signing a norm version (R3-02, P1-9).
 *
 * The endpoint that moves a version along `draft → reviewed → approved` was there and no screen called it, so
 * a version committed in the browser could never be signed in it and the cycle's second exit criterion — *the
 * norm version moved out of `draft` by a named person* — could not be met. The control sits beside the status
 * on the version list and on the version itself.
 */
import { useState } from "react";
import { errorReading } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { useSetNormStatus } from "@/lib/queries";

/** What a version can be moved to next, and what the control is called; an approved version is signed. */
export const NEXT_STATUS = { draft: { status: "reviewed" as const, label: "Mark reviewed" }, reviewed: { status: "approved" as const, label: "Approve this version" } };

/**
 * Signing a version (R3-02, P1-9): the person who answers for it, and the note the version already carries.
 *
 * A threshold is a decision somebody answers for, so a version cannot leave `draft` without a named person —
 * and the server refuses it while a threshold this version set still carries no rationale or owner. The
 * dialog says so in the server's own words when that happens, rather than failing silently.
 */
export function SignVersion({ projectId, version, onDone }: { projectId: string; version: { id: string; version: number; status: "draft" | "reviewed" | "approved"; note?: string }; onDone: () => void }) {
  const [author, setAuthor] = useState("");
  const sign = useSetNormStatus(projectId);
  const next = NEXT_STATUS[version.status as "draft" | "reviewed"];
  if (!next) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent data-testid="sign-norm">
        <DialogHeader>
          <DialogTitle>
            {next.label} — v{version.version}
          </DialogTitle>
        </DialogHeader>
        <p className="reading text-sm text-text-muted">
          A version is a decision somebody answers for, so leaving a draft needs the name of the person who signs it. The reason this version gives is kept as it is: <em>{version.note || "no note"}</em>.
        </p>
        <Field label="Who signs it" htmlFor="norm-author">
          <Input id="norm-author" required aria-required="true" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="a name or a role" />
        </Field>
        {sign.isError && (
          <p className="reading text-sm text-danger" data-testid="sign-error">
            {errorReading(sign.error).sentence} {errorReading(sign.error).detail}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!author.trim() || sign.isPending}
            onClick={() => sign.mutate({ normVersionId: version.id, status: next.status, author: author.trim() }, { onSuccess: onDone })}
          >
            {sign.isPending ? "Saving…" : next.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

