#!/usr/bin/env python3

import gzip
import stat
import sys
import tarfile
from pathlib import Path, PurePosixPath


class BoundedReader:
    """Limit bytes returned by a decompression stream."""

    def __init__(self, source: gzip.GzipFile, maximum_bytes: int) -> None:
        self.source = source
        self.maximum_bytes = maximum_bytes
        self.bytes_read = 0

    def read(self, size: int = -1) -> bytes:
        remaining_with_sentinel = self.maximum_bytes - self.bytes_read + 1
        requested = remaining_with_sentinel if size < 0 else min(size, remaining_with_sentinel)
        chunk = self.source.read(requested)
        self.bytes_read += len(chunk)
        if self.bytes_read > self.maximum_bytes:
            raise ValueError("Package tar stream exceeds the decompression limit")
        return chunk


def validate_member_name(name: str) -> None:
    path = PurePosixPath(name)
    if (
        not name.startswith("package/")
        or path.is_absolute()
        or ".." in path.parts
        or "\\" in name
        or any(ord(character) <= 0x1F or ord(character) == 0x7F for character in name)
    ):
        raise ValueError("Package archive contains an unsafe member name")


def validate_package(
    package_path: Path,
    maximum_archive_bytes: int,
    maximum_entries: int,
    maximum_unpacked_bytes: int,
) -> tuple[int, int, int]:
    package_stat = package_path.lstat()
    if not stat.S_ISREG(package_stat.st_mode) or package_stat.st_size <= 0:
        raise ValueError("Package archive must be a non-empty regular file")
    if package_stat.st_size > maximum_archive_bytes:
        raise ValueError("Package archive exceeds the compressed size limit")

    entry_count = 0
    unpacked_bytes = 0
    maximum_tar_stream_bytes = (
        maximum_unpacked_bytes + maximum_entries * 4096 + 10240
    )
    with package_path.open("rb") as compressed_source:
        with gzip.GzipFile(fileobj=compressed_source) as decompressed_source:
            bounded_source = BoundedReader(
                decompressed_source, maximum_tar_stream_bytes
            )
            with tarfile.open(fileobj=bounded_source, mode="r|") as archive:
                for member in archive:
                    entry_count += 1
                    if entry_count > maximum_entries:
                        raise ValueError("Package archive exceeds the entry limit")
                    validate_member_name(member.name)
                    if member.isdir():
                        continue
                    if not member.isfile():
                        raise ValueError("Package archive entries must be regular files")
                    unpacked_bytes += member.size
                    if unpacked_bytes > maximum_unpacked_bytes:
                        raise ValueError(
                            "Package archive exceeds the unpacked size limit"
                        )

                    source = archive.extractfile(member)
                    if source is None:
                        raise ValueError("Package archive entry cannot be read")
                    copied = 0
                    while chunk := source.read(1024 * 1024):
                        copied += len(chunk)
                        if copied > member.size:
                            raise ValueError(
                                "Package archive entry exceeds its declared size"
                            )
                    if copied != member.size:
                        raise ValueError(
                            "Package archive entry size does not match its header"
                        )

    if entry_count == 0 or unpacked_bytes == 0:
        raise ValueError("Package archive must contain non-empty files")
    return package_stat.st_size, entry_count, unpacked_bytes


def main() -> None:
    if len(sys.argv) != 5:
        raise ValueError(
            "Usage: validate-npm-package.py <package> <maximum-archive-bytes> <maximum-entries> <maximum-unpacked-bytes>"
        )
    limits = tuple(int(value) for value in sys.argv[2:])
    if any(value <= 0 for value in limits):
        raise ValueError("Package archive limits must be positive")
    result = validate_package(Path(sys.argv[1]), *limits)
    print("\t".join(str(value) for value in result))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, tarfile.TarError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
