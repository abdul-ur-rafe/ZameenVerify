"use client"

import { useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { CircleX, FileUp, LoaderCircle, ScanLine, Sparkles, X } from "lucide-react"
import {
  type AuditResponse,
  type BatchItem,
  type ExtractResponse,
  type FileError,
  type PendingFile,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import { CopilotDrawer } from "./copilot-drawer"
import { Uploader } from "./uploader"
import { DocumentCard } from "./document-card"
import { AuditSummary } from "./audit-summary"

const MAX_FILES = 4

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

export function AuditWorkbench() {
  const [batch, setBatch] = useState<BatchItem[]>([])
  const [pending, setPending] = useState<PendingFile[]>([])
  const [errors, setErrors] = useState<FileError[]>([])
  // Which ingestion pipeline new uploads go through. This is a
  // per-upload-session choice, not per-file — mixing modes within one
  // batch is allowed (each record remembers its own ingestion_mode),
  // but the user picks one pipeline at a time rather than the app
  // trying to auto-detect handwritten vs. typed, which isn't a
  // judgment call worth making silently on the user's behalf.
  const [ingestionMode, setIngestionMode] = useState<"standard" | "legacy">("standard")

  const [audit, setAudit] = useState<AuditResponse | null>(null)
  const [auditWarning, setAuditWarning] = useState<string | null>(null)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [auditSnapshot, setAuditSnapshot] = useState<string | null>(null)
  const [isAuditing, setIsAuditing] = useState(false)

  const signature = useMemo(() => JSON.stringify(batch.map((b) => b.record)), [batch])
  const auditStale = audit !== null && auditSnapshot !== null && auditSnapshot !== signature

  const used = batch.length + pending.length
  const remaining = Math.max(0, MAX_FILES - used)
  const hasContent = used > 0 || errors.length > 0

  async function processFiles(files: File[]) {
    const room = Math.max(0, MAX_FILES - (batch.length + pending.length))
    const accepted = files.slice(0, room)
    if (accepted.length === 0) return

    const queued: PendingFile[] = accepted.map((f) => ({
      key: uid(),
      fileName: f.name,
      status: "queued",
    }))
    setPending((prev) => [...prev, ...queued])

    for (let i = 0; i < accepted.length; i++) {
      const file = accepted[i]
      const { key } = queued[i]
      setPending((prev) => prev.map((p) => (p.key === key ? { ...p, status: "reading" } : p)))

      try {
        const formData = new FormData()
        formData.append("file", file)
        const endpoint = ingestionMode === "legacy" ? "/api/extract-legacy" : "/api/extract"
        const res = await fetch(endpoint, { method: "POST", body: formData })
        const data: ExtractResponse = await res.json()

        if (!res.ok || !data.success || !data.record) {
          throw new Error(data.error || "The document could not be read. Please try a clearer scan.")
        }

        const record = data.record
        setBatch((prev) => [
          ...prev,
          {
            key: uid(),
            fileName: file.name,
            record,
            warning: data.persisted
              ? null
              : data.warning || "Document was read successfully, but could not be saved to the database.",
          },
        ])
      } catch (e) {
        setErrors((prev) => [
          ...prev,
          {
            key: uid(),
            fileName: file.name,
            error: e instanceof Error ? e.message : "Could not process this file.",
          },
        ])
      } finally {
        setPending((prev) => prev.filter((p) => p.key !== key))
      }
    }
  }

  function dismissError(key: string) {
    setErrors((prev) => prev.filter((e) => e.key !== key))
  }

  function clearBatch() {
    setBatch([])
    setPending([])
    setErrors([])
    setAudit(null)
    setAuditWarning(null)
    setAuditError(null)
    setAuditSnapshot(null)
  }

  async function runAudit() {
    if (batch.length === 0) return
    setIsAuditing(true)
    setAuditError(null)
    try {
      const res = await fetch("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: batch.map((b) => b.record) }),
      })
      const data: AuditResponse = await res.json()

      if (!res.ok || !data.success || !data.verification) {
        throw new Error(data.error || "The audit could not be completed. Please try again.")
      }

      setAudit(data)
      setAuditWarning(
        data.persisted
          ? null
          : data.warning || "Audit completed, but the result could not be saved to the database.",
      )
      setAuditSnapshot(JSON.stringify(batch.map((b) => b.record)))
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : "The audit could not be completed.")
    } finally {
      setIsAuditing(false)
    }
  }

  const isBusy = pending.length > 0
  const canAudit = batch.length > 0 && !isAuditing && !isBusy

  return (
    <div className="space-y-6">
      {/* Risk assessment summary — surfaced above the workspace once available */}
      <AnimatePresence>
        {audit?.verification && (
          <motion.div
            key="audit"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto w-full max-w-3xl"
          >
            <AuditSummary
            records={batch.map((b) => b.record)}
            verification={audit.verification}
            documentCount={audit.document_count || batch.length}
            stale={auditStale}
            warning={auditWarning}
            onDismissWarning={() => setAuditWarning(null)}
          />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Central glassmorphic workspace */}
      <div
        className="mx-auto w-full max-w-3xl rounded-2xl border border-white/10 p-6 shadow-2xl"
        style={{
          background: "rgba(15, 15, 15, 0.6)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        {/* Workspace header */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="flex size-7 items-center justify-center rounded-md bg-amber-500/10 font-mono text-xs font-semibold text-amber-200/90 ring-1 ring-amber-500/20">
              {batch.length}
            </span>
            <span className="text-zinc-400">
              {used === 0
                ? "No documents yet"
                : `${batch.length}/${MAX_FILES} document${batch.length === 1 ? "" : "s"} loaded`}
              {isBusy && " · reading…"}
            </span>
          </div>
          {hasContent && (
            <button
              type="button"
              onClick={clearBatch}
              className="text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-200"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Ingestion mode toggle. Placed above the uploader since it
            affects how the NEXT upload is processed — changing it
            after documents are already loaded doesn't retroactively
            reprocess them, so it's positioned where it's read before
            the action it affects, not buried in a settings area. */}
        <div className="mb-4 flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1 text-xs">
          <button
            type="button"
            onClick={() => setIngestionMode("standard")}
            disabled={isBusy}
            className={cn(
              "flex-1 rounded-md px-3 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              ingestionMode === "standard"
                ? "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/30"
                : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            Typed / Computerized
            <span className="ml-1.5 hidden text-zinc-500 sm:inline">— PLRA records</span>
          </button>
          <button
            type="button"
            onClick={() => setIngestionMode("legacy")}
            disabled={isBusy}
            className={cn(
              "flex-1 rounded-md px-3 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              ingestionMode === "legacy"
                ? "bg-amber-500/15 text-amber-200 ring-1 ring-amber-500/30"
                : "text-zinc-400 hover:text-zinc-200",
            )}
          >
            Handwritten / Legacy
            <span className="ml-1.5 hidden text-zinc-500 sm:inline">— Urdu Nastaliq, manual registers</span>
          </button>
        </div>
        {ingestionMode === "legacy" && used === 0 && (
          <p className="mb-4 text-xs text-zinc-500">
            Runs through OpenCV scan cleanup + a handwriting-aware reading pass. Uncertain fields
            are flagged with a confidence score for your review rather than presented as certain.
          </p>
        )}

        {/* EMPTY STATE — dropzone */}
        {used === 0 ? (
          <Uploader onFiles={processFiles} remaining={remaining} disabled={isBusy} />
        ) : (
          /* LOADED STATE — grid of metadata cards */
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <AnimatePresence mode="popLayout">
              {batch.map((item, index) => (
                <DocumentCard key={item.key} item={item} index={index} />
              ))}

              {/* Pending files as skeleton cards */}
              {pending.map((p) => (
                <motion.div
                  key={p.key}
                  layout
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#1A1A1A]/50 p-3.5"
                >
                  <ScanLine
                    className={cn(
                      "size-4 shrink-0",
                      p.status === "reading" ? "animate-pulse text-amber-300" : "text-zinc-500",
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-300" title={p.fileName}>
                    {p.fileName}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-zinc-500">
                    <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
                    {p.status === "reading" ? "Reading" : "Queued"}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Add-more affordance when loaded and below the cap */}
        {used > 0 && remaining > 0 && (
          <div className="mt-4">
            <Uploader onFiles={processFiles} remaining={remaining} disabled={isBusy} />
          </div>
        )}

        {/* Per-file extraction errors */}
        <AnimatePresence>
          {errors.length > 0 && (
            <motion.ul
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 space-y-2 overflow-hidden"
            >
              {errors.map((err) => (
                <li
                  key={err.key}
                  className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm"
                >
                  <CircleX className="mt-0.5 size-4 shrink-0 text-rose-400" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-rose-100" title={err.fileName}>
                      {err.fileName}
                    </span>
                    <span className="block text-xs text-rose-300/90 text-pretty">{err.error}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => dismissError(err.key)}
                    className="rounded p-0.5 text-rose-300/70 transition-colors hover:bg-rose-500/20 hover:text-rose-100"
                    aria-label={`Dismiss error for ${err.fileName}`}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>

        {/* Fatal audit error */}
        {auditError && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
          >
            <CircleX className="mt-0.5 size-5 shrink-0 text-rose-400" aria-hidden="true" />
            <div>
              <p className="font-semibold">Audit failed</p>
              <p className="text-pretty text-rose-200/90">{auditError}</p>
            </div>
          </div>
        )}

        {/* SINGLE ACTION — Audit */}
        {batch.length > 0 && (
          <button
            type="button"
            onClick={runAudit}
            disabled={!canAudit}
            aria-busy={isAuditing}
            className={cn(
              "mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-base font-semibold text-black shadow-lg shadow-amber-500/10 transition-all",
              "bg-amber-500 hover:bg-amber-400",
              "disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none",
            )}
          >
            {isAuditing ? (
              <>
                <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
                Auditing…
              </>
            ) : (
              <>
                {auditStale ? <FileUp className="size-5" aria-hidden="true" /> : <Sparkles className="size-5" aria-hidden="true" />}
                {auditStale ? "Re-run Audit" : "Audit"}
              </>
            )}
          </button>
        )}
      </div>
      <CopilotDrawer records={batch.map((b) => b.record)} verification={audit?.verification ?? null} />
    </div>
  )
}
