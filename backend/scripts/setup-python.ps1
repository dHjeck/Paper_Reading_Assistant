$ErrorActionPreference = 'Stop'

$backendDir = Split-Path -Parent $PSScriptRoot
$projectDir = Split-Path -Parent $backendDir
$venvPython = Join-Path $backendDir '.venv\Scripts\python.exe'
$markitdownPackage = Join-Path $projectDir 'html_pdf2md\markitdown\packages\markitdown[pdf]'

python -m venv (Join-Path $backendDir '.venv')
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -e $markitdownPackage

Write-Host "MarkItDown is ready in $venvPython"
