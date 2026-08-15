// app/verify/[reportId]/page.tsx
//
// Resolves the "Scan to verify" QR code printed on the generated audit
// report PDF (see lib/report-generator.ts). Looks up the snapshot that
// /api/report persists into `verification_reports` at generation time
// and renders a read-only confirmation of what that report said.
//
// This is a snapshot lookup, not a live query against `land_records`/
// `verifications` — a scanned report should keep showing what the PDF
// said at the moment it was generated, the same way a physical stamped
// document doesn't retroactively change if the underlying case file is
// later edited or deleted.

import { createClient } from "@supabase/supabase-js"
import { ShieldCheck, FileWarning } from "lucide-react"
import { RiskBadge } from "@/components/zameen/risk-badge"
import { DOCUMENT_TYPE_LABELS, type LandRecord, type AuditVerification, type RiskLevel } from "@/lib/types"

export const dynamic = "force-dynamic"

interface VerificationReportRow {
  report_id: string
  generated_at: string
  records: LandRecord[]
  verification: AuditVerification
}

async function getReport(reportId: string): Promise<VerificationReportRow | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const { data, error } = await supabase
    .from("verification_reports")
    .select("report_id, generated_at, records, verification")
    .eq("report_id", reportId)
    .single()

  if (error || !data) return null
  return data as VerificationReportRow
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      dateStyle: "long",
      timeStyle: "short",
    })
  } catch {
    return iso
  }
}

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ reportId: string }>
}) {
  const { reportId } = await params
  const report = await getReport(reportId)

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0B0B0C] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 28%, rgba(226, 185, 109, 0.15), rgba(226, 185, 109, 0.04) 45%, transparent 70%)",
          filter: "blur(60px)",
        }}
      />

      <div className="relative mx-auto max-w-2xl px-4 py-14 sm:px-6">
        <div className="mb-10 text-center">
          <span className="font-serif text-xl italic tracking-tight text-white">
            Zameen<span className="text-amber-200/90">Verify</span>
          </span>
          <p className="mt-1 text-xs uppercase tracking-widest text-zinc-500">Report Verification</p>
        </div>

        {report ? (
          <div className="rounded-2xl border border-white/10 bg-[#1A1A1A]/70 p-6 backdrop-blur-sm sm:p-8">
            <div className="flex items-center gap-2 text-emerald-400">
              <ShieldCheck className="size-5 shrink-0" aria-hidden="true" />
              <span className="text-sm font-medium">This is a valid ZameenVerify report</span>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
              <div>
                <p className="font-mono text-sm text-zinc-300">{report.report_id}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Generated {formatDate(report.generated_at)}
                </p>
              </div>
              <RiskBadge level={report.verification.risk_level as RiskLevel} size="md" />
            </div>

            {Array.isArray(report.verification.audit_findings) &&
              report.verification.audit_findings.length > 0 && (
                <div className="mt-6 border-t border-white/10 pt-5">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Findings
                  </p>
                  <ul className="space-y-1.5 text-sm text-zinc-300">
                    {report.verification.audit_findings.map((f, i) => (
                      <li key={i} className="text-pretty">
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            <div className="mt-6 border-t border-white/10 pt-5">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Documents in this report ({report.records.length})
              </p>
              <ul className="space-y-1.5 text-sm text-zinc-400">
                {report.records.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3">
                    <span>{DOCUMENT_TYPE_LABELS[r.document_type] ?? "Document"}</span>
                    <span className="truncate text-zinc-500">
                      {r.owner_name || r.buyer_name || r.district || "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-6 border-t border-white/10 pt-5 text-xs text-zinc-600">
              This page confirms only that this report was generated by ZameenVerify and has not
              been altered. It is a due-diligence aid — always confirm findings against the
              official record at the relevant Arazi Record Center before relying on them.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-[#1A1A1A]/70 p-6 text-center backdrop-blur-sm sm:p-8">
            <FileWarning className="mx-auto size-8 text-zinc-500" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-white">Report not found</p>
            <p className="mt-1.5 text-xs text-zinc-500">
              We couldn&apos;t find a report matching{" "}
              <span className="font-mono text-zinc-400">{reportId}</span>. It may have been
              generated before verification tracking was enabled, or the ID may be incorrect.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
