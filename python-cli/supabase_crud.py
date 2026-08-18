"""
supabase_crud.py — terminal-based CRUD for Supabase Storage + Database.

Mirrors the Next.js app's CRUD flow:
  - Upload   -> storage.upload -> files_metadata.insert -> validate-upload Edge Function
  - List     -> select all rows from files_metadata
  - Download -> fetch row, create signed URL (60s), download bytes to disk
  - Update   -> update metadata and/or replace the file (new storage path if replaced)
  - Delete   -> remove storage object, then delete the metadata row

Setup:
  1. pip install -r requirements.txt
  2. Copy .env.example to python-cli/.env and fill in:
       SUPABASE_URL=...
       SUPABASE_SERVICE_ROLE_KEY=...   (or SUPABASE_ANON_KEY)
       SUPABASE_EDGE_FUNCTION_URL=...
     (variables are also read from your shell environment)

Usage examples:
  python supabase_crud.py upload ./report.pdf --uploaded-by team@acme.com --notes "Q3 report"
  python supabase_crud.py upload ./invoice.docx --filename "Invoice - Jan.docx"
  python supabase_crud.py list
  python supabase_crud.py download <file-id> --output ./downloaded/
  python supabase_crud.py update <file-id> --notes "Reviewed" --validated true
  python supabase_crud.py update <file-id> --replace-file ./new-report.pdf --revalidate
  python supabase_crud.py delete <file-id>
  python supabase_crud.py --help
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv  # type: ignore
except ImportError:
    load_dotenv = None

import requests
from supabase import create_client, Client

BUCKET = "documents"
TABLE = "files_metadata"
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_TYPES = {"pdf", "png", "jpg", "jpeg", "txt", "docx"}


def load_env() -> None:
    """Best-effort load of python-cli/.env so users don't have to export vars."""
    if load_dotenv:
        load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))


def get_config() -> dict[str, str]:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    edge_url = os.environ.get("SUPABASE_EDGE_FUNCTION_URL")

    missing = [
        name
        for name, val in (("SUPABASE_URL", url), ("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY", key), ("SUPABASE_EDGE_FUNCTION_URL", edge_url))
        if not val
    ]
    if missing:
        sys.exit(
            "Missing environment variable(s): " + ", ".join(missing) +
            "\nSet them in the shell or in python-cli/.env (see .env.example)."
        )
    return {"url": url, "key": key, "edge_url": edge_url}


def get_client(cfg: dict[str, str]) -> Client:
    return create_client(cfg["url"], cfg["key"])


def file_extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def validate_local_file(path: str) -> tuple[bool, str, int]:
    """Returns (ok, file_type, file_size) or exits with a message."""
    if not os.path.isfile(path):
        sys.exit(f"File not found: {path}")
    name = os.path.basename(path)
    ext = file_extension(name)
    size = os.path.getsize(path)
    if ext not in ALLOWED_TYPES or size <= 0 or size > MAX_FILE_SIZE:
        return False, ext, size
    return True, ext, size


MIME_TYPES = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "txt": "text/plain",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def build_storage_path(filename: str) -> str:
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in filename)
    return f"{uuid.uuid4()}-{safe}"


def upload_to_storage(client: Client, path: str, display_name: str | None = None) -> tuple[str, str, str, int]:
    """Validate, read, and upload a local file to Storage. Exits on failure.
    Shared by cmd_upload and cmd_update's --replace-file path — same upload
    steps, same failure modes, one place to fix.
    Returns (storage_path, filename, file_type, file_size)."""
    ok, file_type, file_size = validate_local_file(path)
    if not ok:
        sys.exit(f"Invalid file: .{file_type} is not allowed (allowed: {', '.join(sorted(ALLOWED_TYPES))}) or exceeds 10 MB.")

    filename = display_name or os.path.basename(path)
    storage_path = build_storage_path(os.path.basename(path))

    with open(path, "rb") as fh:
        data = fh.read()

    res = client.storage.from_(BUCKET).upload(
        storage_path,
        data,
        {"content-type": MIME_TYPES.get(file_type, "application/octet-stream")},
    )
    if isinstance(res, dict) and res.get("error"):
        sys.exit(f"Storage upload failed: {res['error']}")

    return storage_path, filename, file_type, file_size


def call_edge_function(cfg: dict[str, str], payload: dict) -> dict:
    resp = requests.post(
        cfg["edge_url"],
        json=payload,
        headers={"Authorization": f"Bearer {cfg['key']}", "Content-Type": "application/json"},
        timeout=30,
    )
    body = resp.json()
    if resp.status_code >= 400 or not body.get("success", False):
        return {"success": False, "message": body.get("message", f"HTTP {resp.status_code}")}
    return body


def human_size(num: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if num < 1024 or unit == "GB":
            return f"{num:.0f} {unit}" if unit == "B" else f"{num:.1f} {unit}"
        num /= 1024


# commands


def cmd_upload(args: argparse.Namespace, cfg: dict[str, str], client: Client) -> None:
    # 1. Upload to Storage.
    storage_path, display_name, file_type, file_size = upload_to_storage(client, args.file, args.filename)

    # 2. Insert metadata row (validated = False).
    row = (
        client.table(TABLE)
        .insert(
            {
                "filename": display_name,
                "storage_path": storage_path,
                "file_type": file_type,
                "file_size": file_size,
                "uploaded_by": args.uploaded_by,
                "notes": args.notes,
                "validated": False,
            }
        )
        .execute()
    )
    if not row.data:
        client.storage.from_(BUCKET).remove([storage_path])
        sys.exit("Metadata insert failed — rolled back the storage upload.")

    # 3. Validate via the Edge Function.
    result = call_edge_function(
        cfg,
        {"storage_path": storage_path, "filename": display_name, "file_size": file_size, "file_type": file_type},
    )
    if not result["success"]:
        # Edge function already removed object + row on rejection.
        sys.exit(f"Upload rejected: {result['message']}")

    print(f"Uploaded {display_name} ({human_size(file_size)}) and validated.")
    print(f"  id: {row.data[0]['id']}")


def cmd_list(args: argparse.Namespace, cfg: dict[str, str], client: Client) -> None:
    resp = client.table(TABLE).select("*").order("uploaded_at", desc=True).execute()
    rows = resp.data or []
    if not rows:
        print("No files found.")
        return

    header = f"{'ID':<38} {'NAME':<28} {'SIZE':>8}  {'TYPE':<5} {'VALIDATED':<10} UPLOADED"
    print(header)
    print("-" * len(header))
    for r in rows:
        status = "yes" if r.get("validated") else "no"
        uploaded = (r.get("uploaded_at") or "")[:19].replace("T", " ")
        print(
            f"{r['id']:<38} {r['filename'][:28]:<28} {human_size(r['file_size']):>8}  "
            f"{r['file_type']:<5} {status:<10} {uploaded}"
        )


def cmd_download(args: argparse.Namespace, cfg: dict[str, str], client: Client) -> None:
    row = client.table(TABLE).select("*").eq("id", args.file_id).execute()
    if not row.data:
        sys.exit(f"No file with id {args.file_id}.")
    meta = row.data[0]

    # Signed URL (60s) — same mechanism the web app uses.
    signed = client.storage.from_(BUCKET).create_signed_url(meta["storage_path"], 60)
    url = signed["signedURL"]
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()

    output_dir = args.output or "."
    os.makedirs(output_dir, exist_ok=True)
    dest = os.path.join(output_dir, meta["filename"])
    with open(dest, "wb") as fh:
        fh.write(resp.content)
    print(f"Downloaded {meta['filename']} ({human_size(meta['file_size'])}) -> {dest}")


def cmd_update(args: argparse.Namespace, cfg: dict[str, str], client: Client) -> None:
    row = client.table(TABLE).select("*").eq("id", args.file_id).execute()
    if not row.data:
        sys.exit(f"No file with id {args.file_id}.")
    meta = row.data[0]

    updates: dict = {}
    if args.filename:
        updates["filename"] = args.filename
    if args.uploaded_by is not None:
        updates["uploaded_by"] = args.uploaded_by
    if args.notes is not None:
        updates["notes"] = args.notes
    if args.validated is not None:
        updates["validated"] = args.validated == "true"

    # Optional replacement file. Uploaded to a NEW storage path (so the
    # object's name in the bucket matches the new file), the old object is
    # then removed, and storage_path in the DB is updated to point at it.
    old_storage_path = meta["storage_path"]
    if args.replace_file:
        new_storage_path, new_filename, file_type, file_size = upload_to_storage(
            client, args.replace_file, args.filename
        )

        # New object is up — now drop the old one so we don't leave orphans.
        remove_res = client.storage.from_(BUCKET).remove([old_storage_path])
        if isinstance(remove_res, dict) and remove_res.get("error"):
            print(f"  Warning: uploaded the replacement but failed to remove the old object at "
                  f"{old_storage_path}: {remove_res['error']}")

        updates["storage_path"] = new_storage_path
        updates["filename"] = new_filename
        updates["file_size"] = file_size
        updates["file_type"] = file_type
        updates["validated"] = False  # re-validate below if requested

    if not updates:
        print("Nothing to update.")
        return

    # Write the row FIRST — the edge function looks the row up by
    # storage_path, so the DB must already reflect the new path before we
    # call it. (Calling revalidate before this write is what previously
    # caused "No metadata row found for storage_path ...".)
    client.table(TABLE).update(updates).eq("id", args.file_id).execute()
    print(f"Updated file {args.file_id}.")
    if args.replace_file:
        print(f"  Replacement uploaded as a new storage object: {updates['storage_path']}")
        print(f"  Old storage object removed: {old_storage_path}")
        print(f"  Filename now: {updates['filename']}")

    if args.revalidate and args.replace_file:
        result = call_edge_function(
            cfg,
            {
                "storage_path": updates["storage_path"],
                "filename": updates["filename"],
                "file_size": updates["file_size"],
                "file_type": updates["file_type"],
            },
        )
        if not result["success"]:
            sys.exit(f"Re-validation failed: {result['message']}")
        client.table(TABLE).update({"validated": True}).eq("id", args.file_id).execute()
        print("  Re-validated by edge function.")


def cmd_delete(args: argparse.Namespace, cfg: dict[str, str], client: Client) -> None:
    row = client.table(TABLE).select("*").eq("id", args.file_id).execute()
    if not row.data:
        sys.exit(f"No file with id {args.file_id}.")
    meta = row.data[0]

    # 1. Storage first, 2. row second.
    client.storage.from_(BUCKET).remove([meta["storage_path"]])
    client.table(TABLE).delete().eq("id", args.file_id).execute()
    print(f"Deleted {meta['filename']} (object + metadata row).")


# entry point


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="supabase_crud.py",
        description="CRUD for Supabase Storage + Database (files_metadata).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_upload = sub.add_parser("upload", help="Upload a file and validate it")
    p_upload.add_argument("file", help="Local path to the file to upload")
    p_upload.add_argument("--filename", help="Display filename (defaults to the local filename)")
    p_upload.add_argument("--uploaded-by", help="Who uploaded it (free text)")
    p_upload.add_argument("--notes", help="Optional note stored in the metadata row")

    p_list = sub.add_parser("list", help="List all file metadata rows")

    p_download = sub.add_parser("download", help="Download a file by id via a signed URL")
    p_download.add_argument("file_id", help="files_metadata.id")
    p_download.add_argument("--output", "-o", help="Output directory (defaults to current dir)")

    p_update = sub.add_parser("update", help="Update metadata and/or replace the file")
    p_update.add_argument("file_id", help="files_metadata.id")
    p_update.add_argument("--filename", help="New display filename (also used as the new storage object's name if --replace-file is given)")
    p_update.add_argument("--uploaded-by", help="New uploader")
    p_update.add_argument("--notes", help="New notes (empty string clears them)")
    p_update.add_argument("--validated", choices=["true", "false"], help="Set validated flag")
    p_update.add_argument("--replace-file", help="Replace the file with this local file (uploaded as a new storage object; the old one is removed)")
    p_update.add_argument("--revalidate", action="store_true", help="Re-run validate-upload after replacing")

    p_delete = sub.add_parser("delete", help="Delete the storage object and its metadata row")
    p_delete.add_argument("file_id", help="files_metadata.id")

    return parser


def main() -> None:
    load_env()
    cfg = get_config()
    client = get_client(cfg)
    args = build_parser().parse_args()

    handlers = {
        "upload": cmd_upload,
        "list": cmd_list,
        "download": cmd_download,
        "update": cmd_update,
        "delete": cmd_delete,
    }
    handlers[args.command](args, cfg, client)


if __name__ == "__main__":
    main()