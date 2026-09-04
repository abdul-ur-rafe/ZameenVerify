import { ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react"
import { cn } from "@/lib/utils"
import type { TamperCheckResult } from "@/lib/types"

export function TamperCheckRow({ result }: { result: TamperCheckResult }) {
  // Completely hide/disable this check component
  return null

  if (result.status === "no_token") {
    return (
      <div className="flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.02] p-3">
        <span
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-zinc-500/40 bg-zinc-500/10 text-zinc-400"
          aria-hidden="true"
        >
          <ShieldQuestion className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white">Registry Tamper Check</p>
            <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Not checked
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400 text-pretty">
            No verification token was found on this document, so no registry cross-check could be
            attempted. This is not a pass or a fail — the document simply has no token field to
            check.
          </p>
        </div>
      </div>
    )
  }

  const passed = result.status === "match"

  return (
    <div className="flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.02] p-3">
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
          passed
            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
            : "border-rose-500/50 bg-rose-500/15 text-rose-300",
        )}
        aria-hidden="true"
      >
        {passed ? <ShieldCheck className="size-4" /> : <ShieldAlert className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-white">Registry Tamper Check</p>
          <span
            className={cn(
              "text-[11px] font-medium uppercase tracking-wide",
              passed ? "text-emerald-400" : "text-rose-400",
            )}
          >
            {passed ? "Pass" : "Fail"}
          </span>
          <span
            className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300"
            title="Checked against a demo/simulated registry table, not a live PLRA government feed"
          >
            Simulated
          </span>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-zinc-400 text-pretty" dir="auto">
          {result.status === "not_found" &&
            `Token "${result.token}" was not found in the simulated registry. This may mean the token is invalid, or simply isn't in this demo dataset — it is not by itself proof of tampering.`}
          {result.status === "mismatch" &&
            `Token "${result.token}" was found, but document data disagrees with the registry snapshot: ${result.mismatched_fields?.join("; ")}.`}
          {result.status === "match" &&
            `Token "${result.token}" matches the simulated registry snapshot on all compared fields.`}
        </p>
      </div>
    </div>
  )
}