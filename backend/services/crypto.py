from cryptography.fernet import Fernet
from backend.config import FERNET_KEY

_cipher = Fernet(FERNET_KEY.encode()) if FERNET_KEY else None


def encrypt(plain_text: str) -> bytes:
    if not _cipher:
        raise RuntimeError("FERNET_KEY is not configured")
    return _cipher.encrypt(plain_text.encode())


def decrypt(cipher_bytes: bytes) -> str:
    if not _cipher:
        raise RuntimeError("FERNET_KEY is not configured")
    return _cipher.decrypt(cipher_bytes).decode()
