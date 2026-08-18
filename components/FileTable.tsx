"use client";

import {
  FileText,
  MoreHorizontal,
  Download,
  RefreshCw,
  Pencil,
  Trash2,
} from "lucide-react";

import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import type { FileMetadata } from "@/lib/types";
import { formatBytes, formatDate } from "@/lib/utils";

type Props = {
  files: FileMetadata[];
  loading: boolean;
  busyId: string | null;
  onDownload: (file: FileMetadata) => void;
  onReplace: (file: FileMetadata) => void;
  onEdit: (file: FileMetadata) => void;
  onDelete: (file: FileMetadata) => void;
};

const TYPE_BADGE: Record<string, string> = {
  pdf: "bg-rose-100 text-rose-700 border-transparent",
  png: "bg-sky-100 text-sky-700 border-transparent",
  jpg: "bg-amber-100 text-amber-700 border-transparent",
  jpeg: "bg-amber-100 text-amber-700 border-transparent",
  txt: "bg-slate-200 text-slate-700 border-transparent",
  docx: "bg-indigo-100 text-indigo-700 border-transparent",
};

export default function FileTable({
  files,
  loading,
  busyId,
  onDownload,
  onReplace,
  onEdit,
  onDelete,
}: Props) {
  if (loading) {
    return (
      <Card className="p-4">
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (files.length === 0) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm font-medium text-muted-foreground">
          No files yet.
        </p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Upload your first document above to get started.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Uploader</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {files.map((file) => {
            const isBusy = busyId === file.id;

            return (
              <TableRow key={file.id}>
                {/* File name */}
                <TableCell className="max-w-[16rem]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <FileText className="h-5 w-5" />
                    </div>

                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {file.filename}
                      </p>

                      {file.notes && (
                        <p className="truncate text-xs text-muted-foreground">
                          {file.notes}
                        </p>
                      )}
                    </div>
                  </div>
                </TableCell>

                {/* File size */}
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatBytes(file.file_size)}
                </TableCell>

                {/* File type */}
                <TableCell>
                  <Badge
                    className={
                      TYPE_BADGE[file.file_type] ??
                      "bg-slate-200 text-slate-600 border-transparent"
                    }
                  >
                    {file.file_type}
                  </Badge>
                </TableCell>

                {/* Uploader */}
                <TableCell
                  className="max-w-[14rem] truncate text-muted-foreground"
                  title={file.uploaded_by ?? "Unknown"}
                >
                  {file.uploaded_by ?? "Unknown"}
                </TableCell>

                {/* Uploaded date */}
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDate(file.uploaded_at)}
                </TableCell>

                {/* Validation status */}
                <TableCell>
                  {file.validated ? (
                    <Badge variant="success">Validated</Badge>
                  ) : (
                    <Badge variant="warning">Pending</Badge>
                  )}
                </TableCell>

                {/* Actions */}
                <TableCell className="text-right">
                  {isBusy ? (
                    <span className="text-xs text-muted-foreground">
                      Working…
                    </span>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Row actions"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>

                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => onDownload(file)}
                        >
                          <Download />
                          Download
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          onClick={() => onReplace(file)}
                        >
                          <RefreshCw />
                          Replace
                        </DropdownMenuItem>

                        <DropdownMenuItem
                          onClick={() => onEdit(file)}
                        >
                          <Pencil />
                          Edit
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        <DropdownMenuItem
                          onClick={() => onDelete(file)}
                          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}