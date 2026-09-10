/**
 * Signing a norm version (R3-02, P1-9).
 *
 * The endpoint that moves a version along `draft → reviewed → approved` was there and no screen called it, so
 * a version committed in the browser could never be signed in it and the cycle's second exit criterion — *the
 * norm version moved out of `draft` by a named person* — could not be met. The control sits beside the status
 * on the version list and on the version itself.
 */
import { useState } from "react";
import { normConstraintNames, normRefusal } from "./normErrors";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { useSetNormStatus } from "@/lib/api/norms";

/** What a version can be moved to next, and what the control is called; an approved version is signed. */
export const NEXT_STATUS = { draft: { status: "reviewed" as const, label: "Mark reviewed" }, reviewed: { status: "approved" as const, label: "Approve this version" } };

/**
 * Signing a version (R3-02, P1-9): the person who answers for it, and the note the version already carries.
 *
 * A threshold is a decision somebody answers for, so a version cannot leave `draft` without a named person —
 * and the server refuses it while a threshold this version set still carries no rationale or owner. The
 * dialog keeps the entered name and shows plain advice when signing is refused.
 */
export function SignVersion({ projectId, version, onDone }: { projectId: string; version: { id: string; version: number; status: "draft" | "reviewed" | "approved"; note?: string; norm?: Record<string, unknown> }; onDone: () => void }) {
  const [author, setAuthor] = useState("");
  const [attempted, setAttempted] = useState(false);
  const authorInvalid = attempted && !author.trim();
  const sign = useSetNormStatus(projectId);
  const detail = normRefusal(sign.error, normConstraintNames(version.norm), "sign");
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
          <Input id="norm-author" required aria-required="true" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name" aria-invalid={authorInvalid || undefined} aria-describedby={authorInvalid ? "norm-author-error" : undefined} className={authorInvalid ? "border-danger ring-1 ring-danger" : undefined} />
          {authorInvalid && <p id="norm-author-error" className="text-xs text-danger">Enter your name to sign this version.</p>}
        </Field>
        {sign.isError && (
          <p role="alert" className="reading text-sm text-danger" data-testid="sign-error">
            This version could not be signed. Your name is still here. {detail}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={sign.isPending}
            onClick={() => {
              setAttempted(true);
              if (!author.trim()) { document.getElementById("norm-author")?.focus(); return; }
              sign.mutate({ normVersionId: version.id, status: next.status, author: author.trim() }, { onSuccess: onDone });
            }}
          >
            {sign.isPending ? "Saving…" : next.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

