#!/usr/bin/env python3
"""
HTML to markdown converter wrapper.

Reads HTML from stdin and writes markdown to stdout using the
markitdown library. Falls back to a basic text extraction if
markitdown is not available.

Usage:
    cat page.html | python3 convert_html.py
"""

import sys
import os


def convert_with_markitdown(html_content):
    """Convert HTML to markdown using markitdown library."""
    try:
        from markitdown import MarkItDown
        md = MarkItDown()
        result = md.convert_stream(
            html_content.encode("utf-8"),
            file_extension=".html"
        )
        return result.text_content
    except ImportError:
        return None
    except Exception as e:
        print(f"markitdown error: {e}", file=sys.stderr)
        return None


def convert_fallback(html_content):
    """Basic HTML-to-text extraction fallback."""
    import html
    import re

    text = html_content

    # Remove script, style, and comment blocks
    text = re.sub(r"<script[^>]*>[\s\S]*?</script>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<!--[\s\S]*?-->", "", text)

    # Convert common block elements to newlines
    text = re.sub(r"<(?:br|hr)\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</(?:p|div|li|h[1-6]|tr|blockquote|pre|article|section|main|header|footer|nav|aside)>", "\n", text, flags=re.IGNORECASE)

    # Convert heading tags
    for i in range(1, 7):
        text = re.sub(
            rf"<h{i}[^>]*>([\s\S]*?)</h{i}>",
            lambda m, lvl=i: "#" * lvl + " " + m.group(1).strip(),
            text,
            flags=re.IGNORECASE,
        )

    # Convert li tags
    text = re.sub(r"<li[^>]*>", "• ", text, flags=re.IGNORECASE)

    # Strip all remaining HTML tags
    text = re.sub(r"<[^>]+>", "", text)

    # Decode HTML entities
    text = html.unescape(text)

    # Normalize whitespace
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = text.strip()

    return text


def main():
    try:
        html_content = sys.stdin.read()
    except Exception as e:
        print(f"Error reading stdin: {e}", file=sys.stderr)
        sys.exit(1)

    if not html_content or not html_content.strip():
        print("Empty input", file=sys.stderr)
        sys.exit(1)

    # Try markitdown first, fall back to basic extraction
    result = convert_with_markitdown(html_content)
    if result is None:
        print("Falling back to basic extraction", file=sys.stderr)
        result = convert_fallback(html_content)

    if not result or not result.strip():
        print("Conversion produced empty output", file=sys.stderr)
        sys.exit(1)

    sys.stdout.write(result)
    sys.stdout.flush()


if __name__ == "__main__":
    main()
