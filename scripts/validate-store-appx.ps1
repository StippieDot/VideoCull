param(
  [Parameter(Mandatory = $true)]
  [string]$PackagePath,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedVersion
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$product = Get-Content -LiteralPath (Join-Path $root 'product.json') -Raw | ConvertFrom-Json
$resolvedPackage = (Resolve-Path -LiteralPath $PackagePath).Path

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($resolvedPackage)
try {
  $manifestEntry = $archive.Entries | Where-Object { $_.FullName -ceq 'AppxManifest.xml' } | Select-Object -First 1
  if (-not $manifestEntry) { throw 'AppxManifest.xml is missing from the AppX.' }
  $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
  try { [xml]$manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }

  $identity = $manifest.Package.Identity
  if ($identity.Name -cne $product.microsoftStore.identityName) { throw "Unexpected identity name: $($identity.Name)" }
  if ($identity.Publisher -cne $product.microsoftStore.publisher) { throw "Unexpected publisher: $($identity.Publisher)" }
  if ($identity.ProcessorArchitecture -cne 'x64') { throw "Unexpected architecture: $($identity.ProcessorArchitecture)" }
  if ($identity.Version -cne $ExpectedVersion) { throw "Unexpected package version: $($identity.Version)" }
  if ($manifest.Package.Properties.PublisherDisplayName -cne $product.microsoftStore.publisherDisplayName) {
    throw "Unexpected publisher display name: $($manifest.Package.Properties.PublisherDisplayName)"
  }

  $desktopDependency = @($manifest.Package.Dependencies.ChildNodes) | Where-Object { $_.Name -eq 'Windows.Desktop' } | Select-Object -First 1
  if (-not $desktopDependency -or $desktopDependency.MinVersion -cne '10.0.19041.0') {
    throw 'The AppX must target Windows.Desktop with minimum version 10.0.19041.0.'
  }
  $capabilities = @($manifest.Package.Capabilities.ChildNodes | ForEach-Object { $_.GetAttribute('Name') } | Sort-Object)
  $expectedCapabilities = @('runFullTrust', 'unvirtualizedResources') | Sort-Object
  if (($capabilities -join ',') -cne ($expectedCapabilities -join ',')) {
    throw "Unexpected AppX capabilities: $($capabilities -join ', ')"
  }

  $namespaceManager = [System.Xml.XmlNamespaceManager]::new($manifest.NameTable)
  $namespaceManager.AddNamespace('foundation', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
  $namespaceManager.AddNamespace('desktop6', 'http://schemas.microsoft.com/appx/manifest/desktop/windows10/6')
  $fileSystemVirtualization = @($manifest.SelectNodes(
    '/foundation:Package/foundation:Properties/desktop6:FileSystemWriteVirtualization',
    $namespaceManager
  ))
  if ($fileSystemVirtualization.Count -ne 1 -or $fileSystemVirtualization[0].InnerText.Trim() -cne 'disabled') {
    throw 'The AppX must disable desktop6 filesystem write virtualization.'
  }
  $registryVirtualization = @($manifest.SelectNodes(
    '/foundation:Package/foundation:Properties/desktop6:RegistryWriteVirtualization',
    $namespaceManager
  ))
  if ($registryVirtualization.Count -ne 0) {
    throw 'The AppX must leave registry write virtualization enabled by omitting desktop6:RegistryWriteVirtualization.'
  }

  $entryNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/').ToLowerInvariant() })
  foreach ($asset in @('assets/storelogo.png', 'assets/square44x44logo.png', 'assets/square150x150logo.png', 'assets/wide310x150logo.png')) {
    if ($entryNames -notcontains $asset) { throw "Required AppX asset is missing: $asset" }
  }
  foreach ($targetSize in @(16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256)) {
    foreach ($altForm in @('unplated', 'lightunplated')) {
      $asset = "assets/square44x44logo.targetsize-${targetSize}_altform-${altForm}.png"
      if ($entryNames -notcontains $asset) { throw "Required AppX target-size asset is missing: $asset" }
    }
  }
} finally {
  $archive.Dispose()
}

Write-Host "Store AppX validated: $resolvedPackage ($ExpectedVersion, x64, runFullTrust, unvirtualizedResources, filesystem virtualization disabled)"
