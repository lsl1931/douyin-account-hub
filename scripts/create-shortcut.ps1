# Create (or refresh) the desktop shortcut for the manually installed app.
#
# Deliberately pure ASCII: Windows PowerShell 5.1 decodes .ps1 using the ANSI code
# page unless the file has a BOM, so non-ASCII here would turn into mojibake.
# The Chinese display name and description are passed in as parameters by
# scripts/deploy.mjs, which hands them over as real Unicode arguments.

param(
    [Parameter(Mandatory = $true)][string]$HubRoot,
    [Parameter(Mandatory = $true)][string]$ShortcutName,
    [Parameter(Mandatory = $true)][string]$Description
)

$ErrorActionPreference = 'Stop'

$exe = Join-Path $HubRoot 'runtime\electron\electron.exe'
$app = Join-Path $HubRoot 'runtime\app'
$icon = Join-Path $app 'dist\icon.ico'

if (-not (Test-Path -LiteralPath $exe)) { throw "electron.exe not found: $exe" }
if (-not (Test-Path -LiteralPath $app)) { throw "app directory not found: $app" }

$desktop = [Environment]::GetFolderPath('Desktop')
if ([string]::IsNullOrWhiteSpace($desktop)) { throw 'Could not resolve the Desktop folder.' }

$lnkPath = Join-Path $desktop ($ShortcutName + '.lnk')

$wsh = New-Object -ComObject WScript.Shell
$lnk = $wsh.CreateShortcut($lnkPath)
$lnk.TargetPath = $exe
$lnk.Arguments = '"' + $app + '"'
$lnk.WorkingDirectory = $app
if (Test-Path -LiteralPath $icon) { $lnk.IconLocation = $icon + ',0' }
$lnk.Description = $Description
$lnk.Save()

if (-not (Test-Path -LiteralPath $lnkPath)) { throw "Shortcut was not created: $lnkPath" }

Write-Output "shortcut: $lnkPath"
if (-not (Test-Path -LiteralPath $icon)) { Write-Output "warning: icon not found, shortcut uses the default icon" }
