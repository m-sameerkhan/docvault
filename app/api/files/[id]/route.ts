// app/api/files/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  DOCUMENTS_BUCKET,
  getFileExtension,
  sanitizeFilename,
  validateFile,
} from "@/lib/files";

export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string } };

/**
 * GET /api/files/[id] — return metadata + a signed download URL (60s).
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const supabase = getSupabaseServerClient();
  const { id } = params;

  const { data: row, error } = await supabase
    .from("files_metadata")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !row) {
    return NextResponse.json(
      { success: false, error: error?.message ?? "File not found." },
      { status: error?.code === "PGRST116" ? 404 : 500 },
    );
  }

  const { data: signed, error: signedError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(row.storage_path, 60);

  if (signedError || !signed) {
    return NextResponse.json(
      { success: false, error: `Could not generate download link: ${signedError?.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, data: { ...row, signedUrl: signed.signedUrl } });
}

/**
 * PUT /api/files/[id] — update metadata and/or replace the stored file.
 * Accepts: optional `file`, `filename`, `uploaded_by`, `notes`, `validated`.
 */
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const supabase = getSupabaseServerClient();
  const { id } = params;

  const { data: existing, error: fetchError } = await supabase
    .from("files_metadata")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json(
      { success: false, error: "File not found." },
      { status: 404 },
    );
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const filename = (formData.get("filename") as string) || null;
  const uploadedByField = formData.get("uploaded_by");
  const notesField = formData.get("notes");
  const validatedField = formData.get("validated");

  const updates: Record<string, string | number | boolean | null> = {};

  if (filename) updates.filename = sanitizeFilename(filename);
  if (uploadedByField !== null) updates.uploaded_by = (uploadedByField as string) || null;
  if (notesField !== null) updates.notes = (notesField as string) || null;
  if (validatedField !== null && typeof validatedField === "string") {
    updates.validated = validatedField === "true";
  }

  // Optional replacement file — overwrites the object at the SAME path.
  if (file instanceof File) {
    const validation = validateFile(file);
    if (!validation.ok) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 },
      );
    }

    const { error: uploadError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(existing.storage_path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: true, // same path → replace content
      });

    if (uploadError) {
      return NextResponse.json(
        { success: false, error: `Replace failed: ${uploadError.message}` },
        { status: 500 },
      );
    }

    updates.file_size = file.size;
    updates.file_type = getFileExtension(file.name);
    // A replaced file is unvalidated until the edge function re-checks it.
    if (!updates.validated) updates.validated = false;
  }

  // updated_at is bumped automatically by the trigger (or explicitly here).
  updates.updated_at = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from("files_metadata")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json(
      { success: false, error: updateError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, message: "File updated.", data: updated });
}

/**
 * DELETE /api/files/[id] — delete storage object first, then the row.
 * Storage delete first, DB row second; on partial failure we report it.
 */
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const supabase = getSupabaseServerClient();
  const { id } = params;

  const { data: existing, error: fetchError } = await supabase
    .from("files_metadata")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return NextResponse.json(
      { success: false, error: "File not found." },
      { status: 404 },
    );
  }

  // 1. Remove the storage object.
  const { error: storageError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .remove([existing.storage_path]);

  // 2. Remove the metadata row.
  const { error: dbError } = await supabase
    .from("files_metadata")
    .delete()
    .eq("id", id);

  if (storageError && !dbError) {
    return NextResponse.json(
      {
        success: false,
        error: `Metadata deleted but the storage object could not be removed: ${storageError.message}`,
      },
      { status: 500 },
    );
  }

  if (dbError) {
    return NextResponse.json(
      {
        success: false,
        error: `Storage removed but the metadata row could not be deleted: ${dbError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, message: "File deleted." });
}
