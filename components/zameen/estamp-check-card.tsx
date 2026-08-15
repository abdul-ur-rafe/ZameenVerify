import { FileWarning, Copy, AlertTriangle } from "lucide-react"
import type { EStampCheckResult } from "@/lib/types"

/** Renders e-Stamp serial validation findings. Only rendered at all
 * when e_stamp_check is present (i.e. at least one finding exists) —
 * unlike TamperCheckRow, there is no "checked and clean" state to
 * show, since a batch with no registry documents and no e-Stamp
 * numbers simply has nothing for this check to report; the "Encumbrance
 * Free" style all-clear badge doesn't apply here the same way, so we
 * only surface this card when there's something worth telling the user
 * about (missing/duplicate/suspicious), keeping it out of the way
 * otherwise. */
export function EStampCheckCard({ result }: { result: EStampCheckResult }) {
  const hasDuplicates = result.duplicate_across_batch.length > 0
  const hasMissing = result.missing_on.length > 0
  const hasFormatWarnings = result.format_warnings.length > 0

  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center gap-2">
        <FileWarning className="size-4 text-amber-400" aria-hidden="true" />
        <p className="text-sm font-semibold text-white">e-Stamp Serial Validation</p>
      </div>

      <div className="mt-2 space-y-2 text-sm">
        {hasDuplicates && (
          <div className="rounded border border-rose-500/30 bg-rose-500/5 p-2">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-rose-400">
              <Copy className="size-3.5" aria-hidden="true" />
              Duplicate serial — real finding
            </p>
            {result.duplicate_across_batch.map((dup) => (
              <p key={dup.token} className="mt-1 text-zinc-300" dir="auto">
                <span className="font-mono text-xs">{dup.token}</span> appears on{" "}
                {dup.recordLabels.join(", ")} — one e-Stamp paper cannot legitimately back two
                transactions.
              </p>
            ))}
          </div>
        )}

        {hasMissing && (
          <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2">
            <p className="text-xs font-medium uppercase tracking-wide text-amber-400">
              Missing serial — completeness gap
            </p>
            <p className="mt-1 text-zinc-300" dir="auto">
              {result.missing_on.join(", ")} — registry document(s) with no e-Stamp number found.
            </p>
          </div>
        )}

        {hasFormatWarnings && (
          <div className="rounded border border-white/10 bg-white/[0.02] p-2">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              Format sanity check — not a verified format
            </p>
            {result.format_warnings.map((w) => (
              <p key={w.token} className="mt-1 text-zinc-400" dir="auto">
                <span className="font-mono text-xs">{w.token}</span> on {w.recordLabel} —{" "}
                {w.reason}. This is a generic plausibility check, not validation against the real
                Punjab e-Stamp format (no public specification exists to check against).
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
