import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";

const BUCKET = "documents";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "txt",
  "docx",
]);

type Payload = {
  storage_path?: string;
  filename?: string;
  file_size?: number;
  file_type?: string;
};

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

async function rollbackUpload(
  supabase: ReturnType<typeof createClient>,
  storagePath: string,
) {
  const storageResult = await supabase.storage
    .from(BUCKET)
    .remove([storagePath]);

  if (storageResult.error) {
    console.error(
      "validate-upload: failed to delete storage object",
      storageResult.error,
    );
  }

  const metadataResult = await supabase
    .from("files_metadata")
    .delete()
    .eq("storage_path", storagePath);

  if (metadataResult.error) {
    console.error(
      "validate-upload: failed to delete metadata row",
      metadataResult.error,
    );
  }

  return {
    storageError: storageResult.error,
    metadataError: metadataResult.error,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      {
        success: false,
        message: "Only POST requests are allowed.",
      },
      405,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      {
        success: false,
        message: "Server is missing required environment variables.",
      },
      500,
    );
  }

  const supabase = createClient(
    supabaseUrl,
    serviceRoleKey,
  );

  let payload: Payload;

  try {
    payload = (await req.json()) as Payload;
  } catch {
    return jsonResponse(
      {
        success: false,
        message: "Request body must be valid JSON.",
      },
      400,
    );
  }

  const {
    storage_path,
    filename,
    file_size,
    file_type,
  } = payload;

  if (
    !storage_path ||
    !filename ||
    file_size == null ||
    !file_type
  ) {
    return jsonResponse(
      {
        success: false,
        message:
          "Missing required fields: storage_path, filename, file_size, file_type.",
      },
      400,
    );
  }

  if (
    typeof file_size !== "number" ||
    !Number.isFinite(file_size) ||
    file_size <= 0
  ) {
    return jsonResponse(
      {
        success: false,
        message: "file_size must be a positive number.",
      },
      400,
    );
  }

  const extension = getExtension(filename);

  const sizeValid = file_size <= MAX_FILE_SIZE;

  const extensionValid = ALLOWED_EXTENSIONS.has(
    extension,
  );

  if (!sizeValid || !extensionValid) {
    let reason = "File validation failed.";

    if (!sizeValid) {
      reason = "File exceeds the 10 MB limit.";
    } else if (!extensionValid) {
      reason = `File extension ".${extension}" is not allowed.`;
    }

    const cleanup = await rollbackUpload(
      supabase,
      storage_path,
    );

    if (
      cleanup.storageError ||
      cleanup.metadataError
    ) {
      return jsonResponse(
        {
          success: false,
          message:
            `${reason} Validation failed and cleanup was incomplete.`,
        },
        500,
      );
    }

    return jsonResponse(
      {
        success: false,
        message:
          `${reason} Upload rolled back.`,
      },
      400,
    );
  }

    const { data, error } = await supabase
    .from("files_metadata")
    .update({
      validated: true,
      updated_at: new Date().toISOString(),
    })
    .eq("storage_path", storage_path)
    .select()
    .maybeSingle();

  if (!data && !error) {
    return jsonResponse(
      {
        success: false,
        message: `No metadata row found for storage_path "${storage_path}".`,
      },
      404,
    );
  }

  if (error) {
    console.error(
      "validate-upload: metadata update failed",
      error,
    );

    return jsonResponse(
      {
        success: false,
        message:
          `File is valid, but metadata validation failed: ${error.message}`,
      },
      500,
    );
  }

  return jsonResponse({
    success: true,
    message: "File validated successfully.",
    file: data,
  });
});