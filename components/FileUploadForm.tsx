"use client";

import { useCallback, useRef, useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  FileType2,
  UploadCloud,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

import { cn, formatBytes } from "@/lib/utils";
import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE, getFileExtension } from "@/lib/files";
import type { FileMetadata } from "@/lib/types";

type Props = {
  onUploaded: (file: FileMetadata) => void;
  onError: (message: string) => void;
};

const TYPE_CHIPS: { label: string; icon: typeof FileText }[] = [
  { label: "PDF", icon: FileText },
  { label: "PNG", icon: ImageIcon },
  { label: "JPG", icon: ImageIcon },
  { label: "TXT", icon: FileType2 },
  { label: "DOCX", icon: FileText },
];

function validateClientSide(file: File): string | null {
  const ext = getFileExtension(file.name);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return `".${ext}" isn't supported. Use PDF, PNG, JPG, TXT, or DOCX.`;
  }
  if (file.size <= 0) {
    return "That file is empty.";
  }
  if (file.size > MAX_FILE_SIZE) {
    return `${formatBytes(file.size)} is over the 10 MB limit.`;
  }
  return null;
}

type Phase = "signing" | "uploading" | "finalizing";

/**
 * PUTs directly to a Supabase Storage signed upload URL with real progress
 * events. This reconstructs the request body Supabase's own SDK sends
 * internally for uploadToSignedUrl (multipart form with a "cacheControl"
 * field and the file under an empty field name) — that shape isn't public
 * API, just what the SDK does today, so verify this against a real upload
 * after any supabase-js version bump.
 *
 * ponytail: if this ever drifts from what the SDK sends and starts
 * failing, the safe fallback is uploadToSignedUrl() via the SDK (fetch-
 * based, works, just no progress events).
 */
function uploadToSignedUrlWithProgress(
  signedUrl: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);

    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("Authorization", `Bearer ${anonKey}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText || "no response body"}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading to Storage."));

    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    xhr.send(body);
  });
}

export default function FileUploadForm({ onUploaded, onError }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [progress, setProgress] = useState(0);
  const [activeFile, setActiveFile] = useState<{ name: string; size: number } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [uploader, setUploader] = useState("");
  const [notes, setNotes] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const uploading = phase !== null;

  const submitFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];

      const validationError = validateClientSide(file);
      if (validationError) {
        setLocalError(validationError);
        return;
      }
      setLocalError(null);
      setActiveFile({ name: file.name, size: file.size });
      setProgress(0);

      try {
        // 1. Ask the server to validate + issue a signed upload URL.
        setPhase("signing");
        const signRes = await fetch("/api/files/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, size: file.size }),
        });
        const signBody = await signRes.json();
        if (!signRes.ok || !signBody.success) {
          throw new Error(signBody.error ?? "Failed to prepare upload.");
        }
        const { storagePath, displayName, fileType, signedUrl } = signBody;

        // 2. Upload the bytes straight to Supabase Storage — never through
        // our serverless function, so file size isn't capped by it. Raw
        // XHR (not the SDK helper) so we get real progress events.
        setPhase("uploading");
        await uploadToSignedUrlWithProgress(signedUrl, file, setProgress);

        // 3. Insert metadata + run edge-function validation.
        setPhase("finalizing");
        const finalizeRes = await fetch("/api/files/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storagePath,
            filename: displayName,
            fileSize: file.size,
            fileType,
            uploadedBy: uploader.trim() || null,
            notes: notes.trim() || null,
          }),
        });
        const finalizeBody = await finalizeRes.json();
        if (!finalizeRes.ok || !finalizeBody.success) {
          throw new Error(finalizeBody.error ?? "Upload failed.");
        }

        onUploaded(finalizeBody.data as FileMetadata);
      } catch (err) {
        const message = err instanceof Error ? err.message : "An unexpected error occurred during upload.";
        setLocalError(message);
        onError(message);
      } finally {
        setPhase(null);
        setActiveFile(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [uploader, notes, onUploaded, onError],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      void submitFiles(e.dataTransfer.files);
    },
    [submitFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputRef.current?.click();
    }
  }, []);

  const statusLabel =
    phase === "signing" ? "Preparing…" :
    phase === "uploading" ? `${progress}%` :
    phase === "finalizing" ? "Validating…" : "";

  return (
    <Card className="p-3 sm:p-4">
      {/* Upload bar — short horizontal dropzone, not a tall empty square */}
      <div
        role="button"
        tabIndex={uploading ? -1 : 0}
        aria-label="Upload a file"
        aria-disabled={uploading}
        onClick={() => !uploading && inputRef.current?.click()}
        onKeyDown={handleKeyDown}
        onDragOver={!uploading ? handleDragOver : undefined}
        onDragLeave={!uploading ? handleDragLeave : undefined}
        onDrop={!uploading ? onDrop : undefined}
        className={cn(
          "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-4",
          "transition-colors duration-150 sm:flex-row sm:gap-4 sm:px-5",
          uploading ? "cursor-default" : "cursor-pointer",
          localError && !uploading
            ? "border-destructive/60 bg-destructive/5"
            : isDragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-primary/60 hover:bg-muted/40",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.png,.jpg,.jpeg,.txt,.docx"
          onChange={(e) => void submitFiles(e.target.files)}
          disabled={uploading}
        />

        {uploading && activeFile ? (
          <>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <UploadCloud className="h-4 w-4 animate-pulse text-primary" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-medium text-foreground">{activeFile.name}</p>
                <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(activeFile.size)}</span>
              </div>
              <Progress
                value={phase === "uploading" ? progress : phase === "finalizing" ? 100 : undefined}
                className="mt-1.5 h-1"
                aria-label="Upload progress"
              />
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-muted-foreground">{statusLabel}</span>
            </div>
          </>
        ) : (
          <>
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform duration-150",
                localError ? "bg-destructive/10" : "bg-primary/10",
                isDragging && "scale-110",
              )}
            >
              <UploadCloud className={cn("h-4 w-4", localError ? "text-destructive" : "text-primary")} />
            </div>

            <div className="min-w-0 flex-1 text-center sm:text-left">
              <p className="text-sm font-medium text-foreground">
                {isDragging ? "Drop it here" : "Drag & drop a file, or"}{" "}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    inputRef.current?.click();
                  }}
                >
                  browse
                </Button>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {localError ?? "PDF, PNG, JPG, TXT, DOCX — max 10 MB"}
              </p>
            </div>

            <div className="hidden shrink-0 items-center gap-1 lg:flex">
              {TYPE_CHIPS.map(({ label, icon: Icon }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Uploader + notes — collapsed by default so it doesn't add height to the common case */}
      <div className="mt-2">
        {showDetails ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 basis-52">
              <Label htmlFor="uploader" className="mb-1 block text-xs font-medium">
                Uploader <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="uploader"
                type="text"
                value={uploader}
                onChange={(e) => setUploader(e.target.value)}
                placeholder="e.g. team@acme.com"
                autoComplete="email"
                disabled={uploading}
                className="h-8 w-full text-sm sm:w-64"
              />
            </div>
            <div className="flex-1 basis-52">
              <Label htmlFor="notes" className="mb-1 block text-xs font-medium">
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Q3 report"
                disabled={uploading}
                className="h-8 w-full text-sm sm:w-64"
              />
            </div>
            {!uploader && !notes && (
              <button
                type="button"
                onClick={() => setShowDetails(false)}
                className="mb-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowDetails(true)}
            className="text-xs font-medium text-muted-foreground hover:text-primary"
          >
            {uploader || notes
              ? [uploader && `Uploader: ${uploader}`, notes && `Notes: ${notes}`].filter(Boolean).join(" · ")
              : "+ Add uploader / notes (optional)"}
          </button>
        )}
      </div>
    </Card>
  );
}