"use client"

import { useRef, useState } from "react"
import { CloudUpload } from "lucide-react"
import { cn } from "@/lib/utils"

const ACCEPT = "image/*,application/pdf"

export function Uploader({
  onFiles,
  disabled,
  remaining,
}: {
  onFiles: (files: File[]) => void
  disabled?: boolean
  remaining: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function handleSelect(list: FileList | null) {
    if (!list || list.length === 0) return
    onFiles(Array.from(list))
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          if (disabled) return
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (disabled) return
          e.preventDefault()
          setDragging(false)
          handleSelect(e.dataTransfer.files)
        }}
        className={cn(
          "group flex w-full flex-col items-center justify-center gap-4 rounded-2xl border border-dashed px-6 py-14 text-center transition-all",
          "disabled:cursor-not-allowed disabled:opacity-50",
          dragging
            ? "border-amber-400/70 bg-amber-500/10"
            : "border-white/15 bg-white/[0.02] hover:border-amber-500/40 hover:bg-white/[0.04]",
        )}
      >
        <span
          className={cn(
            "flex size-14 items-center justify-center rounded-full border border-amber-500/20 bg-amber-500/10 text-amber-200/90 transition-transform",
            "group-hover:scale-105",
          )}
        >
          <CloudUpload className="size-7" aria-hidden="true" />
        </span>
        <span className="space-y-1.5">
          <span className="block text-sm font-medium text-zinc-200">
            {dragging ? "Drop to upload" : "Drop your land records here, or click to browse"}
          </span>
          <span className="block text-xs text-zinc-500">
            Fard · Intiqal · Khasra · Sale Deed — JPG, PNG or PDF · up to {remaining} more
          </span>
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          handleSelect(e.target.files)
          e.target.value = ""
        }}
      />
    </>
  )
}
