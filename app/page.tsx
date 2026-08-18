"use client";

import { useCallback, useEffect, useState } from "react";
import { FileStack, RefreshCw } from "lucide-react";
import FileUploadForm from "@/components/FileUploadForm";
import FileTable from "@/components/FileTable";
import EditMetadataModal from "@/components/EditMetadataModal";
import LogoutButton from "@/components/LogoutButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import type { FileMetadata } from "@/lib/types";

export default function HomePage() {
  const { toast } = useToast();
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ file: FileMetadata; replaceMode: boolean } | null>(null);

  const notify = useCallback(
    (kind: "success" | "error", message: string) => {
      toast({
        variant: kind === "success" ? "success" : "destructive",
        title: kind === "success" ? "Success" : "Error",
        description: message,
      });
    },
    [toast],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/files");
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? "Failed to load files.");
      setFiles(body.data as FileMetadata[]);
    } catch (err) {
      notify("error", (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUploaded = useCallback(
    (file: FileMetadata) => {
      setFiles((prev) => [file, ...prev]);
      notify("success", `"${file.filename}" uploaded and validated.`);
    },
    [notify],
  );

  const handleDownload = useCallback(
    async (file: FileMetadata) => {
      setBusyId(file.id);
      try {
        const res = await fetch(`/api/files/${file.id}`);
        const body = await res.json();
        if (!res.ok || !body.success) throw new Error(body.error ?? "Download failed.");
        window.open((body.data as { signedUrl: string }).signedUrl, "_blank", "noopener,noreferrer");
      } catch (err) {
        notify("error", (err as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [notify],
  );

  const handleSaved = useCallback(
    (updated: FileMetadata) => {
      setFiles((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setModal(null);
      notify("success", "File updated.");
    },
    [notify],
  );

  const handleDelete = useCallback(
    async (file: FileMetadata) => {
      if (!window.confirm(`Delete "${file.filename}"? This cannot be undone.`)) return;
      setBusyId(file.id);
      try {
        const res = await fetch(`/api/files/${file.id}`, { method: "DELETE" });
        const body = await res.json();
        if (!res.ok || !body.success) throw new Error(body.error ?? "Delete failed.");
        setFiles((prev) => prev.filter((f) => f.id !== file.id));
        notify("success", `"${file.filename}" deleted.`);
      } catch (err) {
        notify("error", (err as Error).message);
      } finally {
        setBusyId(null);
      }
    },
    [notify],
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <FileStack className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">DocVault</h1>
            <p className="text-sm text-muted-foreground">Supabase Storage file manager</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void refresh()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <LogoutButton />
        </div>
      </header>

      <div className="space-y-6">
        <FileUploadForm onUploaded={handleUploaded} onError={(m) => notify("error", m)} />

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Documents</h2>
            <Badge variant="secondary">{files.length}</Badge>
          </div>

          <FileTable
            files={files}
            loading={loading}
            busyId={busyId}
            onDownload={handleDownload}
            onReplace={(file) => setModal({ file, replaceMode: true })}
            onEdit={(file) => setModal({ file, replaceMode: false })}
            onDelete={handleDelete}
          />
        </section>
      </div>

      <EditMetadataModal
        file={modal?.file ?? null}
        replaceMode={modal?.replaceMode ?? false}
        onClose={() => setModal(null)}
        onSaved={handleSaved}
        onError={(m) => notify("error", m)}
      />
    </main>
  );
}