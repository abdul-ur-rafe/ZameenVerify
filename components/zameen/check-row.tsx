import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"

export function CheckRow({
  label,
  passed,
  reasoning,
}: {
  label: string
  passed: boolean
  reasoning?: string
}) {
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
        {passed ? <Check className="size-4" /> : <X className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-white">{label}</p>
          <span
            className={cn(
              "text-[11px] font-medium uppercase tracking-wide",
              passed ? "text-emerald-400" : "text-rose-400",
            )}
          >
            {passed ? "Pass" : "Fail"}
          </span>
        </div>
        {reasoning && (
          <p className="mt-1 text-sm leading-relaxed text-zinc-400 text-pretty">{reasoning}</p>
        )}
      </div>
    </div>
  )
}
