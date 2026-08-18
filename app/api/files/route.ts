// app/api/files/route.ts

import { NextRequest, NextResponse } from "next/server";
import {
  getSupabaseServerClient,
  EDGE_FUNCTION_URL,
} from "@/lib/supabase/server";
import {
  DOCUMENTS_BUCKET,
  buildStoragePath,
  sanitizeFilename,
  validateFile,
} from "@/lib/files";

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
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: (err as Error).message,
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/files
 *
 * Upload flow:
 *
 * 1. Upload file to Supabase Storage.
 * 2. Insert metadata row with validated = false.
 * 3. Call validate-upload Edge Function.
 * 4. Edge Function validates the file and updates validated = true.
 * 5. Fetch the UPDATED metadata row.
 * 6. Return the updated row to the frontend.
 */
export async function POST(req: NextRequest) {
  const supabase = getSupabaseServerClient();

  try {
    const formData = await req.formData();

    const file = formData.get("file");

    const uploadedBy =
      (formData.get("uploaded_by") as string)?.trim() || null;

    const notes =
      (formData.get("notes") as string)?.trim() || null;

    const customName =
      (formData.get("filename") as string)?.trim() || null;

    // --------------------------------------------------
    // 1. Validate uploaded file exists
    // --------------------------------------------------

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error: "No file provided.",
        },
        { status: 400 },
      );
    }

    // --------------------------------------------------
    // 2. Validate file
    // --------------------------------------------------

    const validation = validateFile(file);

    if (!validation.ok) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error,
        },
        { status: 400 },
      );
    }

    // --------------------------------------------------
    // 3. Prepare file information
    // --------------------------------------------------

    const displayName = sanitizeFilename(
      customName ?? file.name,
    );

    const storagePath = buildStoragePath(file.name);

    // --------------------------------------------------
    // 4. Upload file to Supabase Storage
    // --------------------------------------------------

    const { error: uploadError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(storagePath, file, {
        contentType:
          file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        {
          success: false,
          error: `Storage upload failed: ${uploadError.message}`,
        },
        { status: 500 },
      );
    }

    // --------------------------------------------------
    // 5. Insert metadata row
    // --------------------------------------------------

    const { error: insertError } = await supabase
      .from("files_metadata")
      .insert({
        filename: displayName,
        storage_path: storagePath,
        file_type: validation.fileType,
        file_size: file.size,
        uploaded_by: uploadedBy,
        notes,
        validated: false,
      });

    if (insertError) {
      // Roll back Storage upload if database insert fails.
      await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .remove([storagePath]);

      return NextResponse.json(
        {
          success: false,
          error: `Metadata insert failed: ${insertError.message}`,
        },
        { status: 500 },
      );
    }

    // --------------------------------------------------
    // 6. Call validation Edge Function
    // --------------------------------------------------

    const edgeResult = await callEdgeFunction({
      storage_path: storagePath,
      filename: displayName,
      file_size: file.size,
      file_type: validation.fileType,
    });

    // 7. Validation failed

    if (!edgeResult.ok) {
      // Clean up Storage.
      await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .remove([storagePath]);

      // Clean up metadata.
      await supabase
        .from("files_metadata")
        .delete()
        .eq("storage_path", storagePath);

      return NextResponse.json(
        {
          success: false,
          error: `Upload rejected by validation: ${edgeResult.message}`,
        },
        { status: 400 },
      );
    }

    // 8. IMPORTANT:
    // Fetch the UPDATED row after Edge Function validation.

    const {
      data: validatedRow,
      error: fetchError,
    } = await supabase
      .from("files_metadata")
      .select("*")
      .eq("storage_path", storagePath)
      .single();

    if (fetchError || !validatedRow) {
      console.error(
        "Failed to fetch validated metadata row:",
        fetchError,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            fetchError?.message ??
            "Failed to fetch validated file metadata.",
        },
        { status: 500 },
      );
    }

    // 9. Return the UPDATED row

    return NextResponse.json(
      {
        success: true,
        message: "File uploaded and validated.",
        data: validatedRow,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("POST /api/files error:", err);

    return NextResponse.json(
      {
        success: false,
        error: (err as Error).message,
      },
      { status: 500 },
    );
  }
}

 // Call validate-upload Edge Function.

async function callEdgeFunction(payload: {
  storage_path: string;
  filename: string;
  file_size: number;
  file_type: string;
}): Promise<{
  ok: boolean;
  message: string;
}> {
  // Check Edge Function URL

  if (!EDGE_FUNCTION_URL) {
    return {
      ok: false,
      message:
        "SUPABASE_EDGE_FUNCTION_URL is not set. File stored but not validated.",
    };
  }

  try {
    
    // Call Edge Function

    const res = await fetch(
      EDGE_FUNCTION_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",

          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(payload),
      },
    );

    // Parse response

    const body = (await res.json()) as {
      success: boolean;
      message?: string;
    };

    return {
      ok: res.ok && body.success,
      message:
        body.message ??
        "Unknown validation response.",
    };
  } catch (err) {
    console.error(
      "Edge function request failed:",
      err,
    );

    return {
      ok: false,
      message: `Edge function unreachable: ${
        (err as Error).message
      }`,
    };
  }
}