"""Private image storage: validate, compress and save an uploaded photo under PRIVATE_MEDIA_ROOT,
and find/remove the files again. Nothing here is ever reachable from the public /media path; the only
way to read a stored image is the authenticated view in views.py."""

import hashlib
import io
import secrets
from pathlib import Path

from django.conf import settings
from PIL import Image, ImageOps, UnidentifiedImageError
from rest_framework.exceptions import APIException

from .models import StoredImage

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_LONG_EDGE = 1600
JPEG_QUALITY = 70
# Refuse absurdly large decoded images (a "decompression bomb"), whatever their file size.
MAX_PIXELS = 50_000_000
_ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}


class InvalidImage(APIException):
    status_code = 400
    default_detail = "Please use a JPEG or PNG photo."
    default_code = "INVALID_IMAGE"


class ImageTooLarge(APIException):
    status_code = 400
    default_detail = "That photo is too big. Please use one under 10 MB."
    default_code = "IMAGE_TOO_LARGE"


def private_root() -> Path:
    return Path(settings.PRIVATE_MEDIA_ROOT)


def absolute_path(stored: StoredImage) -> Path:
    """The file's real location, refusing anything that would escape PRIVATE_MEDIA_ROOT."""
    root = private_root().resolve()
    path = (root / stored.path).resolve()
    if root not in path.parents:
        raise ValueError("stored image path escapes the private root")
    return path


def process_upload(upload) -> tuple[bytes, str, int]:
    """Returns (jpeg_bytes, sha256_of_original, original_size). Only real JPEG/PNG/WebP pictures pass:
    the format is decided by decoding with Pillow, never by the file name or the client's
    Content-Type. The output is a fresh JPEG (so EXIF/GPS never carries over), auto-rotated,
    at most 1600 px on the long edge."""
    if upload.size > MAX_UPLOAD_BYTES:
        raise ImageTooLarge()
    original = upload.read()
    if not original or len(original) > MAX_UPLOAD_BYTES:
        raise InvalidImage()

    try:
        probe = Image.open(io.BytesIO(original))
        if probe.format not in _ALLOWED_FORMATS:
            raise InvalidImage()
        if probe.width * probe.height > MAX_PIXELS:
            raise InvalidImage()
        probe.verify()
        image = Image.open(io.BytesIO(original))
        image.load()
    except InvalidImage:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise InvalidImage() from None

    image = ImageOps.exif_transpose(image)
    if image.mode in ("RGBA", "LA", "P"):
        rgba = image.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.getchannel("A"))
        image = flat
    else:
        image = image.convert("RGB")
    image.thumbnail((MAX_LONG_EDGE, MAX_LONG_EDGE), Image.LANCZOS)

    out = io.BytesIO()
    image.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return out.getvalue(), hashlib.sha256(original).hexdigest(), len(original)


def store_image(*, business, user, kind: str, upload) -> StoredImage:
    data, sha256, _original_size = process_upload(upload)
    relative = f"{business.id}/{secrets.token_hex(16)}.jpg"
    root = private_root()
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return StoredImage.objects.create(
        business=business,
        kind=kind,
        path=relative,
        sha256=sha256,
        size=len(data),
        uploaded_by=user,
    )


def delete_file(stored: StoredImage) -> bool:
    """Deletes the file if there is one. Returns True if a file was actually removed; a file that is
    already gone (or a path we refuse to touch) is not an error."""
    try:
        path = absolute_path(stored)
        path.unlink()
        return True
    except (FileNotFoundError, ValueError, OSError):
        return False
