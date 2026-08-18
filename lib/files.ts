// Shared validation helpers for the API routes.
export const DOCUMENTS_BUCKET = "documents";
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "txt",
  "docx",
]);

export type ValidationResult = {
  ok: boolean;
  error?: string;
  fileType: string;
};

export function getFileExtension(filename: string): string {
  const ext = filename.split(".").pop() ?? "";
  return ext.toLowerCase();
}

// Takes { name, size } rather than a real File — the /api/files/sign route
// validates before any bytes exist on the server (they go straight from the
// browser to Storage), and a real File satisfies this shape too, so nothing
// else needs to change.
export function validateFile(file: { name: string; size: number }): ValidationResult {
  const fileType = getFileExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(fileType)) {
    return {
      ok: false,
      fileType,
      error: `File type ".${fileType}" is not allowed. Allowed: ${[
        ...ALLOWED_EXTENSIONS,
      ].join(", ")}.`,
    };
  }
  if (file.size <= 0) {
    return { ok: false, fileType, error: "File is empty." };
  }
  if (file.size > MAX_FILE_SIZE) {
    return {
      ok: false,
      fileType,
      error: `File is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is 10 MB.`,
    };
  }
  return { ok: true, fileType };
}

export function buildStoragePath(filename: string): string {
  // UUID prefix guarantees a unique path and prevents traversal/collisions.
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${crypto.randomUUID()}-${safe}`;
}

export function sanitizeFilename(filename: string): string {
  // Keep a readable name for display while removing path separators.
  return filename.replace(/[\\/]/g, "_").trim();
}