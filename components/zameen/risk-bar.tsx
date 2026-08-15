"use client"

import type { RiskLevel } from "@/lib/types"

/** The bar also supports a "not comparable" outcome, where every
 * segment is dimmed because no meaningful risk read is possible. */
export type RiskBarLevel = RiskLevel | "NOT_COMPARABLE"

const COLORS = {
  LOW: "#10B981",
  MEDIUM: "#E2B96D",
  HIGH: "#EF4444",
} as const

const DIM = "rgba(255, 255, 255, 0.1)"

/** How many of the three segments light up, and in which color.
 * Fill is cumulative — Medium lights the first two, High lights all
 * three — so the bar reads like a rising severity gauge. */
function gauge(level: RiskBarLevel): { filled: number; color: string; label: string } {
  switch (level) {
    case "LOW":
      return { filled: 1, color: COLORS.LOW, label: "LOW" }
    case "MEDIUM":
      return { filled: 2, color: COLORS.MEDIUM, label: "MEDIUM" }
    case "HIGH":
      return { filled: 3, color: COLORS.HIGH, label: "HIGH" }
    case "INVALID":
      return { filled: 3, color: COLORS.HIGH, label: "INVALID" }
    case "NOT_COMPARABLE":
      return { filled: 0, color: "#71717a", label: "NOT COMPARABLE" }
    default:
      return { filled: 0, color: "#71717a", label: "UNKNOWN" }
  }
}

export function RiskBar({ level }: { level: RiskBarLevel }) {
  const { filled, color, label } = gauge(level)

  return (
    <div className="w-full">
      {/* Status label — color matches the active glowing segment */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Overall Title Risk</span>
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color, textShadow: `0 0 12px ${color}80` }}
        >
          {label}
        </span>
      </div>

      {/* Glassmorphic pill divided into three continuous segments */}
      <div
        className="flex h-3 w-full gap-1 overflow-hidden rounded-full border p-[3px]"
        style={{
          background: "rgba(255, 255, 255, 0.05)",
          borderColor: "rgba(255, 255, 255, 0.1)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
        role="img"
        aria-label={`Overall title risk: ${label}`}
      >
        {[0, 1, 2].map((i) => {
          const isActive = i < filled
          return (
            <div
              key={i}
              className="h-full flex-1 rounded-full transition-all duration-500"
              style={{
                background: isActive ? color : DIM,
                boxShadow: isActive ? `0 0 16px 1px ${color}, 0 0 4px ${color}` : "none",
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
