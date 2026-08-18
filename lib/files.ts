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

export type FileMeta = {
  name: string;
  size: number;
};

export function getFileExtension(filename: string): string {
  const ext = filename.split(".").pop() ?? "";
  return ext.toLowerCase();
}

export function validateFile(file: File): ValidationResult {
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

/**
 * Same rules as validateFile(), but for use server-side after the client
 * has already uploaded the bytes directly to Storage via a signed URL —
 * at that point we only have filename + size, not a File object.
 */
export function validateFileMeta(meta: FileMeta): ValidationResult {
  const fileType = getFileExtension(meta.name);
  if (!ALLOWED_EXTENSIONS.has(fileType)) {
    return {
      ok: false,
      fileType,
      error: `File type ".${fileType}" is not allowed. Allowed: ${[
        ...ALLOWED_EXTENSIONS,
      ].join(", ")}.`,
    };
  }
  if (meta.size <= 0) {
    return { ok: false, fileType, error: "File is empty." };
  }
  if (meta.size > MAX_FILE_SIZE) {
    return {
      ok: false,
      fileType,
      error: `File is ${(meta.size / (1024 * 1024)).toFixed(1)} MB — the limit is 10 MB.`,
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