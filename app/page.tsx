import { AuditWorkbench } from "@/components/zameen/audit-workbench"

export default function Page() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0B0B0C] text-white">
      {/* Warm amber/gold radial spotlight behind the hero title and upload box */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 28%, rgba(226, 185, 109, 0.15), rgba(226, 185, 109, 0.04) 45%, transparent 70%)",
          filter: "blur(60px)",
        }}
      />

      <div className="relative">
        {/* Minimal top navigation */}
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
          <span className="font-serif text-xl italic tracking-tight text-white">
            Zameen<span className="text-amber-200/90">Verify</span>
          </span>
        </header>

        {/* Centered hero */}
        <section className="mx-auto max-w-3xl px-4 pb-14 pt-16 text-center sm:pt-24">
          <h1
            className="text-balance font-serif text-4xl italic leading-[1.15] tracking-tight text-white sm:text-6xl"
            style={{ filter: "drop-shadow(0 0 20px rgba(226, 185, 109, 0.35))" }}
          >
            Audit Pakistani land records
            <br />
            <span className="text-amber-200/90">in seconds, not hours</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty font-sans text-sm font-normal leading-relaxed tracking-normal text-zinc-400 sm:text-base">
            Drop Fard, Intiqal, Khasra, or Sale Deeds below to automatically detect fraud, title
            chain breaks, and registry risk.
          </p>
        </section>

        {/* Workspace */}
        <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <AuditWorkbench />

          <footer className="mx-auto mt-10 max-w-3xl text-center text-xs text-zinc-600">
            ZameenVerify is a due-diligence aid. Always confirm findings against the official record
            at the relevant Arazi Record Center before relying on them.
          </footer>
        </div>
      </div>
    </main>
  )
}
