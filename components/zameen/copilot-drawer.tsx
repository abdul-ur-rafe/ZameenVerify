"use client"

import { useEffect, useRef, useState } from "react"
import { Bot, ChevronRight, CircleX, LoaderCircle, Send, Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { AuditVerification, CopilotMessage, LandRecord } from "@/lib/types"

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

/** Suggestions should match what's actually worth asking given the
 * result — "why is this high risk" makes no sense to surface on a
 * clean LOW result, and a NOT_COMPARABLE batch has a different set of
 * useful questions than a scored one. */
function getSuggestedPrompts(verification: AuditVerification | null): string[] {
  if (!verification) {
    return [
      "What should I check before running the audit?",
      "What does each document type tell us?",
    ]
  }
  switch (verification.risk_level) {
    case "HIGH":
      return [
        "Why is this flagged as high risk?",
        "Which finding is most serious here?",
        "What would resolve this risk?",
      ]
    case "MEDIUM":
      return [
        "What's causing the medium risk rating?",
        "Is this worth escalating to a lawyer?",
      ]
    case "LOW":
      return [
        "Why did this come back low risk?",
        "Is there anything still worth double-checking?",
      ]
    case "INVALID":
      return [
        "Why was this document marked invalid?",
        "What would make this document usable?",
      ]
    case "NOT_COMPARABLE":
      return [
        "Why couldn't these documents be compared?",
        "What would make these documents comparable?",
      ]
    default:
      return ["What does this result mean?"]
  }
}

export function CopilotDrawer({
  records,
  verification,
}: {
  records: LandRecord[]
  verification: AuditVerification | null
}) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<CopilotMessage[]>([])
  const [input, setInput] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const hasBatch = records.length > 0

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, isSending])

  // Auto-grow the textarea as the user types, capped at ~5 lines so a
  // long question doesn't push the send button and message list off
  // screen. Recalculated on every value change rather than only on
  // keydown so paste and programmatic sets (suggested prompts, clearing
  // after send) are covered too.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const maxHeight = 5 * 20 + 16 // ~5 lines at this font-size/line-height, plus vertical padding
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }, [input])

  // The batch going from non-empty to empty means the user cleared it
  // (or removed every document) — the copilot's conversation was about
  // documents that no longer exist, so it should reset rather than sit
  // there answering questions grounded in stale, gone data.
  const wasEverNonEmpty = useRef(false)
  useEffect(() => {
    if (records.length > 0) {
      wasEverNonEmpty.current = true
    } else if (wasEverNonEmpty.current) {
      setMessages([])
      setError(null)
      wasEverNonEmpty.current = false
    }
  }, [records.length])

  async function sendMessage(text: string) {
    const trimmed = text.trim()
    if (!trimmed || isSending || !hasBatch) return

    const userMessage: CopilotMessage = { key: uid(), role: "user", content: trimmed }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInput("")
    setError(null)
    setIsSending(true)

    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          records,
          verification,
        }),
      })
      const data = await res.json()

      if (!res.ok || !data.success) {
        throw new Error(data.error || "The AI Copilot could not respond right now.")
      }

      setMessages((prev) => [...prev, { key: uid(), role: "assistant", content: data.reply }])
    } catch (e) {
      setError(e instanceof Error ? e.message : "The AI Copilot could not respond right now.")
    } finally {
      setIsSending(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    sendMessage(input)
  }

  return (
    <>
      {/* Collapsed launcher tab */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 items-center gap-2 rounded-l-xl border border-r-0 border-border bg-card px-3 py-4 text-sm font-medium text-foreground shadow-lg transition-colors hover:bg-secondary"
          aria-label="Open AI Copilot"
        >
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          <span className="[writing-mode:vertical-rl] rotate-180">AI Copilot</span>
        </button>
      )}

      {/* Docked drawer */}
      <div
        className={cn(
          "fixed right-0 top-0 z-50 flex h-dvh w-full max-w-sm flex-col border-l border-border bg-card shadow-2xl transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
        role="complementary"
        aria-label="AI Copilot"
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Bot className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">AI Copilot</h2>
              <p className="text-[11px] text-muted-foreground">
                {hasBatch
                  ? `Grounded in ${records.length} document${records.length > 1 ? "s" : ""} in this batch`
                  : "Add documents to start asking questions"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Close AI Copilot"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground text-pretty">
                {hasBatch
                  ? "Ask about the audit findings, specific document fields, or what to check next."
                  : "Once you've added documents and run an audit, ask me anything about the results."}
              </p>
              {hasBatch && (
                <div className="space-y-1.5">
                  {getSuggestedPrompts(verification).map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => sendMessage(prompt)}
                      className="block w-full rounded-lg border border-border bg-background/40 px-3 py-2 text-left text-xs text-foreground/90 transition-colors hover:border-primary/40 hover:bg-primary/5"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.key}
              className={cn(
                "max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed text-pretty",
                m.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-background/60 border border-border text-foreground/90",
              )}
            >
              {m.content}
            </div>
          ))}

          {isSending && (
            <div className="flex max-w-[90%] items-center gap-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              Thinking…
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
            >
              <CircleX className="mt-0.5 size-3.5 shrink-0 text-rose-400" aria-hidden="true" />
              <span className="text-pretty">{error}</span>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage(input)
                }
              }}
              placeholder={hasBatch ? "Ask about this audit…" : "Add documents first…"}
              disabled={!hasBatch || isSending}
              rows={1}
              className="flex-1 resize-none overflow-y-auto rounded-lg border border-input bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!hasBatch || isSending || !input.trim()}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
              aria-label="Send message"
            >
              <Send className="size-4" aria-hidden="true" />
            </button>
          </div>
        </form>
      </div>

      {/* Backdrop on small screens so the drawer reads as modal, not just overlapping content */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 sm:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
    </>
  )
}
