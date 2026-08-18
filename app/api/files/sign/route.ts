// app/api/files/sign/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  DOCUMENTS_BUCKET,
  buildStoragePath,
  sanitizeFilename,
  validateFile,
} from "@/lib/files";

export const dynamic = "force-dynamic";

/**
 * POST /api/files/sign
 *
 * Step 1 of the upload flow. Takes file metadata only (no bytes — this
 * request is small regardless of file size, so it never hits Vercel's
 * 4.5 MB serverless body limit). Validates, then returns a signed upload
 * URL the browser uploads directly to Supabase Storage with.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      filename?: string;
      size?: number;
    };

    if (!body.filename || typeof body.size !== "number") {
      return NextResponse.json(
        { success: false, error: "filename and size are required." },
        { status: 400 },
      );
    }

    const validation = validateFile({ name: body.filename, size: body.size });
    if (!validation.ok) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 },
      );
    }

    const displayName = sanitizeFilename(body.filename);
    const storagePath = buildStoragePath(body.filename);

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: `Failed to sign upload: ${error?.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      storagePath,
      displayName,
      fileType: validation.fileType,
      path: data.path,
      token: data.token,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}