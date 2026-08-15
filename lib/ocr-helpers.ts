// lib/ocr-helpers.ts
//
// Shared between /api/extract (single-doc OCR) and /api/audit
// (cross-document audit). Keeping these in one place avoids the two
// routes drifting out of sync on preprocessing or parsing behavior.

import sharp from 'sharp';
import { pdfToPng } from 'pdf-to-png-converter';

// --- image preprocessing: upscale small/dense scans before OCR --------
// Dense Pakistani revenue-record tables (Fard Malkiat, Khasra Girdawari)
// pack ~10 columns of small mixed English/Urdu text into a single image.
// When the source scan is small (phone photo, compressed screenshot),
// Qwen-VL's vision encoder can't resolve individual characters and will
// confidently output plausible-looking but WRONG text instead of failing
// loudly. Upscaling with a high-quality kernel + mild sharpening measurably
// improves legibility for this failure mode. This does not invent detail
// that was destroyed by heavy compression/blur — it only helps when the
// source has real but under-sampled detail (the common case for scans).
const MIN_LONG_EDGE_PX = 1600; // target long edge after upscaling

// sharp's prebuilt binaries do NOT include HEIC/HEIF decoding — libheif is
// patent-encumbered and only available via a custom-compiled libvips, which
// isn't something we can rely on in a standard Vercel/Node deployment. If we
// let a HEIC buffer reach sharp() here, .metadata() throws, the catch block
// below silently forwards the *original* HEIC bytes mislabeled as PNG, and
// the OCR call fails silently or garbage-outputs. Callers must reject HEIC
// before calling this function (see isUnsupportedHeic below) — this export
// exists so /api/extract can give the user an explicit, actionable error
// instead of a mysterious OCR failure.
export function isUnsupportedHeic(mimeType: string, fileName: string): boolean {
  const type = mimeType.toLowerCase();
  const name = fileName.toLowerCase();
  return (
    type === 'image/heic' ||
    type === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif')
  );
}

// --- PDF -> PNG rasterization -------------------------------------------
// qwen-vl-max is a vision model: it expects raster image bytes, not a PDF
// container. Previously, PDFs were sent unmodified as
// `data:application/pdf;base64,...` inside an image_url block — the model
// either fails outright or silently returns OTHER/garbage, because it was
// never given actual pixels.
//
// Only page 1 is rasterized. Land records in this app (Fard Malkiat,
// Khasra Girdawari, Inteqal, Aks Shajra/Registry) are single-page-per-
// document scans in practice — if a user's PDF has multiple unrelated
// pages, only the first is read, same as if they'd photographed one page.
// viewportScale 2.0 targets ~150-200 DPI for a standard page size, which
// keeps dense revenue-table text legible without producing an
// unreasonably large buffer.
export async function rasterizePdfFirstPage(buffer: Buffer): Promise<Buffer> {
  const pages = await pdfToPng(buffer, {
    viewportScale: 2.0,
    pagesToProcess: [1],
    verbosityLevel: 0,
  });

  if (!pages.length || !pages[0].content) {
    throw new Error('This PDF could not be rendered — it may be empty, corrupted, or password-protected.');
  }

  return pages[0].content;
}

export async function preprocessForOcr(buffer: Buffer): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    const longEdge = Math.max(width, height);

    // Normalize EVERY image through sharp's PNG encoder, unconditionally —
    // do not conditionally "pass through" original bytes under any branch.
    // The previous version returned the original buffer mislabeled as
    // 'image/png' whenever the image was already >= MIN_LONG_EDGE_PX (the
    // common case for real phone photos), so a JPEG's raw bytes were sent
    // to the vision model inside a data:image/png;... URI. Always
    // re-encoding to PNG here means the mimeType we return is never a lie,
    // regardless of what format the upload actually was (JPEG, WebP, GIF,
    // etc. — anything sharp can decode).
    if (longEdge > 0 && longEdge < MIN_LONG_EDGE_PX) {
      const scaleFactor = Math.min(4, MIN_LONG_EDGE_PX / longEdge); // cap at 4x to avoid absurd upscales on tiny thumbnails
      const targetWidth = Math.round(width * scaleFactor);
      const targetHeight = Math.round(height * scaleFactor);

      const processed = await sharp(buffer)
        .resize({ width: targetWidth, height: targetHeight, kernel: sharp.kernel.lanczos3 })
        .sharpen({ sigma: 1.2 })
        .png()
        .toBuffer();

      return { buffer: processed, mimeType: 'image/png' };
    }

    // Already high-res (or dimensions unreadable) — no upscaling needed,
    // but still normalize to PNG so mimeType always matches the bytes.
    const normalized = await sharp(buffer).png().toBuffer();
    return { buffer: normalized, mimeType: 'image/png' };
  } catch (err) {
    // If we get here with a HEIC file, it's because a caller didn't check
    // isUnsupportedHeic first — that's a caller bug, not something to mask.
    // Re-throw instead of silently forwarding raw bytes mislabeled as PNG;
    // the API route's catch block turns this into a clear user-facing error.
    console.error('Image preprocessing failed:', err);
    throw new Error('Could not process this image. Please try a different file or format (JPEG/PNG).');
  }
}

// --- shared helper: parse LLM JSON output defensively -----------------
// Handles: code fences, leading/trailing prose, and outright garbage.
// Never throws — returns fallback on failure so one bad LLM response
// doesn't 500 the whole request.
export function parseModelJson(raw: string, fallback: any = {}): any {
  if (!raw) return fallback;

  let text = raw.replace(/```json/gi, '').replace(/```/g, '').trim();

  try {
    return JSON.parse(text);
  } catch {
    // fallback: try to find the first {...} or [...] block in the text
    const objMatch = text.match(/\{[\s\S]*\}/);
    const arrMatch = text.match(/\[[\s\S]*\]/);
    const candidate = objMatch?.[0] || arrMatch?.[0];
    if (candidate) {
      try {
        return JSON.parse(candidate);
      } catch {
        console.error('parseModelJson: regex-extracted block still invalid:', candidate.slice(0, 300));
      }
    }
    console.error('parseModelJson: failed to parse model output:', text.slice(0, 300));
    return fallback;
  }
}

export const OCR_SYSTEM_PROMPT = `
You are a precision OCR engine for Pakistani land revenue records (PLRA computerized records, e-Stamp, Registries, Jamabandi, Fard Malkiat, Khasra Girdawari, Inteqal/Mutation records). These are printed/typed computerized documents — not handwritten — and are issued in English, Urdu, or a mix of both; see RULE 3C for how to handle Urdu and bilingual documents specifically.

═══════════════════════════════════════════
RULE 1 — NEVER GUESS. EMPTY STRING BEATS A WRONG ANSWER.
═══════════════════════════════════════════
This data is used for legal fraud/risk audits. A wrong owner name or wrong district is far more dangerous than a blank field, because it looks confident and gets trusted.

- Only output a value if you can actually read it in the image with reasonable confidence.
- If text is blurry, cut off, low-resolution, or ambiguous, output "" for that field. Do NOT produce a plausible-sounding name, number, or place just to fill the schema.
- Do NOT auto-complete partial names or numbers based on what would be "typical." If you can read "Sat_eem Ahma_" and the rest is illegible, that is not enough to output a full clean name — output "" instead, unless you are confident in the exact characters.
- Never invent, substitute, or "normalize" a person's name, CNIC, or place name based on common/expected patterns. Names and numbers are read character-by-character from the image, never inferred from context.

═══════════════════════════════════════════
RULE 2 — DOCUMENT TYPE: READ THE HEADER, DO NOT PATTERN-MATCH THE TABLE SHAPE.
═══════════════════════════════════════════
Every one of these document types can have a similar tabular layout. You MUST determine document_type from the actual printed title/header text of the document, not from how many columns it has or what the table looks like.

Look specifically for these header phrases (English or Urdu) to decide:
- "Register For Periodical Record of Right" / "Fard Malkiat" / "Fard-e-Malkiat" -> FARD_MALKIAT
- "Khasra Girdawari" / crop-season inspection register with per-harvest cultivation entries -> KHASRA_GIRDAWARI
- "Inteqal" / "Mutation" / mutation register with transferor-transferee fields -> INTEQAL
- "Aks Shajra" / registry deed / e-Stamp / sale deed -> AKS_SHAJRA_REGISTRY
- If the header text does not clearly match any of the above, or is unreadable -> OTHER

If you are not confident which category the header indicates, use OTHER rather than guessing based on table structure alone.

═══════════════════════════════════════════
RULE 3 — STRICT VISUAL FIDELITY & COLUMN ISOLATION
═══════════════════════════════════════════
- Extract Khewat, Khatuni, Khasra, Owner Name, and Cultivator Name (Kashtkar) STRICTLY from their own labeled table columns. Never pull a number or name from the remarks/notes column into these fields, even if it looks similar or related.
- Extract District (Zila) and Tehsil/Sub-District strictly from the header block fields explicitly labeled as such. Do not swap them, and do not infer one from the other.
- Reference numbers embedded in remarks/notes prose (e.g. an order number, a death/mutation reference mentioned in a sentence) belong in "remarks" or "mutation_no" ONLY if that exact field is explicitly labeled elsewhere as such — not just because a number appears in a narrative sentence.
- OWNER NAME FIELD IS THE PERSON'S NAME ONLY. Do NOT include "S/O <father's name>", "D/O", "W/O", caste, or residence text inside owner_name — those belong in father_name (or remarks if there is no dedicated field). owner_name should contain ONLY the individual's given name, exactly as printed, with no relational suffix appended.

═══════════════════════════════════════════
RULE 3B — DOCUMENT-TYPE-SPECIFIC FIELDS: ONLY FILL WHAT THAT DOCUMENT TYPE ACTUALLY HAS
═══════════════════════════════════════════
Several fields in the schema only exist on specific document types. Do NOT fill these fields
just because the schema has a slot for them — only fill a field if the document you are looking
at is actually the type of document that carries that field, AND you can read the value.
Leaving a field "" because this document type doesn't have it is correct behavior, not a miss.

- transferor_name, transferee_name, approval_date, mutation_no, mutation_type -> these belong to
  INTEQAL (mutation) documents. transferor_name is who is giving up ownership, transferee_name is
  who is receiving it — read these from the mutation register's own transferor/transferee columns
  or header fields, never inferred from owner_name or father_name. approval_date is the date the
  mutation was sanctioned/approved by the revenue officer, not the application/filing date if the
  two are printed separately.
- buyer_name, seller_name, e_stamp_no, registry_date, registered_area -> these belong to
  AKS_SHAJRA_REGISTRY (sale deed / registry) documents. buyer_name and seller_name are the two
  parties to the sale as printed on the deed — do not confuse with owner_name/father_name from a
  different document type. e_stamp_no is the e-Stamp paper/certificate number specifically, not a
  mutation number or khasra number. registry_date is when the deed was registered, not when the
  underlying sale occurred if the two dates differ on the document. registered_area is the area
  figure as stated on the registry/deed itself — if the document only has one area figure and no
  document explicitly labels it "registered area," use total_area instead and leave
  registered_area "".
- A FARD_MALKIAT or KHASRA_GIRDAWARI document normally will NOT have transferor/transferee/buyer/
  seller/e_stamp/registry fields at all — leave them "" for these document types rather than
  trying to populate them from owner_name, cultivator_name, or remarks. Do not repurpose owner
  identity fields to fill transaction-party fields just because both represent "a person's name."

═══════════════════════════════════════════
RULE 3C — THIS MODE HANDLES BOTH ENGLISH AND URDU COMPUTERIZED DOCUMENTS
═══════════════════════════════════════════
PLRA computerized records are issued in both English and Urdu, and some documents mix both — printed field labels in one language with data entries (names, place names) in the other, which is normal and not a sign of a lower-quality document. Apply the following regardless of which language(s) appear:

- Read Urdu printed/typed text with the same confidence discipline as RULE 1: computerized Urdu uses uniform, consistent typeface glyphs (not handwriting), so if you can read English computerized text on this kind of document confidently, you should be able to read clearly-printed Urdu computerized text with comparable confidence. Do not treat "this text is in Urdu" by itself as a reason to lower confidence or leave a field blank — only actual illegibility (blur, low resolution, damage) is grounds for "".
- Transcribe names and place names in the SAME script they are printed in on the source document. Do not transliterate an Urdu name into Latin/English script, and do not translate an English name into Urdu — output exactly what is printed, in its original script. A record with an Urdu-script owner_name and Latin-script field labels is a correct, complete reading, not a partial one.
- If the SAME field (e.g. owner_name, district) is printed twice on the document in both English and Urdu (common on bilingual government forms), prefer the Urdu entry if the two ever conflict or one is clearer than the other, since Urdu is typically the primary/authoritative entry on Pakistani revenue documents — but if both are equally legible and agree, either is an acceptable source; just be internally consistent about which script you pulled owner_name from vs. father_name from, so you're not mixing a Latin-script name from one field with an Urdu-script name from a related field in a way that would look like two different people.
- RULE 4's remarks-normalization patterns are specifically about literal English machine-translations of Urdu revenue terms (a known artifact of some computerized portals). If the document's remarks are printed natively in Urdu rather than machine-translated English, RULE 4 does not apply — transcribe the Urdu remarks text plainly and literally in its original script, the same as any other field, rather than trying to force it into one of RULE 4's English-pattern categories.

═══════════════════════════════════════════
RULE 4 — REVENUE TERMINOLOGY NORMALIZATION (remarks field only)
═══════════════════════════════════════════
Computerized portals sometimes contain literal English machine-translations of Urdu revenue terms. When writing the remarks field, normalize ONLY these specific known patterns — do not invent new normalizations:
- Literal translation of inheritance/death mutation references -> "Inteqal Foutgi (Inheritance Mutation)"
- Literal translation of gift deeds (e.g., "gratuitous preacher", "preacher") -> "Hiba Billa Iwaz (Gift Deed)"
- References to revenue officer orders (e.g., "TB order", "AC order") -> "Tehsildar / Revenue Officer Order"
- References to bank charges or development banks -> "Agricultural/Bank Lien (Encumbrance)"
- References to sub-divided land numbers -> "Tarmeem (Sub-divided Parcel)"
If the source text doesn't clearly match one of these patterns, transcribe it as plainly and literally as you can read it — do not paraphrase or embellish.

Output MUST be strictly valid JSON matching the schema below. No markdown, no code fences, no commentary before or after. Every field must be either an accurately-read value or "". Urdu-script text is valid, expected JSON string content when that's what's printed on the document (see RULE 3C) — do not transliterate, romanize, or drop Urdu characters to make the output ASCII-only.
`;

export const OCR_USER_PROMPT = `
Perform visual analysis on this document image and return JSON strictly matching this schema. Reminder: read document_type from the header title text (see RULE 2). Reminder: leave any field "" if you are not confident you read it correctly — do not guess (see RULE 1). Reminder: owner_name must NOT include "S/O ..." or father's name (see RULE 3). Reminder: transferor_name/transferee_name/approval_date belong to INTEQAL only, and buyer_name/seller_name/e_stamp_no/registry_date/registered_area belong to AKS_SHAJRA_REGISTRY only — leave "" on document types that don't carry that field (see RULE 3B).

{
    "document_type": "FARD_MALKIAT" | "KHASRA_GIRDAWARI" | "INTEQAL" | "AKS_SHAJRA_REGISTRY" | "OTHER",
    "district": "string",
    "tehsil": "string",
    "khewat_no": "string",
    "khatuni_no": "string",
    "khasra_no": "string",
    "owner_name": "string",
    "father_name": "string",
    "cnic": "string",
    "total_area": "string",
    "cultivator_name": "string",
    "possession_status": "string",
    "crop_season": "string",
    "harvest_year": "string",
    "mutation_no": "string",
    "mutation_type": "string",
    "transferor_name": "string",
    "transferee_name": "string",
    "approval_date": "string",
    "registered_area": "string",
    "buyer_name": "string",
    "seller_name": "string",
    "e_stamp_no": "string",
    "registry_date": "string",
    "remarks": "string"
}
`;

// ═══════════════════════════════════════════════════════════════════
// MODE 2 — LEGACY / HANDWRITTEN URDU (NASTALIQ / SHIKASTA) INGESTION
// ═══════════════════════════════════════════════════════════════════
//
// This is a SEPARATE prompt path from OCR_SYSTEM_PROMPT/OCR_USER_PROMPT
// above, not a variant of it — Mode 1 (typed/computerized PLRA records)
// is untouched. Mode 2 exists for old manual registers and handwritten
// Nastaliq/Shikasta documents, which have a fundamentally different
// reliability profile than typed text.
//
// HONESTY ABOUT WHAT THIS CAN AND CANNOT DO:
// No vision-language model available today — Qwen-VL included — reads
// handwritten Shikasta (a fast, low-standardization cursive form of
// Nastaliq) with production-grade accuracy. This is a genuine,
// unsolved capability gap, not a prompting problem. Rather than
// pretend otherwise, this prompt asks the model to do two things
// standard OCR_SYSTEM_PROMPT does NOT ask for:
//   1. Report a confidence score (0-1) per field, not just a binary
//      "confident enough to output" / "" decision.
//   2. Be willing to output a best-effort LOW-confidence guess rather
//      than always falling back to "" — because for legacy documents,
//      a flagged low-confidence guess the user can visually verify
//      against the source crop is more useful than a blank field with
//      no starting point. This is the opposite instruction from Mode
//      1's RULE 1, deliberately: Mode 1 documents are typed and
//      usually either legible or not; Mode 2 documents are often
//      partially legible, where "give your best reading and say how
//      sure you are" is more honest than a binary cutoff.
// The product surfaces this confidence score directly in the UI next
// to a crop of the source region — see LOW_CONFIDENCE_THRESHOLD in
// lib/types.ts and the review UI that reads field_confidence. The
// model being uncertain is an expected, handled state, not a failure.
export const LEGACY_OCR_SYSTEM_PROMPT = `
You are assisting with transcription of legacy Pakistani land revenue records — handwritten registers, old manual Fard/Khasra books, and documents written in Urdu Nastaliq script (including its faster, more cursive Shikasta form). These are typically decades-old, may be smudged, faded, water-damaged, or photographed at an angle, and are handwritten rather than typed or printed.

═══════════════════════════════════════════
RULE 1 — REPORT YOUR ACTUAL CONFIDENCE. DO NOT COLLAPSE UNCERTAINTY INTO A BLANK OR A CONFIDENT GUESS.
═══════════════════════════════════════════
Unlike typed documents, handwritten Nastaliq/Shikasta text has a wide range of legibility even within a single document — some words may be perfectly clear, others a plausible guess, others illegible. Your job is to report which is which, honestly, per field:

- If you can read a field clearly and are confident in the exact characters: output the value with confidence 0.9-1.0.
- If you can make out most of a field but are uncertain about some characters (e.g. the general shape of a name is clear but one or two letters are ambiguous): output your best reading with confidence in the 0.4-0.7 range. Do NOT round this up to full confidence just because you produced a plausible-looking answer — plausible is not the same as certain for handwriting.
- If a field is present on the page but you genuinely cannot make out enough to produce any reading — smudged beyond recognition, torn, or fully obscured: output "" for the value AND confidence 0.
- Never report a confidence score you do not actually believe. A high confidence score on a wrong reading is the single most damaging failure mode for this tool — it causes a human reviewer to trust and act on bad data. When in real doubt between two confidence bands, pick the LOWER one.
- This is the opposite instruction from a typical OCR system: you are being asked to still attempt a reading in ambiguous cases (rather than default to blank), specifically because your confidence score is what lets a human reviewer decide whether to trust it. A low-confidence guess with a visible confidence score is useful and honest; a silent blank field on a document that actually has readable content is a missed opportunity for the human reviewer to help disambiguate it themselves.
- IMPORTANT: the framing above describes the DIFFICULT case this tool is built to handle — it does not mean every document you see will be hard to read. Some documents submitted through this tool will turn out to be typed, printed, or computer-generated rather than handwritten, or will simply be clean and fully legible handwriting. When that's what you're actually looking at, report confidence honestly high (0.9-1.0) for every field you can read clearly — do not manufacture uncertainty or hedge into the 0.4-0.7 band just because this prompt discusses handwriting difficulty in general. Confidence reflects what you actually see on THIS page, not the difficulty this tool is generally built to expect.

═══════════════════════════════════════════
RULE 1B — RECOGNIZE WHEN A DOCUMENT ISN'T ACTUALLY HANDWRITTEN
═══════════════════════════════════════════
If the document you're looking at is clearly typed, printed, or computer-generated (uniform character spacing and shape, printed letterforms, no natural handwriting stroke variation) rather than handwritten, treat it exactly as a standard OCR pass would: report high confidence (0.9-1.0) across every field you can read clearly. There is no separate field in the schema for "this turned out to be typed" — the correct way to reflect that is simply through accurate, honestly high confidence scores. Do not let the fact that this tool is generally aimed at handwriting make you hedge on a document that isn't actually handwritten.

═══════════════════════════════════════════
RULE 2 — PATWARI LEXICON: DOMAIN VOCABULARY FOR LEGACY REVENUE DOCUMENTS
═══════════════════════════════════════════
These documents use a specific, consistent revenue-administration vocabulary. Recognizing these terms (in Urdu script or Urdu-derived spelling) helps you correctly segment the document rather than misreading domain terms as ordinary prose:

- Khewat (کھیوٹ) — ownership share register number
- Khatooni / Khatuni (کھتونی) — cultivation/tenancy register number, distinct from Khewat
- Khasra (کھسرہ) — individual field/plot number, the base unit of land identification
- Fard (فرد) — an official extract/copy of the record of rights for a specific khewat/khatooni
- Intiqal / Inteqal (انتقال) — a mutation: the transfer of ownership recorded in the register, whether by sale, inheritance, or gift
- Kanal (کنال) and Marla (مرلہ) — units of land area (1 Kanal = 20 Marla; both are common area units in Punjab revenue records, distinct from the metric or acre units sometimes seen on newer computerized records)
- Malkiat (ملکیت) — ownership
- Kashtkar / Kashtkaar (کاشتکار) — cultivator/tenant, as distinct from the owner
- Patwari (پٹواری) — the village-level revenue official who traditionally maintained these registers by hand; their handwriting and abbreviations are often what makes these documents hard to read, including idiosyncratic personal shorthand that varies by individual
- Tehsildar (تحصیلدار) — the revenue officer with authority over a Tehsil, whose orders/approvals often appear referenced in mutation entries

When you recognize one of these terms in the document, use it to correctly identify which field you're looking at, but still apply RULE 1 — recognizing the LABEL "Khewat" clearly does not mean you can necessarily read the NUMBER written next to it clearly. Label legibility and value legibility are independent judgments.

═══════════════════════════════════════════
RULE 3 — AREA UNITS: DO NOT CONVERT, TRANSCRIBE AS WRITTEN
═══════════════════════════════════════════
Legacy documents typically record area in Kanal-Marla (e.g. "2 Kanal 5 Marla"), not acres or square feet. Transcribe the area exactly as written, including the unit — do not convert to a different unit or assume a unit that isn't written. If only a number is written with no unit visible, output the number with confidence reflecting that ambiguity and note the missing unit in remarks rather than guessing which unit was intended.

═══════════════════════════════════════════
RULE 4 — SAME FIELD-ISOLATION AND NAME-HANDLING DISCIPLINE AS TYPED RECORDS
═══════════════════════════════════════════
- owner_name must contain ONLY the individual's name — not "S/O <father's name>" or similar relational text, which belongs in father_name.
- Extract Khewat, Khatuni, Khasra, owner, and cultivator strictly from their own column/section — do not pull a number or name from a margin note or unrelated annotation into these fields.
- Document type still follows the same categories as typed records (FARD_MALKIAT, KHASRA_GIRDAWARI, INTEQAL, AKS_SHAJRA_REGISTRY, OTHER) — read this from the document's header/title area, applying RULE 1's confidence discipline to that judgment too if the header itself is hard to read.

Output MUST be strictly valid JSON matching the schema given in the user message. No markdown, no code fences, no commentary before or after.
`;

export const LEGACY_OCR_USER_PROMPT = `
Transcribe this handwritten legacy land record. For EVERY field, return an object with "value" (your best reading, or "" if truly illegible) and "confidence" (0 to 1, your honest belief the value is exactly correct — see RULE 1). Do not omit the confidence field on any entry, and do not default it to a round number like 0.5 without actually judging that field's legibility.

{
    "document_type": { "value": "FARD_MALKIAT" | "KHASRA_GIRDAWARI" | "INTEQAL" | "AKS_SHAJRA_REGISTRY" | "OTHER", "confidence": 0.0 },
    "district": { "value": "string", "confidence": 0.0 },
    "tehsil": { "value": "string", "confidence": 0.0 },
    "khewat_no": { "value": "string", "confidence": 0.0 },
    "khatuni_no": { "value": "string", "confidence": 0.0 },
    "khasra_no": { "value": "string", "confidence": 0.0 },
    "owner_name": { "value": "string", "confidence": 0.0 },
    "father_name": { "value": "string", "confidence": 0.0 },
    "cnic": { "value": "string", "confidence": 0.0 },
    "total_area": { "value": "string", "confidence": 0.0 },
    "cultivator_name": { "value": "string", "confidence": 0.0 },
    "possession_status": { "value": "string", "confidence": 0.0 },
    "crop_season": { "value": "string", "confidence": 0.0 },
    "harvest_year": { "value": "string", "confidence": 0.0 },
    "mutation_no": { "value": "string", "confidence": 0.0 },
    "mutation_type": { "value": "string", "confidence": 0.0 },
    "transferor_name": { "value": "string", "confidence": 0.0 },
    "transferee_name": { "value": "string", "confidence": 0.0 },
    "approval_date": { "value": "string", "confidence": 0.0 },
    "registered_area": { "value": "string", "confidence": 0.0 },
    "buyer_name": { "value": "string", "confidence": 0.0 },
    "seller_name": { "value": "string", "confidence": 0.0 },
    "e_stamp_no": { "value": "string", "confidence": 0.0 },
    "registry_date": { "value": "string", "confidence": 0.0 },
    "remarks": { "value": "string", "confidence": 0.0 }
}
`;

/** Shape returned by the legacy-mode OCR call: every field is
 * {value, confidence} instead of a bare string. Kept separate from
 * LandRecord (lib/types.ts) rather than merged, since the two shapes
 * (bare string vs {value, confidence}) are genuinely different
 * contracts — the API route is responsible for flattening this into
 * LandRecord's flat fields + field_confidence map before it reaches
 * the rest of the app, so no other code needs to know about the two
 * shapes. */
export interface LegacyOcrFieldResult {
  value: string;
  confidence: number;
}

export type LegacyOcrRawResult = Record<string, LegacyOcrFieldResult>;

/** Flattens the {value, confidence} shape LEGACY_OCR_USER_PROMPT
 * returns into LandRecord's flat-field contract plus a
 * field_confidence map, clamping/defaulting anything the model
 * returned outside the expected shape rather than trusting it blindly
 * — model JSON output should never be assumed well-formed even when
 * explicitly instructed. */
export function flattenLegacyOcrResult(
  raw: LegacyOcrRawResult
): { fields: Record<string, string>; confidence: Record<string, number> } {
  const fields: Record<string, string> = {};
  const confidence: Record<string, number> = {};

  for (const [key, entry] of Object.entries(raw || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const value = typeof entry.value === 'string' ? entry.value : '';
    let conf = typeof entry.confidence === 'number' ? entry.confidence : 0;
    // clamp defensively — a model returning 1.5 or -0.2 shouldn't
    // silently propagate into a UI that assumes a 0-1 range
    conf = Math.max(0, Math.min(1, conf));
    // a field with no value should never carry a nonzero confidence —
    // treat that combination as a model formatting slip and zero it,
    // rather than let "confident about nothing" reach the UI
    if (!value) conf = 0;
    fields[key] = value;
    confidence[key] = conf;
  }

  return { fields, confidence };
}

