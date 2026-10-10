# Backend checks: lint, format check, Django system check, migrations check.
#   npm run check:backend   (from the repo root)
#   powershell -File scripts\check_backend.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $root '.venv\Scripts\python.exe'
$venvRuff = Join-Path $root '.venv\Scripts\ruff.exe'

if (-not (Test-Path $venvPython)) {
    Write-Error "No venv at $venvPython - see README for the setup commands."
    exit 1
}

Push-Location (Join-Path $root 'backend')
try {
    $env:DJANGO_SETTINGS_MODULE = 'config.settings'

    Write-Host '--- ruff check ---'
    & $venvRuff check .
    if ($LASTEXITCODE -ne 0) { exit 1 }

    Write-Host '--- ruff format --check ---'
    & $venvRuff format --check .
    if ($LASTEXITCODE -ne 0) { exit 1 }

    Write-Host '--- manage.py check ---'
    & $venvPython manage.py check
    if ($LASTEXITCODE -ne 0) { exit 1 }

    Write-Host '--- makemigrations --check --dry-run ---'
    & $venvPython manage.py makemigrations --check --dry-run
    if ($LASTEXITCODE -ne 0) { exit 1 }

    Write-Host 'Backend checks passed.'
} finally {
    Pop-Location
}
