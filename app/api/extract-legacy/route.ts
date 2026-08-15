// app/api/extract-legacy/route.ts
//
// Mode 2 ingestion: handwritten/legacy land record documents (Urdu
// Nastaliq/Shikasta, old manual registers). This is a SEPARATE route
// from /api/extract (Mode 1, typed/computerized PLRA records) rather
// than a branch inside it, because the two pipelines genuinely
// diverge: this route calls out to the OpenCV preprocessing
// microservice (services/legacy-preprocess) before OCR, uses a
// different system/user prompt pair that asks for a confidence score
// per field (see LEGACY_OCR_SYSTEM_PROMPT in lib/ocr-helpers.ts), and
// returns a record with ingestion_mode: "legacy" plus a
// field_confidence map that Mode 1 records never have.
//
// HEIC rejection and PDF rasterization are shared with Mode 1 (see
// isUnsupportedHeic / rasterizePdfFirstPage in lib/ocr-helpers.ts) —
// those are pure file-format concerns, unrelated to which OCR
// pipeline runs afterward, so there's no reason to duplicate them.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import {
  isUnsupportedHeic,
  rasterizePdfFirstPage,
  parseModelJson,
  LEGACY_OCR_SYSTEM_PROMPT,
  LEGACY_OCR_USER_PROMPT,
  flattenLegacyOcrResult,
  type LegacyOcrRawResult,
} from '@/lib/ocr-helpers';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const openai = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY!,
  baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
});

const MAX_FILE_SIZE_MB = 15;

// The OpenCV preprocessing microservice's URL (see
// services/legacy-preprocess/README.md for deployment). Not optional
// for this route — unlike Mode 1, which can reasonably fall back to
// unprocessed bytes if sharp() fails, legacy/handwritten scans
// genuinely need the deskew+denoise+CLAHE+binarize pipeline to have a
// realistic chance of being legible to the OCR step at all. If this
// isn't configured, fail clearly rather than silently sending a raw,
// possibly-skewed, possibly-smudged photo straight to the OCR model.
const LEGACY_PREPROCESS_SERVICE_URL = process.env.LEGACY_PREPROCESS_SERVICE_URL;

interface PreprocessServiceResponse {
  success: boolean;
  binarized_image_b64?: string;
  enhanced_grayscale_b64?: string;
  detected_skew_degrees?: number;
  ink_contrast_before?: number;
  ink_contrast_after?: number;
  processing_time_ms?: number;
  detail?: string; // FastAPI's HTTPException error shape
}

async function callPreprocessService(
  buffer: Buffer,
  fileName: string,
  contentType: string
): Promise<PreprocessServiceResponse> {
  const formData = new FormData();
  // Blob needs an ArrayBuffer, not a Node Buffer directly, in the
  // fetch/undici implementation Next.js's server runtime uses.
  const blob = new Blob([new Uint8Array(buffer)], { type: contentType });
  formData.append('file', blob, fileName);

  const response = await fetch(`${LEGACY_PREPROCESS_SERVICE_URL}/preprocess`, {
    method: 'POST',
    body: formData,
  });

  const json = (await response.json().catch(() => ({}))) as PreprocessServiceResponse;

  if (!response.ok) {
    throw new Error(
      json.detail || `Preprocessing service returned ${response.status} with no error detail.`
    );
  }
  return json;
}

export async function POST(req: Request) {
  try {
    if (!LEGACY_PREPROCESS_SERVICE_URL) {
      console.error('LEGACY_PREPROCESS_SERVICE_URL is not configured.');
      return NextResponse.json(
        {
          error:
            'Legacy document processing is not configured on this deployment. Set LEGACY_PREPROCESS_SERVICE_URL to the deployed preprocessing service URL.',
        },
        { status: 503 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: `"${file.name}" exceeds ${MAX_FILE_SIZE_MB}MB limit.` },
        { status: 400 }
      );
    }
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      return NextResponse.json(
        { error: `"${file.name}" is not a supported file type (image or PDF only).` },
        { status: 400 }
      );
    }
    if (isUnsupportedHeic(file.type, file.name)) {
      return NextResponse.json(
        {
          error: `"${file.name}" is a HEIC/HEIF photo, which isn't supported yet. Please export it as JPEG or PNG (on iPhone: Settings > Camera > Formats > "Most Compatible") and re-upload.`,
        },
        { status: 400 }
      );
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}.${fileExt}`;

    const { error: storageError } = await supabase.storage
      .from('property-documents')
      .upload(fileName, file);

    if (storageError) {
      console.error('Supabase storage upload failed:', storageError);
      return NextResponse.json(
        { error: 'Could not upload this document. Please try again.' },
        { status: 502 }
      );
    }

    const SIGNED_URL_EXPIRY_SECONDS = 60 * 60;
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('property-documents')
      .createSignedUrl(fileName, SIGNED_URL_EXPIRY_SECONDS);
    if (signedUrlError) {
      console.error('Failed to create signed URL:', signedUrlError);
    }
    const fileUrl = signedUrlData?.signedUrl ?? null;

    const bytes = await file.arrayBuffer();
    const rawBuffer = Buffer.from(bytes);
    let bufferForPreprocess: Buffer = rawBuffer;
    let contentTypeForPreprocess = file.type;

    if (file.type === 'application/pdf') {
      try {
        bufferForPreprocess = await rasterizePdfFirstPage(rawBuffer);
        contentTypeForPreprocess = 'image/png';
      } catch (rasterizeError) {
        console.error('PDF rasterization failed for legacy upload', file.name, rasterizeError);
        const message =
          rasterizeError instanceof Error
            ? rasterizeError.message
            : 'Could not process this PDF.';
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    // --- OpenCV preprocessing (deskew, denoise, CLAHE, binarize) ---
    let preprocessResult: PreprocessServiceResponse;
    try {
      preprocessResult = await callPreprocessService(bufferForPreprocess, fileName, contentTypeForPreprocess);
    } catch (preprocessError) {
      console.error('Legacy preprocessing service call failed for', file.name, preprocessError);
      const message =
        preprocessError instanceof Error
          ? preprocessError.message
          : 'Could not clean up this scan for processing.';
      return NextResponse.json({ error: message }, { status: 502 });
    }

    // Prefer the grayscale-enhanced (not fully binarized) image as the
    // OCR input — binarization is a lossy, irreversible decision, and
    // a vision-language model that's used to reading natural
    // grayscale/color images may do better on a contrast-enhanced
    // grayscale image than on a hard black/white one. The binarized
    // version is still returned by the service and available if this
    // choice needs to change after testing against real documents
    // (see the "known limitation" note in services/legacy-preprocess/README.md).
    const ocrInputBase64 = preprocessResult.enhanced_grayscale_b64;
    if (!ocrInputBase64) {
      console.error('Preprocessing service returned no image for', file.name, preprocessResult);
      return NextResponse.json(
        { error: 'The scan cleanup step did not return a usable image. Please try again.' },
        { status: 502 }
      );
    }

    // --- Qwen-VL OCR with the Patwari Lexicon / confidence-aware prompt ---
    let flattenedFields: Record<string, string> = {};
    let fieldConfidence: Record<string, number> = {};
    try {
      const ocrResponse = await openai.chat.completions.create({
        model: 'qwen-vl-max',
        temperature: 0.0,
        messages: [
          { role: 'system', content: LEGACY_OCR_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: LEGACY_OCR_USER_PROMPT },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${ocrInputBase64}` } },
            ],
          },
        ],
      });

      const rawOcrText = ocrResponse.choices[0].message.content || '{}';
      const parsed = parseModelJson(rawOcrText, {}) as LegacyOcrRawResult;
      const flattened = flattenLegacyOcrResult(
        Array.isArray(parsed) ? parsed[0] : parsed
      );
      flattenedFields = flattened.fields;
      fieldConfidence = flattened.confidence;
    } catch (ocrError) {
      console.error('Legacy OCR model call failed for file', file.name, ocrError);
      return NextResponse.json(
        { error: 'Could not read this document. Please try again or use a clearer scan.' },
        { status: 502 }
      );
    }

    const dbPayload = {
      file_url: fileUrl,
      ingestion_mode: 'legacy' as const,
      document_type: flattenedFields.document_type || 'OTHER',
      district: flattenedFields.district || '',
      tehsil: flattenedFields.tehsil || '',
      khewat_no: flattenedFields.khewat_no || '',
      khatuni_no: flattenedFields.khatuni_no || '',
      khasra_no: flattenedFields.khasra_no || '',
      owner_name: flattenedFields.owner_name || '',
      father_name: flattenedFields.father_name || '',
      cnic: flattenedFields.cnic || '',
      total_area: flattenedFields.total_area || '',
      cultivator_name: flattenedFields.cultivator_name || '',
      possession_status: flattenedFields.possession_status || '',
      crop_season: flattenedFields.crop_season || '',
      harvest_year: flattenedFields.harvest_year || '',
      mutation_no: flattenedFields.mutation_no || '',
      mutation_type: flattenedFields.mutation_type || '',
      transferor_name: flattenedFields.transferor_name || '',
      transferee_name: flattenedFields.transferee_name || '',
      approval_date: flattenedFields.approval_date || '',
      registered_area: flattenedFields.registered_area || '',
      buyer_name: flattenedFields.buyer_name || '',
      seller_name: flattenedFields.seller_name || '',
      e_stamp_no: flattenedFields.e_stamp_no || '',
      registry_date: flattenedFields.registry_date || '',
      remarks: flattenedFields.remarks || '',
      field_confidence: fieldConfidence,
      // Preprocessing diagnostics — not shown as land-record fields,
      // but useful to persist for debugging OCR quality issues against
      // a specific upload later.
      preprocessing_diagnostics: {
        detected_skew_degrees: preprocessResult.detected_skew_degrees ?? null,
        ink_contrast_before: preprocessResult.ink_contrast_before ?? null,
        ink_contrast_after: preprocessResult.ink_contrast_after ?? null,
        processing_time_ms: preprocessResult.processing_time_ms ?? null,
      },
    };

    const { data: recordData, error: dbError } = await supabase
      .from('land_records')
      .insert(dbPayload)
      .select()
      .single();

    const record = dbError ? dbPayload : recordData;
    let persistedWarning: string | null = null;
    if (dbError) {
      console.error('land_records insert failed (legacy):', dbError);
      persistedWarning = 'Document was read successfully, but could not be saved to the database.';
    }

    return NextResponse.json({ success: true, record, persisted: !dbError, warning: persistedWarning });
  } catch (error: any) {
    console.error('Unhandled error in /api/extract-legacy:', error);
    return NextResponse.json(
      { error: 'Something went wrong while processing this document. Please try again.' },
      { status: 500 }
    );
  }
}
