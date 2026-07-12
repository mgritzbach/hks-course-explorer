"""Authenticate an encrypted recovery artifact without exposing its passphrase."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import os
import re
import sys
from pathlib import Path

HMAC_CONTEXT = b"hks-course-explorer-recovery-hmac-v1"
HMAC_ITERATIONS = 600_000
TAG_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def derive_key(passphrase: str) -> bytes:
    if not isinstance(passphrase, str) or len(passphrase) < 16:
        raise ValueError("Recovery passphrase must contain at least 16 characters")
    return hashlib.pbkdf2_hmac(
        "sha256", passphrase.encode("utf-8"), HMAC_CONTEXT, HMAC_ITERATIONS, dklen=32
    )


def ciphertext_tag(ciphertext: bytes, passphrase: str) -> str:
    return hmac.new(derive_key(passphrase), ciphertext, hashlib.sha256).hexdigest()


def create_tag(ciphertext_path, tag_path, passphrase):
    ciphertext = Path(ciphertext_path).read_bytes()
    if not ciphertext:
        raise ValueError("Encrypted recovery artifact must not be empty")
    with Path(tag_path).open("x", encoding="ascii") as handle:
        handle.write(ciphertext_tag(ciphertext, passphrase) + "\n")


def verify_tag(ciphertext_path, tag_path, passphrase):
    ciphertext = Path(ciphertext_path).read_bytes()
    expected = Path(tag_path).read_text(encoding="ascii").strip()
    if not TAG_PATTERN.fullmatch(expected):
        raise ValueError("Recovery authentication tag is malformed")
    if not hmac.compare_digest(ciphertext_tag(ciphertext, passphrase), expected):
        raise ValueError("Encrypted recovery artifact authentication failed")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Create or verify a recovery ciphertext HMAC")
    parser.add_argument("command", choices=("create", "verify"))
    parser.add_argument("--ciphertext", required=True)
    parser.add_argument("--tag", required=True)
    args = parser.parse_args(argv)
    passphrase = os.environ.get("BACKUP_ARTIFACT_PASSPHRASE", "")
    if not passphrase:
        sys.exit("BACKUP_ARTIFACT_PASSPHRASE is required")
    try:
        if args.command == "create":
            create_tag(args.ciphertext, args.tag, passphrase)
        else:
            verify_tag(args.ciphertext, args.tag, passphrase)
    except (OSError, ValueError) as exc:
        sys.exit(str(exc))


if __name__ == "__main__":
    main()
