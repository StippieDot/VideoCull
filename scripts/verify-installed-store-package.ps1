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
if (-not [System.IO.Path]::IsPathRooted($env:APPDATA)) {
  throw 'APPDATA is missing or is not an absolute path.'
}

$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Packages\$expectedPfn"))
$sharedProfile = [System.IO.Path]::GetFullPath((Join-Path $env:APPDATA $product.displayName))
$sharedPaths = [ordered]@{
  userData = $sharedProfile
  defaultCache = Join-Path $sharedProfile 'video-cache'
}
$packagePaths = [ordered]@{
  runtimeState = Join-Path $packageRoot 'LocalState\runtime'
  sessionData = Join-Path $packageRoot 'LocalCache\session'
  logs = Join-Path $packageRoot 'LocalCache\logs'
  crashDumps = Join-Path $packageRoot 'LocalCache\crash-dumps'
}
$packagePrefix = $packageRoot.TrimEnd('\') + '\'

foreach ($entry in $packagePaths.GetEnumerator()) {
  $resolved = [System.IO.Path]::GetFullPath($entry.Value)
  if (-not $resolved.StartsWith($packagePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$($entry.Key) escapes the installed package root: $resolved"
  }
  if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
    throw "$($entry.Key) was not created by the installed Store package: $resolved"
  }
}

foreach ($entry in $sharedPaths.GetEnumerator()) {
  $resolved = [System.IO.Path]::GetFullPath($entry.Value)
  if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
    throw "$($entry.Key) was not created at the shared roaming location: $resolved"
  }
}

Write-Host "Installed Store identity verified: $($package.PackageFullName)"
Write-Host 'Shared persistent paths (verify from an outside process and the direct edition):'
foreach ($entry in $sharedPaths.GetEnumerator()) {
  Write-Host "$($entry.Key): $($entry.Value)"
}
Write-Host 'Package-scoped runtime paths:'
foreach ($entry in $packagePaths.GetEnumerator()) {
  Write-Host "$($entry.Key): $($entry.Value)"
}
