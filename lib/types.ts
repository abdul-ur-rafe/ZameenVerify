export type DocumentType =
  | "FARD_MALKIAT"
  | "KHASRA_GIRDAWARI"
  | "INTEQAL"
  | "AKS_SHAJRA_REGISTRY"
  | "OTHER"

/** Which ingestion pipeline produced this record.
 * "standard": typed/computerized PLRA records — the original pipeline,
 *   unchanged. Every field is either a confident read or "" (see
 *   RULE 1 in ocr-helpers.ts) — there is no partial-confidence state.
 * "legacy": handwritten/hard-form documents (Urdu Nastaliq/Shikasta,
 *   old manual registers). These go through OpenCV preprocessing and a
 *   different extraction prompt that reports a confidence score per
 *   field instead of a binary confident/blank decision, because
 *   handwritten Urdu OCR is fundamentally less certain than typed text
 *   — pretending otherwise with a binary field would silently present
 *   low-confidence guesses as fact. See field_confidence below. */
export type IngestionMode = "standard" | "legacy"

export interface LandRecord {
  id?: string
  document_type: DocumentType
  ingestion_mode?: IngestionMode
  district?: string
  tehsil?: string
  khewat_no?: string
  khatuni_no?: string
  khasra_no?: string
  owner_name?: string
  father_name?: string
  cnic?: string
  total_area?: string
  cultivator_name?: string
  possession_status?: string
  crop_season?: string
  harvest_year?: string
  mutation_no?: string
  mutation_type?: string
  transferor_name?: string
  transferee_name?: string
  approval_date?: string
  registered_area?: string
  buyer_name?: string
  seller_name?: string
  e_stamp_no?: string
  registry_date?: string
  remarks?: string
  file_url?: string
  /** A document reference/verification token or serial number printed
   * on the document itself (e.g. "PLRA-2026-99X7"), distinct from
   * e_stamp_no — some document types (Fard Malkiat, Khasra Girdawari)
   * carry a document reference number without being an e-Stamp deed.
   * Used by the SIMULATED registry cross-check in /api/audit — see the
   * tamper-detection note in that file for what this does and does not
   * actually verify. */
  verification_token?: string
  /** Only populated when ingestion_mode === "legacy". Maps a field name
   * (matching a LandRecord key above) to the model's confidence 0-1
   * that the extracted value is correct. A field with no entry here
   * (or ingestion_mode "standard") should be treated as the normal
   * confident-or-blank contract — don't assume a missing confidence
   * entry means "uncertain," it means "not applicable." */
  field_confidence?: Partial<Record<keyof LandRecord, number>>
  /** Only populated when ingestion_mode === "legacy". Maps a field name
   * to a cropped-region image (data URL or storage URL) showing exactly
   * where on the source page that field was read from, so a low-
   * confidence value can be verified against the actual handwriting
   * instead of trusted blind. */
  field_crops?: Partial<Record<keyof LandRecord, string>>
}

export interface ExtractResponse {
  success: boolean
  record?: LandRecord
  persisted: boolean
  warning?: string | null
  error?: string
}

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "INVALID" | "NOT_COMPARABLE"

export interface AuditVerification {
  same_parcel_batch?: boolean
  khasra_match: boolean
  owner_possession_match: boolean
  title_chain_verified?: boolean
  area_match?: boolean
  encumbrance_free?: boolean
  reasoning?: {
    khasra_match?: string
    owner_possession_match?: string
    title_chain_verified?: string
    area_match?: string
    encumbrance_free?: string
  }
  risk_level: RiskLevel
  audit_findings: string[]
  /** Result of cross-checking each record's verification_token against
   * a SIMULATED mock registry table (mock_plra_registry in Supabase) —
   * this is a demo stand-in for a real PLRA API integration, which
   * isn't publicly available. Undefined when no record in the batch
   * had a verification_token to check at all (not the same as "checked
   * and passed" — see TamperCheckResult below). */
  tamper_check?: TamperCheckResult
  /** Result of validating e-Stamp serial numbers across the batch —
   * see EStampCheckResult below for what this does and does not
   * actually verify. Undefined when no record in the batch had an
   * e_stamp_no to check at all. */
  e_stamp_check?: EStampCheckResult
}

/** status meanings:
 * "no_token" — no record in the batch had a verification_token field
 *   populated, so no registry check could be attempted at all. This is
 *   NOT a pass or a fail — it's "nothing to check," and the UI must not
 *   present it as either.
 * "match" — every token found was present in the mock registry AND the
 *   registry's snapshot data agreed with what was extracted from the
 *   document (owner_name, area, khasra_no).
 * "not_found" — a token was present on the document but has no
 *   matching row in the mock registry at all (could mean: token doesn't
 *   exist, or simply isn't seeded in this demo dataset — the UI copy
 *   must not overclaim "this token is fake," only that it couldn't be
 *   verified against the (simulated) registry).
 * "mismatch" — the token WAS found in the registry, but one or more
 *   fields extracted from the document disagree with the registry's
 *   snapshot for that token. This is the actual tamper signal.
 */
export type TamperCheckStatus = "no_token" | "match" | "not_found" | "mismatch"

export interface TamperCheckResult {
  status: TamperCheckStatus
  token?: string
  /** Only populated when status is "mismatch" — which specific fields
   * disagreed, in plain language, e.g. "owner_name: document says
   * 'Tariq Mahmood', registry snapshot says 'Ahmed Khan'". */
  mismatched_fields?: string[]
}

/** Results of validating e-Stamp serial numbers (e_stamp_no) on
 * AKS_SHAJRA_REGISTRY documents in the batch. Three checks, all
 * mechanical/deterministic (no LLM involved — see the comment in
 * app/api/audit/route.ts for why):
 *
 * missing_on: e_stamp_no is blank on a registry-type document that
 *   should have one. A real completeness gap.
 *
 * duplicate_across_batch: the SAME e_stamp_no string appears on more
 *   than one document in this batch. One e-Stamp paper legitimately
 *   backs exactly one transaction, so this is a genuine, mechanically-
 *   checkable fraud signal — not simulated data, this check works the
 *   same way against real documents.
 *
 * format_warnings: a GENERIC plausibility check (e.g. suspiciously
 *   short, all-zeros, obviously placeholder-looking) — NOT a real
 *   Punjab e-Stamp format validator. There is no public specification
 *   of the actual serial format to validate against, so this must
 *   never be presented as "we verified this against the real format."
 *   The UI labels this "Format sanity check" for that reason, distinct
 *   from missing/duplicate which are real structural findings.
 */
export interface EStampCheckResult {
  missing_on: string[] // file names or record identifiers missing e_stamp_no
  duplicate_across_batch: { token: string; recordLabels: string[] }[]
  format_warnings: { recordLabel: string; token: string; reason: string }[]
}

export interface AuditResponse {
  success: boolean
  document_count: number
  verification?: AuditVerification
  persisted: boolean
  warning?: string | null
  error?: string
}

/** A record as held in the client-side batch, with a stable local key. */
export interface BatchItem {
  key: string
  fileName: string
  record: LandRecord
  warning?: string | null
}

/** A file currently moving through the extraction pipeline. */
export interface PendingFile {
  key: string
  fileName: string
  /** MIME type, used only to pick a display icon (image scan vs. PDF) in the queue list. */
  mimeType?: string
  status: "queued" | "reading"
}

/** A file that failed extraction. */
export interface FileError {
  key: string
  fileName: string
  error: string
}

export interface CopilotMessage {
  key: string
  role: "user" | "assistant"
  content: string
}

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  FARD_MALKIAT: "Fard Malkiat",
  KHASRA_GIRDAWARI: "Khasra Girdawari",
  INTEQAL: "Inteqal (Mutation)",
  AKS_SHAJRA_REGISTRY: "Aks Shajra / Registry",
  OTHER: "Other Document",
}

/** Below this, a legacy-mode field is flagged for manual verification
 * in the UI rather than shown as a plain confident value. Chosen as a
 * conservative cutoff, not a calibrated statistic — there is no ground-
 * truth accuracy benchmark for Nastaliq/Shikasta extraction to calibrate
 * against, so this is deliberately cautious (flag more, not less) rather
 * than tuned to look impressive. */
export const LOW_CONFIDENCE_THRESHOLD = 0.75

/** Fields always shown in the "core" section of a document card
 * (when they have a value — empty ones are still omitted). */
export const CORE_FIELDS: (keyof LandRecord)[] = [
  "district",
  "tehsil",
  "khewat_no",
  "khatuni_no",
  "khasra_no",
  "owner_name",
  "cultivator_name",
]

export const FIELD_LABELS: Partial<Record<keyof LandRecord, string>> = {
  district: "District",
  tehsil: "Tehsil",
  khewat_no: "Khewat No.",
  khatuni_no: "Khatuni No.",
  khasra_no: "Khasra No.",
  owner_name: "Owner Name",
  father_name: "Father Name",
  cnic: "CNIC",
  total_area: "Total Area",
  cultivator_name: "Cultivator Name",
  possession_status: "Possession Status",
  crop_season: "Crop Season",
  harvest_year: "Harvest Year",
  mutation_no: "Mutation No.",
  mutation_type: "Mutation Type",
  transferor_name: "Transferor",
  transferee_name: "Transferee",
  approval_date: "Approval Date",
  registered_area: "Registered Area",
  buyer_name: "Buyer Name",
  seller_name: "Seller Name",
  e_stamp_no: "E-Stamp No.",
  registry_date: "Registry Date",
  remarks: "Remarks",
}

/** Ordering of the non-core fields as rendered in the detail grid.
 * "remarks" is deliberately excluded here — it's long-form prose, not
 * a short value like a CNIC or Khasra number, so it gets its own
 * full-width block on the card instead of being squeezed into a
 * 2-column grid cell and truncated. */
export const DETAIL_FIELDS: (keyof LandRecord)[] = [
  "father_name",
  "cnic",
  "total_area",
  "possession_status",
  "crop_season",
  "harvest_year",
  "mutation_no",
  "mutation_type",
  "transferor_name",
  "transferee_name",
  "approval_date",
  "registered_area",
  "buyer_name",
  "seller_name",
  "e_stamp_no",
  "registry_date",
]
