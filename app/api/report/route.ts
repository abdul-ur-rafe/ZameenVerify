// app/api/report/route.ts
//
// Generates the official stamped audit report PDF for the current
// batch + audit result. Takes the same records/verification shape
// the frontend already has in state — no re-fetching, no new OCR.
//
// Also persists a snapshot of that same data keyed by reportId, so the
// QR code's "Scan to verify" link (see /app/verify/[reportId]/page.tsx)
// resolves to a real lookup instead of a 404. This is a deliberate
// snapshot, not a live reference to `verifications`/`land_records` —
// the report should keep showing exactly what was in the PDF at
// generation time even if the underlying records are edited or deleted
// later, the same way a physical stamped report doesn't change after
// it's printed.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateAuditReportPdf } from '@/lib/report-generator';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Simple unique-ish report ID. Good enough for a hackathon; a real
// deployment would want this tied to the actual verifications.id
// from Supabase so "Scan to verify" resolves to a real lookup page.
function generateReportId(): string {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randPart = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `ZV-${datePart}-${randPart}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { records, verification } = body || {};

    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: 'No documents to include in the report.' }, { status: 400 });
    }
    if (!verification) {
      return NextResponse.json({ error: 'No audit result to include in the report.' }, { status: 400 });
    }

    const reportId = generateReportId();
    const generatedAt = new Date();

    // Where the QR code points. Falls back to a placeholder origin if
    // NEXT_PUBLIC_SITE_URL isn't set — replace with your real deployed
    // domain in Vercel's env vars once deployed, otherwise the QR code
    // will point at localhost and be useless off your own machine.
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const verificationUrl = `${siteUrl}/verify/${reportId}`;

    const pdfBytes = await generateAuditReportPdf({
      reportId,
      generatedAt,
      records,
      verification,
      verificationUrl,
    });

    // Persist the snapshot the QR code needs to resolve. This is
    // deliberately best-effort: if it fails, the PDF the user already
    // has in hand is still complete and correct, so we still return it
    // rather than failing the whole report generation over a link that
    // hasn't been scanned yet.
    const { error: insertError } = await supabase.from('verification_reports').insert({
      report_id: reportId,
      generated_at: generatedAt.toISOString(),
      records,
      verification,
    });
    if (insertError) {
      console.error('verification_reports insert failed (QR link will 404):', insertError);
    }

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="ZameenVerify-Report-${reportId}.pdf"`,
      },
    });
  } catch (error: any) {
    console.error('Unhandled error in /api/report:', error);
    return NextResponse.json(
      { error: 'Something went wrong while generating the report. Please try again.' },
      { status: 500 },
    );
  }
}
