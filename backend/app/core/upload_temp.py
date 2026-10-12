from pathlib import Path
import tempfile

from app.core.config import get_settings


def configure_upload_temp_directory() -> Path:
    """Keep multipart spool files out of system temp directories with changing permissions."""
    configured = get_settings().upload_temp_dir.strip()
    directory = (
        Path(configured).expanduser().resolve()
        if configured
        else Path(__file__).resolve().parents[3] / ".runtime" / "upload-temp"
    )
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Check actual creation, writing and deletion before accepting requests.
    # tempfile caches its chosen directory; explicitly replace a stale /tmp.
    with tempfile.TemporaryFile(dir=directory) as probe:
        probe.write(b"upload-temp-check")
        probe.flush()
    tempfile.tempdir = str(directory)
    return directory
