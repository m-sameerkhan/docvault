// app/api/files/finalize/route.ts

import { NextRequest, NextResponse } from "next/server";
import {
  getSupabaseServerClient,
  EDGE_FUNCTION_URL,
} from "@/lib/supabase/server";
import { DOCUMENTS_BUCKET } from "@/lib/files";

export const dynamic = "force-dynamic";

/**
 * POST /api/files/finalize
 *
 * Step 2 of the upload flow, called after the browser has already uploaded
 * the file bytes directly to Storage via the signed URL from /api/files/sign.
 * This is the same insert -> validate -> re-fetch logic the old single-step
 * POST /api/files used for steps 5-9 — just triggered by JSON metadata
 * instead of a multipart file, since the bytes are already in Storage.
 */
export async function POST(req: NextRequest) {
  const supabase = getSupabaseServerClient();

  try {
    const body = (await req.json()) as {
      storagePath?: string;
      filename?: string;
      fileSize?: number;
      fileType?: string;
      uploadedBy?: string | null;
      notes?: string | null;
    };

    const { storagePath, filename, fileSize, fileType } = body;

    if (!storagePath || !filename || typeof fileSize !== "number" || !fileType) {
      return NextResponse.json(
        {
          success: false,
          error: "storagePath, filename, fileSize, and fileType are required.",
        },
        { status: 400 },
      );
    }

    // --------------------------------------------------
    // Insert metadata row
    // --------------------------------------------------

    const { error: insertError } = await supabase
      .from("files_metadata")
      .insert({
        filename,
        storage_path: storagePath,
        file_type: fileType,
        file_size: fileSize,
        uploaded_by: body.uploadedBy?.trim() || null,
        notes: body.notes?.trim() || null,
        validated: false,
      });

    if (insertError) {
      // Roll back Storage upload if database insert fails.
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);

      return NextResponse.json(
        { success: false, error: `Metadata insert failed: ${insertError.message}` },
        { status: 500 },
      );
    }

    // --------------------------------------------------
    // Call validation Edge Function
    // --------------------------------------------------

    const edgeResult = await callEdgeFunction({
      storage_path: storagePath,
      filename,
      file_size: fileSize,
      file_type: fileType,
    });

    if (!edgeResult.ok) {
      // Clean up Storage.
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);

      // Clean up metadata.
      await supabase.from("files_metadata").delete().eq("storage_path", storagePath);

      return NextResponse.json(
        { success: false, error: `Upload rejected by validation: ${edgeResult.message}` },
        { status: 400 },
      );
    }

    // --------------------------------------------------
    // Fetch the UPDATED row after Edge Function validation
    // --------------------------------------------------

    const { data: validatedRow, error: fetchError } = await supabase
      .from("files_metadata")
      .select("*")
      .eq("storage_path", storagePath)
      .single();

    if (fetchError || !validatedRow) {
      console.error("Failed to fetch validated metadata row:", fetchError);

      return NextResponse.json(
        {
          success: false,
          error: fetchError?.message ?? "Failed to fetch validated file metadata.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "File uploaded and validated.",
        data: validatedRow,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("POST /api/files/finalize error:", err);

    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

// Call validate-upload Edge Function. Unchanged from the old route.
async function callEdgeFunction(payload: {
  storage_path: string;
  filename: string;
  file_size: number;
  file_type: string;
}): Promise<{ ok: boolean; message: string }> {
  if (!EDGE_FUNCTION_URL) {
    return {
      ok: false,
      message: "SUPABASE_EDGE_FUNCTION_URL is not set. File stored but not validated.",
    };
  }

  try {
    const res = await fetch(EDGE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const body = (await res.json()) as { success: boolean; message?: string };

    return {
      ok: res.ok && body.success,
      message: body.message ?? "Unknown validation response.",
    };
  } catch (err) {
    console.error("Edge function request failed:", err);

    return {
      ok: false,
      message: `Edge function unreachable: ${(err as Error).message}`,
    };
  }
}