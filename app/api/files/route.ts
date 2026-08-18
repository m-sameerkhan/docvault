// app/api/files/route.ts

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient, DOCUMENTS_BUCKET, EDGE_FUNCTION_URL } from "@/lib/supabase/server";
import { validateFileMeta } from "@/lib/files";

export const dynamic = "force-dynamic";

/**
 * GET /api/files
 * List all file metadata rows.
 */
export async function GET() {
  try {
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from("files_metadata")
      .select("*")
      .order("uploaded_at", { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/files
 *
 * Step 2 of the upload flow. The browser has ALREADY uploaded the file
 * bytes directly to Supabase Storage using a signed URL from
 * /api/files/upload-url. This route only:
 *
 * 1. Re-validates the reported size/type (defence in depth).
 * 2. Inserts the metadata row (validated = false).
 * 3. Calls validate-upload Edge Function.
 * 4. Fetches and returns the updated row.
 *
 * Body (application/json):
 * { storage_path, filename, file_size, file_type, uploaded_by?, notes? }
 */
export async function POST(req: NextRequest) {
  const supabase = getSupabaseServerClient();

  try {
    const body = await req.json();
    const storagePath = body.storage_path as string;
    const displayName = body.filename as string;
    const fileSize = Number(body.file_size);
    const uploadedBy = (body.uploaded_by as string)?.trim() || null;
    const notes = (body.notes as string)?.trim() || null;

    if (!storagePath || !displayName || !Number.isFinite(fileSize)) {
      return NextResponse.json(
        { success: false, error: "storage_path, filename, and file_size are required." },
        { status: 400 },
      );
    }

    
    // Re-validate (the client already checked, but never trust the client)
    const validation = validateFileMeta({ name: displayName, size: fileSize });
    if (!validation.ok) {
      // The object may already be sitting in Storage from step 1 — clean it up.
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
    }

    // Insert metadata row
    
    const { error: insertError } = await supabase.from("files_metadata").insert({
      filename: displayName,
      storage_path: storagePath,
      file_type: validation.fileType,
      file_size: fileSize,
      uploaded_by: uploadedBy,
      notes,
      validated: false,
    });

    if (insertError) {
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
      return NextResponse.json(
        { success: false, error: `Metadata insert failed: ${insertError.message}` },
        { status: 500 },
      );
    }

    
    // Call validation Edge Function
    
    const edgeResult = await callEdgeFunction({
      storage_path: storagePath,
      filename: displayName,
      file_size: fileSize,
      file_type: validation.fileType,
    });

    if (!edgeResult.ok) {
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
      await supabase.from("files_metadata").delete().eq("storage_path", storagePath);

      return NextResponse.json(
        { success: false, error: `Upload rejected by validation: ${edgeResult.message}` },
        { status: 400 },
      );
    }

    
    // Fetch the UPDATED row after Edge Function validation
    
    const { data: validatedRow, error: fetchError } = await supabase
      .from("files_metadata")
      .select("*")
      .eq("storage_path", storagePath)
      .single();

    if (fetchError || !validatedRow) {
      console.error("Failed to fetch validated metadata row:", fetchError);
      return NextResponse.json(
        { success: false, error: fetchError?.message ?? "Failed to fetch validated file metadata." },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { success: true, message: "File uploaded and validated.", data: validatedRow },
      { status: 201 },
    );
  } catch (err) {
    console.error("POST /api/files error:", err);
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}

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
    return { ok: false, message: `Edge function unreachable: ${(err as Error).message}` };
  }
}