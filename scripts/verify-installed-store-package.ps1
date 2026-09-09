$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$product = Get-Content -LiteralPath (Join-Path $root 'product.json') -Raw | ConvertFrom-Json
$identity = $product.microsoftStore.identityName
$expectedPfn = $product.microsoftStore.packageFamilyName
$package = Get-AppxPackage -Name $identity | Sort-Object Version -Descending | Select-Object -First 1

if (-not $package) {
  throw "No installed Microsoft Store package was found for $identity."
}
if ($package.PackageFamilyName -cne $expectedPfn) {
  throw "Installed package family mismatch. Expected $expectedPfn; found $($package.PackageFamilyName)."
}
if (-not [System.IO.Path]::IsPathRooted($env:LOCALAPPDATA)) {
  throw 'LOCALAPPDATA is missing or is not an absolute path.'
}

$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Packages\$expectedPfn"))
$expectedPaths = [ordered]@{
  userData = Join-Path $packageRoot 'LocalState\profile'
  defaultCache = Join-Path $packageRoot 'LocalCache\video-cache'
  sessionData = Join-Path $packageRoot 'LocalCache\session'
  logs = Join-Path $packageRoot 'LocalCache\logs'
  crashDumps = Join-Path $packageRoot 'LocalCache\crash-dumps'
}
$packagePrefix = $packageRoot.TrimEnd('\') + '\'

foreach ($entry in $expectedPaths.GetEnumerator()) {
  $resolved = [System.IO.Path]::GetFullPath($entry.Value)
  if (-not $resolved.StartsWith($packagePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$($entry.Key) escapes the installed package root: $resolved"
  }
  if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
    throw "$($entry.Key) was not created by the installed Store package: $resolved"
  }
}

Write-Host "Installed Store identity verified: $($package.PackageFullName)"
foreach ($entry in $expectedPaths.GetEnumerator()) {
  Write-Host "$($entry.Key): $($entry.Value)"
}
