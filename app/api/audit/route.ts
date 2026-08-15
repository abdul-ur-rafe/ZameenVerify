// app/api/audit/route.ts
//
// Runs the cross-document audit against an already-extracted set of
// land records. Called once, when the user explicitly clicks "Run
// Audit" — NOT automatically after every document add. This keeps
// LLM cost/latency predictable: OCR happens once per document via
// /api/extract, audit happens once per user action here.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { parseModelJson } from '@/lib/ocr-helpers';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const openai = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const records = body?.records;

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json(
        { error: 'No documents to audit. Add at least one document first.' },
        { status: 400 }
      );
    }

    const crossAuditPrompt = `
You are an expert land record legal auditor. Review the extracted JSON land record data:

EXTRACTED RECORDS:
${JSON.stringify(records, null, 2)}

═══════════════════════════════════════════
STEP 1 — SAME-PARCEL CHECK (do this first, before anything else)
═══════════════════════════════════════════
Before running any fraud/risk comparison, determine whether these documents actually describe
the SAME land parcel / same chain of title. Compare district, tehsil, khewat/khatuni/khasra
numbers, and owner identity across all records.

- If there is only ONE document in the batch, same_parcel_batch = true (nothing to compare against).
- If there are multiple documents and they clearly reference DIFFERENT districts, DIFFERENT
  khasra numbers with no overlap, and DIFFERENT unrelated owners with no stated relationship
  (e.g. not a buyer/seller pair, not an inheritance chain) — this is NOT a valid comparison set.
  Set same_parcel_batch = false.
- Only proceed to fraud/risk scoring (Step 2) if same_parcel_batch = true. If false, you are
  auditing unrelated documents, not a single property's paper trail — the mismatches you'd find
  are expected and meaningless, not signs of fraud. Do not penalize risk_level for this.

═══════════════════════════════════════════
STEP 2 — PER-CHECK EVALUATION (only meaningful when same_parcel_batch = true)
═══════════════════════════════════════════
Evaluate each of these four checks independently and honestly. Distinguish two different
situations, since they should NOT be scored the same way:
  (a) a field has a real value and nothing else conflicts with it — this should PASS.
  (b) a field is genuinely blank/missing — this is NOT the same as "nothing to contradict," it
      means no confirmed value exists at all. Do not default this to PASS.

- khasra_match: Only TRUE if at least one record has an actual (non-empty) khasra_no AND no
  other record states a conflicting one. If khasra_no is blank/missing on every record in the
  batch, there is no confirmed parcel identifier at all — set this FALSE, since "no data" is not
  the same as "verified match."
- owner_possession_match: Does Owner Name match Cultivator Name (or Cultivator is blank/Khud
  Kasht/self, or there's only one record with no third party named)? TRUE unless an unrecognized
  third-party cultivator is explicitly named. (A blank cultivator field genuinely does mean
  self-cultivation/no conflict in this specific case, unlike khasra_no above — there is no
  separate "cultivator identifier" that's expected to always be populated.)
- title_chain_verified: Is there a plausible ownership history with no unexplained gap or
  contradiction? A single document — even one whose remarks mention a mutation, inheritance,
  bank reference, or administrative order in passing — counts as TRUE by default. Routine
  administrative history mentioned in a document's own remarks is normal content, not a red
  flag, and is not something a single document needs to "independently verify" about itself.
  Only set this FALSE when there is an ACTUAL contradiction or unexplained break across
  MULTIPLE documents (e.g. one document's stated owner doesn't match who a later document
  says transferred the land, or a mutation is referenced that conflicts with another record's
  ownership claim). Never fail this solely because a single record lacks a second document to
  corroborate it — absence of corroboration is not the same as a contradiction.
- area_match: Do total area figures agree, or is there only one record (nothing to conflict
  with)? Only fail this for an ACTUAL numeric conflict — different formatting/notation of the
  same area (e.g. "2-0-0" vs "2 Kanals 0 Marlas") is NOT a mismatch, only fail if the underlying
  quantities actually differ.
- encumbrance_free: Read the remarks/text of every record for legal encumbrances that are
  ACTIVE and CURRENT — an ongoing court stay order, litigation that is still pending, a fraud
  claim that is still disputed, a bank lien/mortgage that is still outstanding, or an attachment
  order still in effect. This is independent of the other four checks: a document can have a
  perfectly matching khasra number and clean possession while STILL being legally encumbered.

  CRITICAL DISTINCTION — do not confuse a HISTORICAL transaction with a CURRENT encumbrance:
  - A mutation record explaining how the land was acquired (inheritance, gift, sale, a past bank
    loan that funded a transfer, an old administrative order that has already been executed) is
    normal historical content, not an encumbrance. This includes references to a bank in the
    context of "as gratuitous preacher" or "gift deed" (per the terminology in RULE 4) — a gift
    transaction involving a bank as an intermediary in the PAST is not a live lien.
  - The mere presence of the words "bank," "loan," "mutation," or a reference/account number in
    remarks does NOT by itself mean an active encumbrance. Ask: does the text describe something
    ONGOING and UNRESOLVED right now, or does it describe a transaction that was completed and
    recorded in the past? Only the former is FALSE.
  - Set this FALSE only when the text explicitly signals something unresolved/ongoing: words
    like "stay order," "pending litigation," "dispute," "objection filed," "under investigation,"
    "attachment," or an explicit statement that a claim was rejected/contested. A closed
    historical mutation, inheritance, or gift transaction — even one that mentions a bank by
    name — is TRUE (encumbrance-free) unless it actually says the matter is still unresolved.
  - Your reasoning for this field must name the SPECIFIC unresolved/ongoing issue in your own
    words if you set it FALSE (e.g. "a stay order from Civil Court X is currently in effect").
    If you cannot point to a specific still-open issue and are only reacting to the presence of
    a bank name or account number, that is not sufficient grounds — set this TRUE instead.

═══════════════════════════════════════════
STEP 3 — RISK LEVEL (mechanical, do not override with judgment)
═══════════════════════════════════════════
- If document_type = "OTHER" or essential fields (district, owner_name, khasra_no) are blank/
  unreadable on every document -> risk_level = "INVALID".
- Else if same_parcel_batch = false -> risk_level = "LOW" and clearly state in audit_findings
  that these documents do not appear to describe the same property, so no fraud comparison
  could be meaningfully performed — this is not a fraud signal, it's a data-scope note.
- Else, count how many of the five checks (khasra_match, owner_possession_match,
  title_chain_verified, area_match, encumbrance_free) are FALSE:
    - 0 false -> LOW
    - 1 false, AND it is only area_match (not encumbrance_free, not a cultivator mismatch, not
      a khasra mismatch, not a broken title chain) -> MEDIUM
    - Any cultivator mismatch (owner_possession_match = false due to a real third party),
      OR khasra_match = false due to an actual conflict, OR title_chain_verified = false due to
      an actual contradiction, OR encumbrance_free = false (active litigation, court order,
      fraud claim, lien, or dispute) -> HIGH, REGARDLESS of how many other checks pass. These
      four are disqualifying on their own — do not average them against passing checks to land
      on MEDIUM. An active court stay order or fraud claim is exactly the kind of thing this
      audit exists to catch — never let it be outweighed by three unrelated checks passing.
Apply this mechanically. Do not soften a HIGH to a MEDIUM because "most other things looked fine."

CONCISE OUTPUT FORMAT:
- Formulate 3 to 4 short findings.
- Each finding MUST start with a bracketed tag: "[Category]: Short summary (Max 20 words)".
- DO NOT copy paste long raw text snippets from remarks. Summarize legal meaning cleanly.

Return STRICT JSON only:
{
    "same_parcel_batch": boolean,
    "khasra_match": boolean,
    "owner_possession_match": boolean,
    "title_chain_verified": boolean,
    "area_match": boolean,
    "encumbrance_free": boolean,
    "reasoning": {
        "khasra_match": "One short sentence: what specifically was compared and why this is true/false",
        "owner_possession_match": "One short sentence: what specifically was compared and why this is true/false",
        "title_chain_verified": "One short sentence: what specifically was compared and why this is true/false",
        "area_match": "One short sentence: what specifically was compared and why this is true/false",
        "encumbrance_free": "One short sentence: what specifically was found (or not found) and why this is true/false"
    },
    "risk_level": "LOW" | "MEDIUM" | "HIGH" | "INVALID",
    "audit_findings": [
        "String detailing concise bullet finding"
    ]
}
Note: "risk_level" here is your best-effort classification when a comparison IS meaningful —
the server will override this to NOT_COMPARABLE automatically when same_parcel_batch is false,
so you do not need to invent a special value for that case yourself.
`;

    let cleanVerifyJson: any = {
      same_parcel_batch: true,
      khasra_match: false,
      owner_possession_match: false,
      title_chain_verified: false,
      area_match: false,
      encumbrance_free: false,
      reasoning: {
        khasra_match: 'Not evaluated — audit could not be completed automatically.',
        owner_possession_match: 'Not evaluated — audit could not be completed automatically.',
        title_chain_verified: 'Not evaluated — audit could not be completed automatically.',
        area_match: 'Not evaluated — audit could not be completed automatically.',
        encumbrance_free: 'Not evaluated — audit could not be completed automatically.',
      },
      risk_level: 'INVALID',
      audit_findings: ['[System]: Audit could not be completed automatically. Please review manually.'],
    };

    try {
      const verificationResponse = await openai.chat.completions.create({
        model: 'qwen-plus',
        temperature: 0.0,
        messages: [
          {
            role: 'system',
            content: 'You output strictly raw valid JSON. Ensure audit finding bullets are concise, structured, and under 20 words each.',
          },
          { role: 'user', content: crossAuditPrompt },
        ],
      });

      const rawVerifyText = verificationResponse.choices[0].message.content || '{}';
      const parsed = parseModelJson(rawVerifyText, null);
      if (parsed) cleanVerifyJson = parsed;
    } catch (auditError) {
      console.error('Audit model call failed:', auditError);
      // cleanVerifyJson keeps its safe fallback value above
    }

    // --- deterministic title-chain override for single-document batches -
    // Same lesson as the risk-level override below: prompt wording alone
    // isn't reliable enough to trust for something feeding a mechanical
    // severity calculation. With only one document, there is by definition
    // nothing else to contradict it against — routine remarks content
    // (a mutation, a bank reference, an inheritance note) is normal, not
    // a verification failure. Force this true rather than let the model
    // fail it for lacking corroboration that a single document can never
    // have.
    if (records.length === 1 && cleanVerifyJson.title_chain_verified === false) {
      cleanVerifyJson.title_chain_verified = true;
      cleanVerifyJson.reasoning = cleanVerifyJson.reasoning || {};
      cleanVerifyJson.reasoning.title_chain_verified =
        'Only one document in this batch — no second record to compare against, so there is no contradiction in the ownership history. Routine administrative references in the remarks are not a verification failure.';
    }

    // --- deterministic khasra-match override -----------------------------
    // Mirror image of the title-chain fix above, but the opposite
    // direction: a BLANK khasra_no is not "nothing to contradict," it's
    // "no confirmed parcel identifier at all." The model can still drift
    // toward defaulting this to PASS on a single document despite the
    // prompt now distinguishing the two cases, so enforce it here too —
    // this is a fact directly readable from the records themselves, no
    // judgment call needed.
    const anyConfirmedKhasra = records.some((r: any) => !!r?.khasra_no);
    if (!anyConfirmedKhasra && cleanVerifyJson.khasra_match === true) {
      cleanVerifyJson.khasra_match = false;
      cleanVerifyJson.reasoning = cleanVerifyJson.reasoning || {};
      cleanVerifyJson.reasoning.khasra_match =
        'No document in this batch has a confirmed khasra_no — there is no parcel identifier on record to verify, not a verified match.';
    }

    // --- deterministic risk-level override -----------------------------
    // The LLM can misjudge severity even with an explicit rule (observed:
    // it once returned MEDIUM for a batch with a broken title chain AND
    // a khasra mismatch, both independently HIGH-triggering per our own
    // rules). Rather than trust the model to correctly apply Step 3's
    // logic every time, recompute risk_level here from the booleans it
    // returned. This makes severity mechanical and reproducible instead
    // of a per-call judgment call — same inputs always produce the same
    // risk_level, which matters for something used in fraud auditing.
    //
    // INVALID means "this isn't a usable land document at all" — wrong
    // document type, or so unreadable that essentially nothing could be
    // extracted. It does NOT mean "one expected field happens to be
    // blank" — a document missing its khasra_no while everything else
    // reads cleanly is a data-completeness note (already surfaced in
    // audit_findings), not grounds to reject the document outright.
    // Conflating the two previously produced a genuine contradiction:
    // every per-check box could PASS while the badge still said
    // INVALID — DO NOT PROCEED, which undermines trust in the whole
    // result. A document only counts as invalid here when it fails on
    // essentially every axis: wrong type, AND missing district, AND
    // missing owner — not any single one of those alone.
    const isInvalidDoc = records.every((r: any) => {
      const type = r?.document_type;
      const missingDistrict = !r?.district;
      const missingOwner = !r?.owner_name;
      return type === 'OTHER' || (missingDistrict && missingOwner);
    });

    if (isInvalidDoc) {
      cleanVerifyJson.risk_level = 'INVALID';
    } else if (cleanVerifyJson.same_parcel_batch === false) {
      // Genuinely distinct outcome, not a reused LOW/MEDIUM value — LOW
      // should only ever mean "compared and found clean." When the
      // documents don't describe the same parcel, no fraud comparison
      // was meaningfully possible at all, which is a different claim.
      cleanVerifyJson.risk_level = 'NOT_COMPARABLE';
    } else {
      // khasra_match failing has two different causes that shouldn't carry
      // the same severity: an actual CONFLICT between documents (genuine
      // fraud signal, correctly disqualifying/HIGH) vs. simply no khasra
      // number being present anywhere to confirm (a completeness gap,
      // already handled by the MEDIUM cap below — not on its own grounds
      // for HIGH). Only treat khasra_match as disqualifying when there
      // was something to actually conflict, i.e. it isn't the
      // no-confirmed-khasra case just computed above.
      const khasraDisqualifies = cleanVerifyJson.khasra_match === false && anyConfirmedKhasra;

      const disqualifyingFailure =
        cleanVerifyJson.owner_possession_match === false ||
        khasraDisqualifies ||
        cleanVerifyJson.title_chain_verified === false ||
        cleanVerifyJson.encumbrance_free === false;

      const failCount = [
        cleanVerifyJson.khasra_match,
        cleanVerifyJson.owner_possession_match,
        cleanVerifyJson.title_chain_verified,
        cleanVerifyJson.area_match,
        cleanVerifyJson.encumbrance_free,
      ].filter((v) => v === false).length;

      if (disqualifyingFailure) {
        cleanVerifyJson.risk_level = 'HIGH';
      } else if (failCount >= 1) {
        // only area_match (or nothing disqualifying) failed
        cleanVerifyJson.risk_level = 'MEDIUM';
      } else {
        cleanVerifyJson.risk_level = 'LOW';
      }

      // Even when every per-check comparison passes, a document missing
      // a core identifying field (khasra_no, khewat_no, or khatuni_no)
      // has a real completeness gap that a plain LOW badge would hide —
      // the checks pass because there's nothing to CONTRADICT, not
      // because the record is fully verified. Cap at MEDIUM so this
      // isn't presented as a clean bill of health; the specific gap is
      // already named in audit_findings for detail.
      if (cleanVerifyJson.risk_level === 'LOW') {
        const missingCoreField = records.some(
          (r: any) => !r?.khasra_no || !r?.khewat_no || !r?.khatuni_no,
        );
        if (missingCoreField) {
          cleanVerifyJson.risk_level = 'MEDIUM';
          if (Array.isArray(cleanVerifyJson.audit_findings)) {
            cleanVerifyJson.audit_findings.push(
              '[Data Completeness]: One or more core parcel identifiers (Khasra/Khewat/Khatuni) are missing — risk rating capped at MEDIUM pending complete records.',
            );
          }
        }
      }
    }

    const recordIds = records.map((r: any) => r.id).filter(Boolean);

    const { error: verifyInsertError } = await supabase.from('verifications').insert({
      land_record_id: recordIds[0] || null,
      land_record_ids: recordIds,
      risk_level: cleanVerifyJson.risk_level,
      khasra_match: cleanVerifyJson.khasra_match,
      owner_possession_match: cleanVerifyJson.owner_possession_match,
      title_chain_verified: cleanVerifyJson.title_chain_verified,
      area_match: cleanVerifyJson.area_match,
      encumbrance_free: cleanVerifyJson.encumbrance_free,
      audit_findings: cleanVerifyJson.audit_findings,
      reasoning: cleanVerifyJson.reasoning || null,
      same_parcel_batch: cleanVerifyJson.same_parcel_batch ?? null,
    });

    // The audit result itself is always returned to the user below —
    // this failure only means it wasn't SAVED to the DB. We surface it
    // as a non-fatal warning field rather than silently swallowing it,
    // so the frontend can show "this result won't be in your history"
    // instead of the user finding out later that nothing was recorded.
    let persistedWarning: string | null = null;
    if (verifyInsertError) {
      console.error('verifications insert failed:', verifyInsertError);
      persistedWarning = 'Audit completed, but the result could not be saved to the database.';
    }

    return NextResponse.json({
      success: true,
      document_count: records.length,
      verification: cleanVerifyJson,
      persisted: !verifyInsertError,
      warning: persistedWarning,
    });
  } catch (error: any) {
    console.error('Unhandled error in /api/audit:', error);
    return NextResponse.json(
      { error: 'Something went wrong while running the audit. Please try again.' },
      { status: 500 }
    );
  }
}
