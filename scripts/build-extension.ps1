$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $repoRoot "dist"
$extensionRoot = Join-Path $distRoot "chrome-extension"
$zipPath = Join-Path $distRoot "chrome-extension.zip"

New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
New-Item -ItemType Directory -Path $extensionRoot -Force | Out-Null

if (Test-Path (Join-Path $extensionRoot "*")) {
  Remove-Item -Path (Join-Path $extensionRoot "*") -Recurse -Force
}

Copy-Item -Path (Join-Path $repoRoot "manifest.json") -Destination $extensionRoot -Force
Copy-Item -Path (Join-Path $repoRoot "src") -Destination $extensionRoot -Recurse -Force

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $extensionRoot "*") -DestinationPath $zipPath -Force

Write-Output "Built Chrome extension folder: $extensionRoot"
Write-Output "Built Chrome extension zip:    $zipPath"
