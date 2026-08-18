export type FileMetadata = {
  id: string;
  filename: string;
  storage_path: string;
  file_type: string;
  file_size: number;
  uploaded_by: string | null;
  uploaded_at: string;
  updated_at: string;
  validated: boolean;
  notes: string | null;
};

export type ApiResponse<T = unknown> = {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
};

export type FileWithUrl = FileMetadata & { signedUrl: string | null };
