"use client"

import { motion } from "framer-motion"
import { CheckCircle2, AlertTriangle } from "lucide-react"
import {
  type BatchItem,
  DOCUMENT_TYPE_LABELS,
  FIELD_LABELS,
  LOW_CONFIDENCE_THRESHOLD,
  type LandRecord,
} from "@/lib/types"

function hasValue(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0
}

/** Short document-type tag shown in the amber category chip. */
const TYPE_TAG: Record<string, string> = {
  FARD_MALKIAT: "FARD",
  KHASRA_GIRDAWARI: "KHASRA",
  INTEQAL: "INTIQAL",
  AKS_SHAJRA_REGISTRY: "REGISTRY",
  OTHER: "DOC",
}

/** Fields, in priority order, that make a good one-line human summary
 * of what this document is about. We show the first 2-3 that exist. */
const SUMMARY_FIELDS: (keyof LandRecord)[] = [
  "owner_name",
  "buyer_name",
  "seller_name",
  "transferee_name",
  "khasra_no",
  "khewat_no",
  "mutation_no",
  "district",
  "total_area",
]

function buildSummary(record: LandRecord): { label: string; value: string; field: keyof LandRecord }[] {
  const out: { label: string; value: string; field: keyof LandRecord }[] = []
  for (const f of SUMMARY_FIELDS) {
    if (out.length >= 3) break
    if (hasValue(record[f])) {
      out.push({ label: FIELD_LABELS[f] ?? String(f), value: record[f] as string, field: f })
    }
  }
  return out
}

/** True if this record has at least one field whose confidence is
 * below LOW_CONFIDENCE_THRESHOLD. Only meaningful for
 * ingestion_mode "legacy" — standard-mode records never carry
 * field_confidence, so this is always false for them, which is
 * correct: there is no partial-confidence state to warn about on a
 * typed document that either read clearly or came back blank. */
function hasLowConfidenceField(record: LandRecord): boolean {
  if (record.ingestion_mode !== "legacy" || !record.field_confidence) return false
  return Object.values(record.field_confidence).some(
    (c) => typeof c === "number" && c < LOW_CONFIDENCE_THRESHOLD
  )
}

export function DocumentCard({ item, index }: { item: BatchItem; index: number }) {
  const { record, fileName } = item
  const tag = TYPE_TAG[record.document_type] ?? "DOC"
  const summary = buildSummary(record)
  const isLegacy = record.ingestion_mode === "legacy"
  const needsReview = hasLowConfidenceField(record)

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.35, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-xl border p-3.5 backdrop-blur-sm transition-colors ${
        needsReview
          ? "border-amber-500/30 bg-amber-950/10 hover:border-amber-500/50"
          : "border-white/10 bg-[#1A1A1A]/70 hover:border-amber-500/25"
      }`}
    >
      {/* Top row: category tag + filename */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 font-mono text-xs text-amber-300">
          {tag}
        </span>
        <span className="truncate text-sm font-medium text-white" title={fileName}>
          {fileName}
        </span>
        {isLegacy && (
          <span
            className="shrink-0 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400"
            title="Processed via handwritten/legacy document pipeline"
          >
            Legacy
          </span>
        )}
      </div>

      {/* Middle: inline extracted-field summary. Low-confidence values
          (legacy mode only) are shown with a distinct color and a
          tooltip rather than looking identical to a confidently-read
          value — presenting an uncertain guess with the same visual
          weight as a confident one is exactly the failure mode this
          feature exists to avoid. */}
      <p className="mt-2.5 truncate text-xs text-zinc-400">
        {summary.length > 0
          ? summary.map((s, i) => {
              const conf = record.field_confidence?.[s.field]
              const isLow = isLegacy && typeof conf === "number" && conf < LOW_CONFIDENCE_THRESHOLD
              return (
                <span key={s.label}>
                  {i > 0 && <span className="mx-1.5 text-zinc-600">•</span>}
                  <span className="text-zinc-500">{s.label}:</span>{" "}
                  <span
                    className={isLow ? "text-amber-400" : "text-zinc-300"}
                    title={isLow ? `Low confidence (${Math.round((conf as number) * 100)}%) — verify against source` : undefined}
                  >
                    {s.value}
                    {isLow && <span className="ml-1 text-[10px]">⚠</span>}
                  </span>
                </span>
              )
            })
          : DOCUMENT_TYPE_LABELS[record.document_type] ?? "Extracted document"}
      </p>

      {/* Bottom: status indicator */}
      <div className="mt-3 flex items-center gap-1.5 text-xs">
        {needsReview ? (
          <>
            <AlertTriangle className="size-3.5 shrink-0 text-amber-400" aria-hidden="true" />
            <span className="text-amber-400">Some fields need verification</span>
          </>
        ) : (
          <>
            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
            <span className="text-emerald-400">Parsed &amp; Loaded</span>
          </>
        )}
      </div>
    </motion.article>
  )
}
