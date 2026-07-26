#!/usr/bin/env python3
"""Convert HTML from stdin or a local PDF file to Markdown with MarkItDown."""

import argparse
import io
import sys
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument(
        "--check",
        action="store_true",
        help="verify that MarkItDown can be imported",
    )
    source.add_argument(
        "--format",
        choices=("html",),
        help="input format when document content is read from stdin",
    )
    source.add_argument("--input", type=Path, help="path to a document to convert")
    return parser.parse_args()


def main():
    args = parse_args()

    # Windows commonly inherits a legacy console encoding such as GBK.
    # MarkItDown output can contain arbitrary Unicode (math symbols, CJK,
    # ligatures), so make both diagnostic and document streams deterministic.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="strict")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")

    try:
        from markitdown import MarkItDown
    except ImportError as exc:
        print(
            "MarkItDown is not installed for this Python interpreter. "
            "Run the backend Python setup script.",
            file=sys.stderr,
        )
        return 2

    converter = MarkItDown()
    if args.check:
        print("MarkItDown is available.")
        return 0

    try:
        if args.format == "html":
            content = sys.stdin.buffer.read()
            if not content.strip():
                print("HTML input is empty.", file=sys.stderr)
                return 1
            result = converter.convert_stream(
                io.BytesIO(content),
                file_extension=".html",
            )
        else:
            path = args.input.resolve()
            if not path.is_file():
                print(f"Input file does not exist: {path}", file=sys.stderr)
                return 1
            result = converter.convert(str(path))
    except Exception as exc:
        print(f"MarkItDown conversion failed: {exc}", file=sys.stderr)
        return 1

    output = result.text_content
    if not output or not output.strip():
        print("Conversion produced empty output.", file=sys.stderr)
        return 1

    sys.stdout.write(output)
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
