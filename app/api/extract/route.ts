// app/api/extract/route.ts
//
// Extracts ONE document at a time. Called every time the user adds a
// document to their working batch (one-by-one flow). Does OCR only —
// no cross-document audit here. The frontend accumulates the returned
// records client-side and sends the full set to /api/audit when the
// user is ready to run the audit.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import {
  preprocessForOcr,
  parseModelJson,
  OCR_SYSTEM_PROMPT,
  OCR_USER_PROMPT,
  isUnsupportedHeic,
  rasterizePdfFirstPage,
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

export async function POST(req: Request) {
  try {
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
    // sharp's prebuilt binaries can't decode HEIC/HEIF (patent-encumbered
    // codec, requires a custom-compiled libvips we don't control on a
    // standard deploy). Reject explicitly here instead of letting it fail
    // silently later inside preprocessForOcr. iPhones default to HEIC, so
    // this is a realistic upload, not an edge case — a clear message here
    // is the safe alternative to a mysterious OCR failure mid-demo.
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

    // NOTE: this only produces a real short-lived URL if 'property-documents'
    // is a PRIVATE bucket. Previously this called getPublicUrl(), which
    // returns a permanent, unauthenticated link regardless of bucket
    // visibility — meaning every uploaded document, including CNIC/national
    // ID scans, sat behind a guessable-if-leaked but otherwise-unprotected
    // public URL. createSignedUrl requires a private bucket to actually be
    // private; if 'property-documents' is currently a public bucket in your
    // Supabase project, flip it to private in the dashboard (Storage ->
    // property-documents -> Settings) or this call will still work but
    // won't add any real protection.
    const SIGNED_URL_EXPIRY_SECONDS = 60 * 60; // 1 hour — long enough for the
    // current request/response cycle and any immediate follow-up, short
    // enough that a leaked URL doesn't stay valid indefinitely.
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('property-documents')
      .createSignedUrl(fileName, SIGNED_URL_EXPIRY_SECONDS);

    if (signedUrlError) {
      console.error('Failed to create signed URL:', signedUrlError);
    }
    const fileUrl = signedUrlData?.signedUrl ?? null;

    const bytes = await file.arrayBuffer();
    const rawBuffer = Buffer.from(bytes);
    const isPdf = file.type === 'application/pdf';

    let processedBuffer: Buffer;
    let mimeType: string;
    try {
      if (isPdf) {
        // Vision models expect raster image bytes, not a PDF container —
        // rasterize page 1 to PNG first, then run it through the same
        // upscale/normalize pipeline used for photos (dense revenue
        // tables benefit from the same legibility pass either way).
        const pngPage = await rasterizePdfFirstPage(rawBuffer);
        ({ buffer: processedBuffer, mimeType } = await preprocessForOcr(pngPage));
      } else {
        ({ buffer: processedBuffer, mimeType } = await preprocessForOcr(rawBuffer));
      }
    } catch (preprocessError) {
      console.error('Preprocessing failed for file', file.name, preprocessError);
      const message =
        preprocessError instanceof Error
          ? preprocessError.message
          : 'Could not process this file. Please try a different file or format.';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const base64Image = processedBuffer.toString('base64');

    let cleanOcrJson: any = { document_type: 'OTHER' };
    try {
      const ocrResponse = await openai.chat.completions.create({
        model: 'qwen-vl-max',
        temperature: 0.0,
        messages: [
          { role: 'system', content: OCR_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: OCR_USER_PROMPT },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            ],
          },
        ],
      });

      const rawOcrText = ocrResponse.choices[0].message.content || '{}';
      const parsed = parseModelJson(rawOcrText, { document_type: 'OTHER' });
      cleanOcrJson = Array.isArray(parsed) ? parsed[0] : (parsed.extracted_fields || parsed.data || parsed);
    } catch (ocrError) {
      console.error('OCR model call failed for file', file.name, ocrError);
      return NextResponse.json(
        { error: 'Could not read this document. Please try again or use a clearer scan.' },
        { status: 502 }
      );
    }

    const dbPayload = {
      file_url: fileUrl,
      document_type: cleanOcrJson?.document_type || 'OTHER',
      district: cleanOcrJson?.district || '',
      tehsil: cleanOcrJson?.tehsil || '',
      khewat_no: cleanOcrJson?.khewat_no || '',
      khatuni_no: cleanOcrJson?.khatuni_no || '',
      khasra_no: cleanOcrJson?.khasra_no || '',
      owner_name: cleanOcrJson?.owner_name || '',
      father_name: cleanOcrJson?.father_name || '',
      cnic: cleanOcrJson?.cnic || '',
      total_area: cleanOcrJson?.total_area || '',
      cultivator_name: cleanOcrJson?.cultivator_name || '',
      possession_status: cleanOcrJson?.possession_status || '',
      crop_season: cleanOcrJson?.crop_season || '',
      harvest_year: cleanOcrJson?.harvest_year || '',
      mutation_no: cleanOcrJson?.mutation_no || '',
      mutation_type: cleanOcrJson?.mutation_type || '',
      transferor_name: cleanOcrJson?.transferor_name || '',
      transferee_name: cleanOcrJson?.transferee_name || '',
      approval_date: cleanOcrJson?.approval_date || '',
      registered_area: cleanOcrJson?.registered_area || '',
      buyer_name: cleanOcrJson?.buyer_name || '',
      seller_name: cleanOcrJson?.seller_name || '',
      e_stamp_no: cleanOcrJson?.e_stamp_no || '',
      registry_date: cleanOcrJson?.registry_date || '',
      remarks: cleanOcrJson?.remarks || '',
    };

    const { data: recordData, error: dbError } = await supabase
      .from('land_records')
      .insert(dbPayload)
      .select()
      .single();

    // Without a DB id, this record can't be linked from a later
    // verification's land_record_ids — the audit will still WORK on it
    // (audit takes the raw record data, not just IDs) but it silently
    // won't show up as linked in the DB. Surface that instead of hiding it.
    const record = dbError ? dbPayload : recordData;
    let persistedWarning: string | null = null;
    if (dbError) {
      console.error('land_records insert failed:', dbError);
      persistedWarning = 'Document was read successfully, but could not be saved to the database.';
    }

    return NextResponse.json({ success: true, record, persisted: !dbError, warning: persistedWarning });
  } catch (error: any) {
    console.error('Unhandled error in /api/extract:', error);
    return NextResponse.json(
      { error: 'Something went wrong while processing this document. Please try again.' },
      { status: 500 }
    );
  }
}
