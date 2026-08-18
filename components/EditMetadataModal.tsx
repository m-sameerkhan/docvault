"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import type { FileMetadata } from "@/lib/types";

type Props = {
  file: FileMetadata | null;
  replaceMode: boolean;
  onClose: () => void;
  onSaved: (updated: FileMetadata) => void;
  onError: (message: string) => void;
};

export default function EditMetadataModal({ file, replaceMode, onClose, onSaved, onError }: Props) {
  const [filename, setFilename] = useState("");
  const [notes, setNotes] = useState("");
  const [validated, setValidated] = useState(false);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (file) {
      setFilename(file.filename);
      setNotes(file.notes ?? "");
      setValidated(file.validated);
      setNewFile(null);
    }
  }, [file]);

  useEffect(() => {
    if (replaceMode) {
      const t = setTimeout(() => fileInputRef.current?.click(), 50);
      return () => clearTimeout(t);
    }
  }, [replaceMode]);

  if (!file) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newFile && newFile.size === 0) return;

    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("filename", filename.trim() || file.filename);
      formData.append("notes", notes.trim());
      formData.append("validated", String(validated));
      if (newFile) formData.append("file", newFile);

      const res = await fetch(`/api/files/${file.id}`, { method: "PUT", body: formData });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? "Update failed.");
      onSaved(body.data as FileMetadata);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{replaceMode ? "Replace file" : "Edit metadata"}</DialogTitle>
          <DialogDescription>{file.filename}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {replaceMode && (
            <div>
              <Label htmlFor="modal-file" className="mb-1 block">New file</Label>
              <Input
                id="modal-file"
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.txt,.docx"
                onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
                className="cursor-pointer file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-foreground hover:file:bg-primary/90"
              />
              {newFile && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {newFile.name} ({(newFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="modal-filename" className="mb-1 block">Filename</Label>
            <Input id="modal-filename" value={filename} onChange={(e) => setFilename(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="modal-notes" className="mb-1 block">Notes</Label>
            <Textarea id="modal-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={validated}
              onChange={(e) => setValidated(e.target.checked)}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            Mark as validated
          </label>

          <DialogFooter className="border-t pt-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}