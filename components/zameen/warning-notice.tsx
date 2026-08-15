"use client"

import { TriangleAlert, X } from "lucide-react"

export function WarningNotice({
  message,
  onDismiss,
}: {
  message: string
  onDismiss?: () => void
}) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" aria-hidden="true" />
      <p className="flex-1 leading-relaxed text-pretty">{message}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="rounded p-0.5 text-amber-300/70 transition-colors hover:bg-amber-500/20 hover:text-amber-100"
          aria-label="Dismiss notice"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
