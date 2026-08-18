"use client";

import { useCallback, useRef, useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  FileType2,
  UploadCloud,
  X,
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

/** Uploads with real progress events via XHR (fetch has no upload progress). */
function uploadWithProgress(
  formData: FormData,
  onProgress: (pct: number) => void,
  xhrRef: React.MutableRefObject<XMLHttpRequest | null>,
): Promise<{ ok: boolean; body: any }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", "/api/files");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, body: JSON.parse(xhr.responseText) });
      } catch {
        resolve({ ok: false, body: { error: "Server returned an invalid response." } });
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.onabort = () => reject(new Error("__aborted__"));
    xhr.send(formData);
  });
}

export default function FileUploadForm({ onUploaded, onError }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeFile, setActiveFile] = useState<{ name: string; size: number } | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [uploader, setUploader] = useState("");
  const [showUploader, setShowUploader] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

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

      const formData = new FormData();
      formData.append("file", file);
      if (uploader.trim()) formData.append("uploaded_by", uploader.trim());

      setUploading(true);
      setProgress(0);
      setActiveFile({ name: file.name, size: file.size });

      try {
        const { ok, body } = await uploadWithProgress(formData, setProgress, xhrRef);
        if (!ok || !body.success) {
          throw new Error(body.error ?? "Upload failed.");
        }
        onUploaded(body.data as FileMetadata);
      } catch (err) {
        const message = err instanceof Error ? err.message : "An unexpected error occurred during upload.";
        if (message !== "__aborted__") {
          setLocalError(message);
          onError(message);
        }
      } finally {
        setUploading(false);
        setActiveFile(null);
        xhrRef.current = null;
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [uploader, onUploaded, onError],
  );

  const cancelUpload = useCallback(() => {
    xhrRef.current?.abort();
  }, []);

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
              <Progress value={progress} className="mt-1.5 h-1" aria-label="Upload progress" />
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-muted-foreground">{progress < 100 ? `${progress}%` : "Validating…"}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  cancelUpload();
                }}
                aria-label="Cancel upload"
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-4 w-4" />
              </button>
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

      {/* Uploader — collapsed by default so it doesn't add height to the common case */}
      <div className="mt-2">
        {showUploader ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1">
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
            {!uploader && (
              <button
                type="button"
                onClick={() => setShowUploader(false)}
                className="mb-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowUploader(true)}
            className="text-xs font-medium text-muted-foreground hover:text-primary"
          >
            {uploader ? `Uploader: ${uploader}` : "+ Add uploader (optional)"}
          </button>
        )}
      </div>
    </Card>
  );
}