// app/api/files/upload-url/route.ts
//
// Step 1 of the upload flow: the client asks for a signed URL, then
// uploads the file bytes DIRECTLY to Supabase Storage (bypassing our
// Next.js server entirely — this is what lets large files work on Vercel,
// which caps request bodies to route handlers at 4.5 MB).

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient, DOCUMENTS_BUCKET } from "@/lib/supabase/server";
import { buildStoragePath, sanitizeFilename, validateFileMeta } from "@/lib/files";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const filename = (body.filename as string) ?? "";
    const fileSize = Number(body.fileSize);

    if (!filename || !Number.isFinite(fileSize)) {
      return NextResponse.json(
        { success: false, error: "filename and fileSize are required." },
        { status: 400 },
      );
    }

    const validation = validateFileMeta({ name: filename, size: fileSize });
    if (!validation.ok) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const storagePath = buildStoragePath(filename);

    const { data, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: `Could not create upload URL: ${error?.message ?? "unknown error"}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        signedUrl: data.signedUrl,
        token: data.token,
        storagePath,
        displayName: sanitizeFilename(filename),
        fileType: validation.fileType,
      },
    });
  } catch (err) {
    console.error("POST /api/files/upload-url error:", err);
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}