import { ShieldCheck, ShieldAlert, TriangleAlert, CircleX } from "lucide-react"
import { cn } from "@/lib/utils"
import type { RiskLevel } from "@/lib/types"

const CONFIG: Record<
  RiskLevel,
  { label: string; icon: typeof ShieldCheck; className: string; description: string }
> = {
  LOW: {
    label: "Low Risk",
    icon: ShieldCheck,
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    description: "No material red flags detected across the batch.",
  },
  MEDIUM: {
    label: "Medium Risk",
    icon: ShieldAlert,
    className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    description: "Some inconsistencies warrant manual review.",
  },
  HIGH: {
    label: "High Risk",
    icon: TriangleAlert,
    className: "border-rose-500/40 bg-rose-500/10 text-rose-300",
    description: "Significant discrepancies suggest elevated fraud risk.",
  },
  INVALID: {
    label: "Invalid — Do Not Proceed",
    icon: CircleX,
    className:
      "border-red-600 bg-red-600 text-white shadow-[0_0_0_1px_rgba(220,38,38,0.6),0_8px_24px_-8px_rgba(220,38,38,0.7)] ring-2 ring-red-600/50",
    description: "Records fail basic validity checks. Reject these documents.",
  },
  NOT_COMPARABLE: {
    label: "Not Comparable",
    icon: ShieldAlert,
    className: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
    description: "These documents don't appear to describe the same property — no fraud comparison could be meaningfully performed.",
  },
}

export function RiskBadge({
  level,
  size = "md",
  className,
}: {
  level: RiskLevel
  size?: "sm" | "md" | "lg"
  className?: string
}) {
  const config = CONFIG[level]
  const Icon = config.icon
  const isInvalid = level === "INVALID"

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-md border font-semibold uppercase tracking-wide",
        size === "sm" && "px-2 py-0.5 text-[11px]",
        size === "md" && "px-3 py-1 text-xs",
        size === "lg" && "px-4 py-2 text-sm",
        isInvalid && "tracking-widest",
        config.className,
        className,
      )}
    >
      <Icon className={cn(size === "lg" ? "size-5" : "size-4", "shrink-0")} aria-hidden="true" />
      {config.label}
    </span>
  )
}

export function riskDescription(level: RiskLevel) {
  return CONFIG[level].description
}
