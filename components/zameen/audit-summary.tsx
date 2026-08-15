"use client"

import { useState } from "react"
import { CircleX, Download, FileSearch, History, LoaderCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AuditVerification, LandRecord } from "@/lib/types"
import { RiskBadge, riskDescription } from "./risk-badge"
import { RiskBar } from "./risk-bar"
import { CheckRow } from "./check-row"
import { TamperCheckRow } from "./tamper-check-card"
import { EStampCheckCard } from "./estamp-check-card"
import { LitigationCheckRow } from "./litigation-check-card"
import { WarningNotice } from "./warning-notice"

export function AuditSummary({
  records,
  verification,
  documentCount,
  stale,
  warning,
  onDismissWarning,
}: {
  records: LandRecord[]
  verification: AuditVerification
  documentCount: number
  stale: boolean
  warning?: string | null
  onDismissWarning?: () => void
}) {
  const { reasoning, audit_findings, risk_level } = verification
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const checks = [
    {
      label: "Khasra Match",
      passed: verification.khasra_match,
      reasoning: reasoning?.khasra_match,
      show: true,
    },
    {
      label: "Owner / Possession Match",
      passed: verification.owner_possession_match,
      reasoning: reasoning?.owner_possession_match,
      show: true,
    },
    {
      label: "Title Chain Verified",
      passed: !!verification.title_chain_verified,
      reasoning: reasoning?.title_chain_verified,
      show: verification.title_chain_verified !== undefined,
    },
    {
      label: "Area Match",
      passed: !!verification.area_match,
      reasoning: reasoning?.area_match,
      show: verification.area_match !== undefined,
    },
    {
      label: "Encumbrance Free",
      passed: !!verification.encumbrance_free,
      reasoning: reasoning?.encumbrance_free,
      show: verification.encumbrance_free !== undefined,
    },
  ].filter((c) => c.show)

  async function downloadReport() {
    if (isDownloading) return
    setIsDownloading(true)
    setDownloadError(null)
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records, verification }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || "The report could not be generated.")
      }
      const blob = await res.blob()
      const disposition = res.headers.get("Content-Disposition") || ""
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match?.[1] || "ZameenVerify-Report.pdf"

      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : "The report could not be generated.")
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <section
      aria-label="Risk assessment summary"
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-[#121212]/90 shadow-2xl backdrop-blur-xl transition-opacity",
        risk_level === "INVALID" ? "border-red-600/60" : "border-white/10",
        risk_level === "NOT_COMPARABLE" && "border-zinc-500/40",
        stale && "opacity-60",
      )}
    >
      {/* accent bar */}
      <div
        className={cn(
          "h-1 w-full",
          risk_level === "LOW" && "bg-emerald-500",
          risk_level === "MEDIUM" && "bg-amber-500",
          risk_level === "HIGH" && "bg-rose-500",
          risk_level === "INVALID" && "bg-red-600",
          risk_level === "NOT_COMPARABLE" && "bg-zinc-500",
        )}
      />

      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/20">
              <FileSearch className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-white">Risk Assessment</h2>
              <p className="text-sm text-zinc-400">
                {documentCount === 1 ? "Document audit across 1 document" : `Cross-document audit across ${documentCount} documents`}
              </p>
            </div>
          </div>
          <RiskBadge level={risk_level} size="lg" />
        </div>

        <p className="mt-4 text-sm text-zinc-400 text-pretty">{riskDescription(risk_level)}</p>

        {/* Horizontal glassmorphic risk bar */}
        <div className="mt-5">
          <RiskBar level={risk_level} />
        </div>

        {/* Download report */}
        <div className="mt-5">
          <button
            type="button"
            onClick={downloadReport}
            disabled={isDownloading}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] py-2.5 text-sm font-medium text-zinc-200 transition-all duration-300",
              "hover:border-white/25 hover:text-white hover:shadow-[0_0_18px_rgba(255,255,255,0.08)]",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {isDownloading ? (
              <>
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                Generating report…
              </>
            ) : (
              <>
                <Download className="size-4" aria-hidden="true" />
                Download Audit Report (PDF)
              </>
            )}
          </button>
          {downloadError && (
            <div
              role="alert"
              className="mt-2 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
            >
              <CircleX className="mt-0.5 size-3.5 shrink-0 text-rose-400" aria-hidden="true" />
              <span className="text-pretty">{downloadError}</span>
            </div>
          )}
        </div>

        {stale && (
          <div className="mt-4 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300">
            <History className="size-4 shrink-0" aria-hidden="true" />
            The batch changed after this audit ran — re-run the audit for an up-to-date result.
          </div>
        )}

        {warning && (
          <div className="mt-4">
            <WarningNotice message={warning} onDismiss={onDismissWarning} />
          </div>
        )}

        {/* Verification checks */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {checks.map((c) => (
            <CheckRow key={c.label} label={c.label} passed={c.passed} reasoning={c.reasoning} />
          ))}
        </div>

        {/* Simulated registry tamper check — kept outside the grid,
            full-width, since its "not checked" state and Simulated
            label need more room than the two-column grid gives the
            other checks. */}
        {verification.tamper_check && (
          <div className="mt-3">
            <TamperCheckRow result={verification.tamper_check} />
          </div>
        )}

        {/* e-Stamp serial validation — only rendered when there's an
            actual finding to show (see EStampCheckCard for why there's
            no separate "all clear" state). */}
        {verification.e_stamp_check && (
          <div className="mt-3">
            <EStampCheckCard result={verification.e_stamp_check} />
          </div>
        )}

        {/* Simulated litigation cross-reference */}
        {verification.litigation_check && (
          <div className="mt-3">
            <LitigationCheckRow result={verification.litigation_check} />
          </div>
        )}

        {/* Findings */}
        {audit_findings.length > 0 && (
          <div className="mt-5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Audit Findings
            </h3>
            <ul className="mt-2 space-y-2">
              {audit_findings.map((finding, i) => (
                <li
                  key={i}
                  className="flex gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-sm leading-relaxed text-zinc-300"
                >
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
                  <span className="text-pretty">{finding}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
