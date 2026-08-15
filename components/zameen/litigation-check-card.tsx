import { Gavel, ShieldCheck, ShieldQuestion } from "lucide-react"
import type { LitigationCheckResult } from "@/lib/types"

/** Renders the result of the SIMULATED court-cases cross-reference.
 * Three states, same reasoning as TamperCheckRow for why this isn't
 * squeezed into a simple pass/fail: "no_identifiers" (nothing to
 * check), "clear" (checked, no match), "active_case_found" (checked,
 * hit) are genuinely different things to tell the user. */
export function LitigationCheckRow({ result }: { result: LitigationCheckResult }) {
  if (result.status === "no_identifiers") {
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
            <p className="text-sm font-semibold text-white">Litigation Cross-Reference</p>
            <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Not checked
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-zinc-400 text-pretty">
            No CNIC or khasra number was available on this batch to check against court records.
          </p>
        </div>
      </div>
    )
  }

  const isClear = result.status === "clear"

  return (
    <div className="flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.02] p-3">
      <span
        className={
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border " +
          (isClear
            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
            : "border-rose-500/50 bg-rose-500/15 text-rose-300")
        }
        aria-hidden="true"
      >
        {isClear ? <ShieldCheck className="size-4" /> : <Gavel className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-white">Litigation Cross-Reference</p>
          <span
            className={
              "text-[11px] font-medium uppercase tracking-wide " +
              (isClear ? "text-emerald-400" : "text-rose-400")
            }
          >
            {isClear ? "Clear" : "Active Case Found"}
          </span>
          <span
            className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300"
            title="Checked against a demo/simulated court-records table, not a live government feed"
          >
            Simulated
          </span>
        </div>
        {isClear ? (
          <p className="mt-1 text-sm leading-relaxed text-zinc-400 text-pretty">
            No matching entries found in the simulated court-records check.
          </p>
        ) : (
          <div className="mt-1 space-y-1.5">
            {result.matches.map((m) => (
              <p key={m.case_no} className="text-sm leading-relaxed text-zinc-300 text-pretty" dir="auto">
                <span className="font-mono text-xs text-rose-300">{m.case_no}</span>
                {m.case_title && <span className="text-zinc-400"> — {m.case_title}</span>}
                <span className="text-rose-300"> — {m.status_text}</span>
                <span className="text-zinc-500"> (matched on {m.matched_on.join(", ")})</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
