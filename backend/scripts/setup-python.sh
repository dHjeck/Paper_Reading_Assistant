#!/usr/bin/env sh
set -eu

backend_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
project_dir=$(CDPATH= cd -- "$backend_dir/.." && pwd)
venv_python="$backend_dir/.venv/bin/python"
markitdown_package="$project_dir/html_pdf2md/markitdown/packages/markitdown[pdf]"

python3 -m venv "$backend_dir/.venv"
"$venv_python" -m pip install --upgrade pip
"$venv_python" -m pip install -e "$markitdown_package"

printf 'MarkItDown is ready in %s\n' "$venv_python"
