#!/usr/bin/env python3

import hashlib
import stat
import struct
import sys
import zipfile
from pathlib import Path


END_RECORD = struct.Struct("<4s4H2LH")
CENTRAL_DIRECTORY_RECORD = struct.Struct("<4s6H3L5H2L")
MAXIMUM_END_RECORD_BYTES = END_RECORD.size + 65535
MAXIMUM_CENTRAL_DIRECTORY_BYTES = 65536


def preflight_zip(archive_path: Path) -> None:
    archive_size = archive_path.stat().st_size
    if archive_size < END_RECORD.size:
        raise ValueError("Artifact archive is missing its end record")

    with archive_path.open("rb") as archive:
        archive.seek(max(0, archive_size - MAXIMUM_END_RECORD_BYTES))
        suffix = archive.read(MAXIMUM_END_RECORD_BYTES)

        end_offset = suffix.rfind(b"PK\x05\x06")
        if end_offset < 0 or len(suffix) - end_offset < END_RECORD.size:
            raise ValueError("Artifact archive is missing its end record")

        (
            signature,
            disk_number,
            central_directory_disk,
            disk_entries,
            total_entries,
            central_directory_size,
            central_directory_offset,
            comment_size,
        ) = END_RECORD.unpack_from(suffix, end_offset)
        absolute_end_offset = archive_size - len(suffix) + end_offset
        if (
            signature != b"PK\x05\x06"
            or disk_number != 0
            or central_directory_disk != 0
            or disk_entries != 1
            or total_entries != 1
            or central_directory_size > MAXIMUM_CENTRAL_DIRECTORY_BYTES
            or absolute_end_offset + END_RECORD.size + comment_size != archive_size
            or central_directory_offset + central_directory_size
            != absolute_end_offset
        ):
            raise ValueError("Artifact archive has invalid directory metadata")

        archive.seek(central_directory_offset)
        central_directory = archive.read(central_directory_size)

    if len(central_directory) < CENTRAL_DIRECTORY_RECORD.size:
        raise ValueError("Artifact archive has an invalid central directory")
    fields = CENTRAL_DIRECTORY_RECORD.unpack_from(central_directory)
    if fields[0] != b"PK\x01\x02":
        raise ValueError("Artifact archive has an invalid central directory")
    compressed_size = fields[8]
    uncompressed_size = fields[9]
    name_size = fields[10]
    extra_size = fields[11]
    comment_size = fields[12]
    disk_start = fields[13]
    local_header_offset = fields[16]
    if (
        CENTRAL_DIRECTORY_RECORD.size + name_size + extra_size + comment_size
        != len(central_directory)
        or disk_start != 0
        or compressed_size == 0xFFFFFFFF
        or uncompressed_size == 0xFFFFFFFF
        or local_header_offset == 0xFFFFFFFF
    ):
        raise ValueError("Artifact archive has an invalid central directory")


def download_artifact(
    output_path: Path,
    maximum_bytes: int,
) -> tuple[int, str]:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    copied = 0
    digest = hashlib.sha256()
    created = False
    try:
        with output_path.open("xb") as output:
            created = True
            while chunk := sys.stdin.buffer.read(1024 * 1024):
                copied += len(chunk)
                if copied > maximum_bytes:
                    raise ValueError("Artifact archive exceeds the download limit")
                digest.update(chunk)
                output.write(chunk)
    except BaseException:
        if created:
            try:
                output_path.unlink()
            except OSError:
                pass
        raise

    if copied == 0:
        output_path.unlink(missing_ok=True)
        raise ValueError("Artifact archive must not be empty")
    return copied, digest.hexdigest()


def extract_artifact(
    archive_path: Path,
    output_path: Path,
    expected_name: str,
    maximum_bytes: int,
) -> int:
    preflight_zip(archive_path)
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        if len(entries) != 1:
            raise ValueError("Artifact archives must contain exactly one file")

        entry = entries[0]
        if entry.filename != expected_name or entry.is_dir():
            raise ValueError(f"Artifact must contain only {expected_name}")
        if entry.flag_bits & 1:
            raise ValueError("Encrypted artifact entries are not supported")

        mode = entry.external_attr >> 16
        if stat.S_IFMT(mode) not in (0, stat.S_IFREG):
            raise ValueError("Artifact entry must be a regular file")
        if entry.file_size <= 0 or entry.file_size > maximum_bytes:
            raise ValueError("Artifact entry has an invalid declared size")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        copied = 0
        created = False
        try:
            with archive.open(entry) as source, output_path.open("xb") as output:
                created = True
                while chunk := source.read(1024 * 1024):
                    copied += len(chunk)
                    if copied > maximum_bytes:
                        raise ValueError(
                            "Artifact entry exceeds the extraction limit"
                        )
                    output.write(chunk)

            if copied == 0:
                raise ValueError("Artifact entry must not be empty")
            return copied
        except Exception:
            if created:
                try:
                    output_path.unlink()
                except OSError:
                    pass
            raise


def main() -> None:
    if len(sys.argv) == 4 and sys.argv[1] == "--download":
        maximum_bytes = int(sys.argv[3])
        if maximum_bytes <= 0:
            raise ValueError("Maximum bytes must be positive")
        copied, digest = download_artifact(Path(sys.argv[2]), maximum_bytes)
        print(f"{copied}\tsha256:{digest}")
        return

    if len(sys.argv) != 5:
        raise ValueError(
            "Usage: extract-ci-artifact.py <archive> <output> <expected-name> <maximum-bytes>\n"
            "       extract-ci-artifact.py --download <output> <maximum-bytes>"
        )

    maximum_bytes = int(sys.argv[4])
    if maximum_bytes <= 0:
        raise ValueError("Maximum bytes must be positive")

    copied = extract_artifact(
        Path(sys.argv[1]),
        Path(sys.argv[2]),
        sys.argv[3],
        maximum_bytes,
    )
    print(copied)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
