"""Small torch.save-shaped archives for API/transport tests without PyTorch."""
from io import BytesIO
import pickle
import zipfile


def checkpoint_bytes(value=None, *, metadata=None, extra=None):
    output = BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("archive/data.pkl", metadata if metadata is not None else pickle.dumps(value, protocol=2))
        archive.writestr("archive/version", "3\n")
        archive.writestr("archive/byteorder", "little")
        for name, data in (extra or {}).items():
            archive.writestr(name, data)
    return output.getvalue()


TEST_WEIGHTS = checkpoint_bytes({"model": None, "label": "test-weights"})
NEW_WEIGHTS = checkpoint_bytes({"model": None, "label": "new-weights"})
