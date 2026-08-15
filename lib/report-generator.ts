// lib/report-generator.ts
//
// Builds the "official stamped" audit report PDF. Pure pdf-lib + qrcode,
// no browser/canvas dependency, runs server-side in the API route.
//
// Visual language mirrors the web app's landing page: warm charcoal
// (#0B0B0C) background, translucent-looking glass cards with a hairline
// white/10 border, a cream-gold (#E2B96D) serif-italic wordmark, and the
// same three-segment cumulative risk gauge used in the workbench.

import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from "pdf-lib"
import QRCode from "qrcode"
import type { LandRecord, AuditVerification } from "./types"

const PAGE_WIDTH = 595.28 // A4
const PAGE_HEIGHT = 841.89
const MARGIN = 40
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2

// Vertical rhythm — one place to tune spacing across the whole document.
const SPACING = {
  afterHeader: 22,
  afterHero: 22,
  afterSectionHeading: 18,
  betweenCardRows: 16,
  betweenDocuments: 22,
  aboveFooter: 26,
}

// ---- Design tokens (converted from the app's landing-page palette) ----
const COLORS = {
  bg: rgb(0.043, 0.043, 0.047), // #0B0B0C warm charcoal
  surface: rgb(0.078, 0.078, 0.086), // #141416 glass card
  surfaceAlt: rgb(0.102, 0.102, 0.114), // #1A1A1D raised card
  border: rgb(0.165, 0.165, 0.18), // ~ white/10 hairline on dark
  gold: rgb(0.886, 0.725, 0.427), // #E2B96D signature cream-gold
  goldBright: rgb(0.918, 0.827, 0.627), // #EAD3A0
  emerald: rgb(0.063, 0.725, 0.506), // #10B981
  red: rgb(0.937, 0.267, 0.267), // #EF4444
  white: rgb(0.98, 0.98, 0.98), // #FAFAFA
  zinc300: rgb(0.831, 0.831, 0.847), // #D4D4D8
  zinc400: rgb(0.631, 0.631, 0.667), // #A1A1AA
  zinc500: rgb(0.443, 0.443, 0.478), // #71717A
}

function riskColor(level: string) {
  switch (level) {
    case "LOW":
      return COLORS.emerald
    case "MEDIUM":
      return COLORS.gold
    case "HIGH":
    case "INVALID":
      return COLORS.red
    case "NOT_COMPARABLE":
      return COLORS.zinc400
    default:
      return COLORS.zinc400
  }
}

function riskLabel(level: string) {
  switch (level) {
    case "LOW":
      return "LOW RISK"
    case "MEDIUM":
      return "MEDIUM RISK"
    case "HIGH":
      return "HIGH RISK"
    case "INVALID":
      return "INVALID DOCUMENT"
    case "NOT_COMPARABLE":
      return "NOT COMPARABLE"
    default:
      return "UNKNOWN"
  }
}

// How many of the three gauge segments light up — cumulative, so it
// reads as a rising severity meter (mirrors the RiskBar web component).
function riskFilledSegments(level: string): number {
  switch (level) {
    case "LOW":
      return 1
    case "MEDIUM":
      return 2
    case "HIGH":
    case "INVALID":
      return 3
    default:
      return 0 // NOT_COMPARABLE / unknown → all dimmed
  }
}

function riskSummarySentence(level: string, findingsCount: number): string {
  switch (level) {
    case "LOW":
      return "Cross-document checks are consistent; no material fraud indicators were identified in this batch."
    case "MEDIUM":
      return `${findingsCount} finding${findingsCount === 1 ? "" : "s"} warrant manual review before proceeding with this transaction.`
    case "HIGH":
      return `${findingsCount} material discrepanc${findingsCount === 1 ? "y" : "ies"} identified — recommend legal review before proceeding.`
    case "INVALID":
      return "One or more documents fail basic validity checks and should not be relied upon as-is."
    case "NOT_COMPARABLE":
      return "These documents don't describe the same parcel or title chain, so no fraud-risk comparison could be performed."
    default:
      return "Audit result summary unavailable."
  }
}

// naive word-wrap for a fixed width, since pdf-lib has no built-in wrapping
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word
    if (font.widthOfTextAtSize(trial, size) > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = trial
    }
  }
  if (current) lines.push(current)
  return lines
}

interface ReportInput {
  reportId: string
  generatedAt: Date
  records: LandRecord[]
  verification: AuditVerification
  verificationUrl: string // what the QR code links to
}

export async function generateAuditReportPdf(input: ReportInput): Promise<Uint8Array> {
  const { reportId, generatedAt, records, verification, verificationUrl } = input

  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  // Serif italic wordmark to echo the landing page's italic serif headline.
  const fontSerifItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic)
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - MARGIN

  // QR code with a light quiet-zone so it stays scannable when set into a
  // dark container — pure high-contrast, not tinted, since scanner
  // reliability matters more than theme match.
  const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
    margin: 2,
    width: 240,
    color: { dark: "#0B0B0C", light: "#FAFAFA" },
  })
  const qrImageBytes = Buffer.from(qrDataUrl.split(",")[1], "base64")
  const qrImage = await pdfDoc.embedPng(qrImageBytes)

  function paintPageBackground(p: PDFPage) {
    p.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: COLORS.bg })
    // Warm gold radial-glow approximation behind the header: a stack of
    // wide, very-low-opacity gold bands that fade as they descend, echoing
    // the landing page's amber spotlight without a real gradient.
    const glowCX = PAGE_WIDTH / 2
    const glowTop = PAGE_HEIGHT - 60
    for (let i = 0; i < 6; i++) {
      const w = 380 - i * 40
      const h = 150 - i * 18
      p.drawRectangle({
        x: glowCX - w / 2,
        y: glowTop - h,
        width: w,
        height: h,
        color: COLORS.gold,
        opacity: 0.02,
      })
    }
  }
  paintPageBackground(page)

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
      paintPageBackground(page)
      y = PAGE_HEIGHT - MARGIN
      drawContinuationHeader()
    }
  }

  function drawContinuationHeader() {
    page.drawText(`ZameenVerify — ${reportId} (continued)`, {
      x: MARGIN,
      y: y - 14,
      size: 8,
      font,
      color: COLORS.zinc500,
    })
    page.drawLine({
      start: { x: MARGIN, y: y - 24 },
      end: { x: PAGE_WIDTH - MARGIN, y: y - 24 },
      thickness: 0.75,
      color: COLORS.border,
    })
    y -= 42
  }

  /** Bordered rectangle standing in for a glass "card": a subtle fill with
   * a hairline border reads as a translucent surface at this density
   * without needing a vector rounded-corner path per card. */
  function drawCard(x: number, top: number, width: number, height: number, fill = COLORS.surface) {
    page.drawRectangle({
      x,
      y: top - height,
      width,
      height,
      color: fill,
      borderColor: COLORS.border,
      borderWidth: 1,
    })
  }

  function drawBadge(text: string, x: number, top: number, color: typeof COLORS.emerald, textColor = COLORS.bg) {
    const size = 9
    const padX = 9
    const w = fontBold.widthOfTextAtSize(text, size) + padX * 2
    const h = 17
    page.drawRectangle({ x, y: top - h, width: w, height: h, color })
    page.drawText(text, { x: x + padX, y: top - h + 5, size, font: fontBold, color: textColor })
    return w
  }

  /** Three-segment cumulative risk gauge, matching the web RiskBar:
   * a glass track with three equal segments; the first N light up in the
   * active risk color (with a soft glow underlay), the rest stay dimmed. */
  function drawRiskGauge(x: number, top: number, width: number, level: string) {
    const trackH = 8
    const gap = 6
    const segW = (width - gap * 2) / 3
    const filled = riskFilledSegments(level)
    const color = riskColor(level)

    // glass track
    page.drawRectangle({
      x: x - 3,
      y: top - trackH - 3,
      width: width + 6,
      height: trackH + 6,
      color: COLORS.white,
      opacity: 0.04,
      borderColor: COLORS.border,
      borderWidth: 1,
    })

    for (let i = 0; i < 3; i++) {
      const sx = x + i * (segW + gap)
      const isActive = i < filled
      if (isActive) {
        // soft glow underlay
        page.drawRectangle({
          x: sx - 2,
          y: top - trackH - 2,
          width: segW + 4,
          height: trackH + 4,
          color,
          opacity: 0.28,
        })
        page.drawRectangle({ x: sx, y: top - trackH, width: segW, height: trackH, color })
      } else {
        page.drawRectangle({
          x: sx,
          y: top - trackH,
          width: segW,
          height: trackH,
          color: COLORS.white,
          opacity: 0.1,
        })
      }
    }
  }

  function drawSectionHeading(text: string) {
    page.drawText(text, { x: MARGIN, y, size: 10.5, font: fontBold, color: COLORS.white })
    y -= SPACING.afterSectionHeading
  }

  // ======================================================================
  // HEADER — gold serif wordmark (left) / QR + metadata stack (right)
  // ======================================================================
  const headerHeight = 112
  drawCard(MARGIN, y, CONTENT_WIDTH, headerHeight, COLORS.surface)

  page.drawText("ZameenVerify", {
    x: MARGIN + 20,
    y: y - 38,
    size: 22,
    font: fontSerifItalic,
    color: COLORS.goldBright,
  })
  // hairline gold accent under the wordmark
  const wordmarkWidth = fontSerifItalic.widthOfTextAtSize("ZameenVerify", 22)
  page.drawLine({
    start: { x: MARGIN + 20, y: y - 46 },
    end: { x: MARGIN + 20 + wordmarkWidth, y: y - 46 },
    thickness: 1,
    color: COLORS.gold,
    opacity: 0.5,
  })
  page.drawText("LAND RECORD AUDIT REPORT", {
    x: MARGIN + 20,
    y: y - 62,
    size: 8.5,
    font: fontBold,
    color: COLORS.zinc400,
  })

  // metadata stack, left-aligned under the wordmark, with even line height
  const metaLineHeight = 14
  let metaY = y - 84
  page.drawText(`REPORT ID`, { x: MARGIN + 20, y: metaY, size: 6.5, font: fontBold, color: COLORS.zinc500 })
  page.drawText(reportId, { x: MARGIN + 90, y: metaY, size: 8.5, font, color: COLORS.zinc300 })
  metaY -= metaLineHeight
  page.drawText(`GENERATED`, { x: MARGIN + 20, y: metaY, size: 6.5, font: fontBold, color: COLORS.zinc500 })
  page.drawText(`${generatedAt.toISOString().slice(0, 19).replace("T", "  ")} UTC`, {
    x: MARGIN + 90,
    y: metaY,
    size: 8.5,
    font,
    color: COLORS.zinc300,
  })

  // QR container, top-right, inside the header card, vertically centered
  const qrBox = 64
  const qrContainerX = PAGE_WIDTH - MARGIN - 20 - qrBox - 14
  const qrContainerBoxHeight = qrBox + 12 + 14
  const qrContainerTop = y - (headerHeight - qrContainerBoxHeight) / 2
  page.drawRectangle({
    x: qrContainerX - 6,
    y: qrContainerTop - qrContainerBoxHeight,
    width: qrBox + 12,
    height: qrContainerBoxHeight,
    color: COLORS.surfaceAlt,
    borderColor: COLORS.gold,
    borderOpacity: 0.3,
    borderWidth: 1,
  })
  page.drawImage(qrImage, {
    x: qrContainerX,
    y: qrContainerTop - qrBox - 6,
    width: qrBox,
    height: qrBox,
  })
  const scanLabel = "SCAN TO VERIFY"
  const scanLabelWidth = fontBold.widthOfTextAtSize(scanLabel, 6.5)
  page.drawText(scanLabel, {
    x: qrContainerX + (qrBox - scanLabelWidth) / 2,
    y: qrContainerTop - qrBox - 20,
    size: 6.5,
    font: fontBold,
    color: COLORS.zinc500,
  })

  y -= headerHeight + SPACING.afterHeader

  // ======================================================================
  // RISK HERO CARD
  // ======================================================================
  const heroHeight = 112
  drawCard(MARGIN, y, CONTENT_WIDTH, heroHeight, COLORS.surfaceAlt)

  page.drawText("OVERALL TITLE RISK", {
    x: MARGIN + 20,
    y: y - 22,
    size: 9,
    font: fontBold,
    color: COLORS.zinc400,
  })

  const heroRiskColor = riskColor(verification.risk_level)
  drawBadge(riskLabel(verification.risk_level), MARGIN + 20, y - 30, heroRiskColor)

  // three-segment cumulative severity gauge
  drawRiskGauge(MARGIN + 20, y - 62, CONTENT_WIDTH - 40, verification.risk_level)

  // one-sentence executive summary
  const summarySentence = riskSummarySentence(verification.risk_level, verification.audit_findings.length)
  const summaryLines = wrapText(summarySentence, font, 9.5, CONTENT_WIDTH - 40)
  let summaryY = y - 82
  for (const line of summaryLines.slice(0, 2)) {
    page.drawText(line, { x: MARGIN + 20, y: summaryY, size: 9.5, font, color: COLORS.zinc300 })
    summaryY -= 14
  }

  y -= heroHeight + SPACING.afterHero

  // ======================================================================
  // VERIFICATION CHECKS — 2 columns of glass cards, PASS/FAIL badge each
  // ======================================================================
  const checks: Array<{ label: string; passed: boolean; reasoning?: string }> = [
    { label: "Khasra Match", passed: verification.khasra_match, reasoning: verification.reasoning?.khasra_match },
    {
      label: "Owner / Possession Match",
      passed: verification.owner_possession_match,
      reasoning: verification.reasoning?.owner_possession_match,
    },
    ...(verification.title_chain_verified !== undefined
      ? [
          {
            label: "Title Chain Verified",
            passed: !!verification.title_chain_verified,
            reasoning: verification.reasoning?.title_chain_verified,
          },
        ]
      : []),
    ...(verification.area_match !== undefined
      ? [{ label: "Area Match", passed: !!verification.area_match, reasoning: verification.reasoning?.area_match }]
      : []),
  ]

  if (checks.length > 0) {
    ensureSpace(SPACING.afterSectionHeading + 50 + 12) // heading + at least one card row's worth
    drawSectionHeading("VERIFICATION CHECKS")

    const gap = 14
    const colWidth = (CONTENT_WIDTH - gap) / 2
    const cardPad = 14

    for (let i = 0; i < checks.length; i += 2) {
      const rowChecks = [checks[i], checks[i + 1]].filter(Boolean) as typeof checks

      // Pre-measure the taller of the two cards in this row so both cards
      // in the row share one height and stay visually aligned.
      const heights = rowChecks.map((c) => {
        const lines = c.reasoning ? wrapText(c.reasoning, font, 8, colWidth - cardPad * 2) : []
        return 40 + Math.min(lines.length, 3) * 11.5
      })
      const rowHeight = Math.max(...heights, 50)
      ensureSpace(rowHeight + SPACING.betweenCardRows)

      rowChecks.forEach((check, col) => {
        const cardX = MARGIN + col * (colWidth + gap)
        drawCard(cardX, y, colWidth, rowHeight, COLORS.surface)

        const badgeColor = check.passed ? COLORS.emerald : COLORS.red
        const badgeText = check.passed ? "PASS" : "FAIL"
        const bw = drawBadge(badgeText, cardX + cardPad, y - cardPad, badgeColor)

        page.drawText(check.label, {
          x: cardX + cardPad + bw + 10,
          y: y - cardPad - 12,
          size: 9.5,
          font: fontBold,
          color: COLORS.white,
        })

        if (check.reasoning) {
          const lines = wrapText(check.reasoning, font, 8, colWidth - cardPad * 2).slice(0, 3)
          let ly = y - cardPad - 32
          for (const line of lines) {
            page.drawText(line, { x: cardX + cardPad, y: ly, size: 8, font, color: COLORS.zinc400 })
            ly -= 11.5
          }
        }
      })

      y -= rowHeight + SPACING.betweenCardRows
    }
  }

  // ======================================================================
  // AUDIT FINDINGS
  // ======================================================================
  if (verification.audit_findings.length > 0) {
    const firstFindingLines = wrapText(verification.audit_findings[0], font, 9, CONTENT_WIDTH - 24)
    const firstFindingH = 12 + firstFindingLines.length * 13
    ensureSpace(SPACING.afterSectionHeading + firstFindingH) // heading + at least the first finding
    drawSectionHeading("AUDIT FINDINGS")

    verification.audit_findings.forEach((finding, idx) => {
      const lines = wrapText(finding, font, 9, CONTENT_WIDTH - 24)
      const rowH = 12 + lines.length * 13
      ensureSpace(rowH + 6)

      // number marker
      page.drawText(`${idx + 1}`, { x: MARGIN, y: y - 9, size: 8.5, font: fontBold, color: COLORS.gold })
      let fy = y - 9
      for (const line of lines) {
        page.drawText(line, { x: MARGIN + 20, y: fy, size: 9, font, color: COLORS.zinc300 })
        fy -= 13
      }
      y -= rowH
    })
    y -= 6
  }

  // ======================================================================
  // DOCUMENT EXTRACTION TABLE — key/value pairs per document, dark rows
  // ======================================================================
  for (const [i, record] of records.entries()) {
    const fieldPairs: Array<[string, string]> = (
      [
        ["District", record.district],
        ["Tehsil", record.tehsil],
        ["Khewat No.", record.khewat_no],
        ["Khatuni No.", record.khatuni_no],
        ["Khasra No.", record.khasra_no],
        ["Owner Name", record.owner_name],
        ["Cultivator", record.cultivator_name],
        ["CNIC", record.cnic],
        ["Total Area", record.total_area],
        ["Mutation No.", record.mutation_no],
      ] as Array<[string, string | undefined]>
    ).filter(([, v]) => !!v && v.trim().length > 0) as Array<[string, string]>

    const rowH = 26
    const colW = CONTENT_WIDTH / 2
    const rowCount = Math.ceil(fieldPairs.length / 2)
    const tableHeight = rowCount * rowH

    // Reserve the heading AND the table (or at least its first couple of
    // rows) together, so a page break can't strand the "DOCUMENT N"
    // heading alone at the bottom of a page with its table pushed over.
    ensureSpace(18 + Math.min(tableHeight, rowH * 2) + 10)

    page.drawText(`DOCUMENT ${i + 1} — ${record.document_type.replace(/_/g, " ").toUpperCase()}`, {
      x: MARGIN,
      y,
      size: 9.5,
      font: fontBold,
      color: COLORS.gold,
    })
    y -= 18

    ensureSpace(tableHeight + SPACING.betweenDocuments)
    const startY = y
    drawCard(MARGIN, startY, CONTENT_WIDTH, tableHeight, COLORS.surface)

    for (let row = 0; row < rowCount; row++) {
      const rowTop = startY - row * rowH
      if (row > 0) {
        page.drawLine({
          start: { x: MARGIN, y: rowTop },
          end: { x: MARGIN + CONTENT_WIDTH, y: rowTop },
          thickness: 0.5,
          color: COLORS.border,
        })
      }
      for (let col = 0; col < 2; col++) {
        const pair = fieldPairs[row * 2 + col]
        if (!pair) continue
        const [label, value] = pair
        const cellX = MARGIN + col * colW
        if (col === 1) {
          page.drawLine({
            start: { x: cellX, y: rowTop },
            end: { x: cellX, y: rowTop - rowH },
            thickness: 0.5,
            color: COLORS.border,
          })
        }
        page.drawText(label.toUpperCase(), {
          x: cellX + 14,
          y: rowTop - 10,
          size: 6.5,
          font,
          color: COLORS.zinc500,
        })
        const valueText = value.length > 46 ? value.slice(0, 44) + "…" : value
        page.drawText(valueText, {
          x: cellX + 14,
          y: rowTop - 21,
          size: 9,
          font: fontBold,
          color: COLORS.white,
        })
      }
    }

    y = startY - tableHeight - SPACING.betweenDocuments
  }

  // ======================================================================
  // FOOTER — single-line disclaimer, last page only
  // ======================================================================
  ensureSpace(SPACING.aboveFooter + 20)
  const footerText =
    "Generated by AI-assisted document analysis for due-diligence purposes only — not legal advice. Verify against the official Arazi Record Center before relying on it."
  const footerLines = wrapText(footerText, fontItalic, 7, CONTENT_WIDTH)
  const footerBlockHeight = footerLines.length * 10.5
  page.drawLine({
    start: { x: MARGIN, y: MARGIN + footerBlockHeight + 8 },
    end: { x: PAGE_WIDTH - MARGIN, y: MARGIN + footerBlockHeight + 8 },
    thickness: 0.5,
    color: COLORS.border,
  })
  let footY = MARGIN + footerBlockHeight - 4
  for (const line of footerLines) {
    page.drawText(line, { x: MARGIN, y: footY, size: 7, font: fontItalic, color: COLORS.zinc500 })
    footY -= 10.5
  }

  return pdfDoc.save()
}
