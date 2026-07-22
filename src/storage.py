"""Vault storage abstraction so the exact same tool runs locally OR in the cloud.

Locally it reads/writes the files on disk. In GitHub Actions (no Mac, no mount) it
reads/writes the same vault through the Google Drive API. Everything else in the tool
just calls storage.read / write / exists / listdir with vault-relative paths like
"Daily/Focus.md" and never has to care which backend is live.

Cloud mode turns on automatically when these env vars are set:
    GOOGLE_CREDENTIALS_JSON   service-account JSON (one line)
    VAULT_DRIVE_FOLDER_ID     the Drive folder id of "Esme's Brain"
"""

import io
import json
import os

VAULT = os.path.expanduser("~/Desktop/Esme's Brain")
SCOPES = ["https://www.googleapis.com/auth/drive"]
_DRIVE = bool(
    (os.environ.get("GDRIVE_OAUTH_JSON") or os.environ.get("GOOGLE_CREDENTIALS_JSON"))
    and os.environ.get("VAULT_DRIVE_FOLDER_ID"))

_svc = None
_folder_cache = {}  # relpath -> folder id


# ---- Google Drive backend -------------------------------------------------
def _service():
    global _svc
    if _svc is None:
        from googleapiclient.discovery import build
        oauth = os.environ.get("GDRIVE_OAUTH_JSON")
        if oauth:  # act AS Esme, so files it creates are owned by her (has quota)
            from google.oauth2.credentials import Credentials
            creds = Credentials.from_authorized_user_info(json.loads(oauth), SCOPES)
        else:      # service account: read-only in practice (can't create in My Drive)
            from google.oauth2 import service_account
            creds = service_account.Credentials.from_service_account_info(
                json.loads(os.environ["GOOGLE_CREDENTIALS_JSON"]), scopes=SCOPES)
        _svc = build("drive", "v3", credentials=creds, cache_discovery=False)
    return _svc


def _q(name, parent, folder=None):
    safe = name.replace("'", "\\'")
    q = f"name = '{safe}' and '{parent}' in parents and trashed = false"
    if folder is True:
        q += " and mimeType = 'application/vnd.google-apps.folder'"
    elif folder is False:
        q += " and mimeType != 'application/vnd.google-apps.folder'"
    r = _service().files().list(q=q, fields="files(id,name)", pageSize=1).execute()
    files = r.get("files", [])
    return files[0]["id"] if files else None


def _folder_id(reldir):
    """Resolve a vault-relative folder path to a Drive id, caching each step."""
    if reldir in ("", ".", None):
        return os.environ["VAULT_DRIVE_FOLDER_ID"]
    if reldir in _folder_cache:
        return _folder_cache[reldir]
    parent = os.environ["VAULT_DRIVE_FOLDER_ID"]
    for part in reldir.split("/"):
        parent = _q(part, parent, folder=True)
        if not parent:
            return None
    _folder_cache[reldir] = parent
    return parent


def _file_id(relpath):
    d, name = os.path.split(relpath)
    folder = _folder_id(d)
    return _q(name, folder, folder=False) if folder else None


def _drive_read(relpath):
    fid = _file_id(relpath)
    if not fid:
        return ""
    from googleapiclient.http import MediaIoBaseDownload
    buf = io.BytesIO()
    dl = MediaIoBaseDownload(buf, _service().files().get_media(fileId=fid))
    done = False
    while not done:
        _, done = dl.next_chunk()
    return buf.getvalue().decode("utf-8")


def _drive_write(relpath, content):
    from googleapiclient.http import MediaIoBaseUpload
    media = MediaIoBaseUpload(io.BytesIO(content.encode("utf-8")), mimetype="text/markdown")
    fid = _file_id(relpath)
    if fid:
        _service().files().update(fileId=fid, media_body=media).execute()
    else:
        d, name = os.path.split(relpath)
        _service().files().create(
            body={"name": name, "parents": [_folder_id(d)]}, media_body=media, fields="id"
        ).execute()


def _drive_listdir(reldir):
    folder = _folder_id(reldir)
    if not folder:
        return []
    names, token = [], None
    while True:
        r = _service().files().list(
            q=f"'{folder}' in parents and trashed = false",
            fields="nextPageToken, files(name)", pageToken=token, pageSize=1000).execute()
        names += [f["name"] for f in r.get("files", [])]
        token = r.get("nextPageToken")
        if not token:
            break
    return names


# ---- public API (dispatches to Drive or local) ----------------------------
def read(relpath):
    if _DRIVE:
        return _drive_read(relpath)
    p = os.path.join(VAULT, relpath)
    if not os.path.exists(p):
        return ""
    with open(p, encoding="utf-8") as f:
        return f.read()


def write(relpath, content):
    if _DRIVE:
        return _drive_write(relpath, content)
    p = os.path.join(VAULT, relpath)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(content)


def exists(relpath):
    if _DRIVE:
        return _file_id(relpath) is not None or _folder_id(relpath) is not None
    return os.path.exists(os.path.join(VAULT, relpath))


def listdir(reldir):
    if _DRIVE:
        return _drive_listdir(reldir)
    p = os.path.join(VAULT, reldir)
    return os.listdir(p) if os.path.isdir(p) else []
