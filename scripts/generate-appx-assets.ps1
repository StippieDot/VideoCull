Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $root 'build\videocull.ico'
$outputDir = Join-Path $root 'build\appx'

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$icon = [System.Drawing.Icon]::ExtractAssociatedIcon($sourcePath)
if ($null -eq $icon) {
  throw "Could not read $sourcePath"
}

function Write-AppxAsset([string]$name, [int]$width, [int]$height, [int]$iconSize) {
  $bitmap = New-Object System.Drawing.Bitmap $width, $height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $x = [int](($width - $iconSize) / 2)
    $y = [int](($height - $iconSize) / 2)
    $graphics.DrawIcon($icon, (New-Object System.Drawing.Rectangle $x, $y, $iconSize, $iconSize))
    $bitmap.Save((Join-Path $outputDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

try {
  Write-AppxAsset 'StoreLogo.png' 50 50 42
  Write-AppxAsset 'Square44x44Logo.png' 44 44 36
  Write-AppxAsset 'Square150x150Logo.png' 150 150 124
  Write-AppxAsset 'Wide310x150Logo.png' 310 150 124
}
finally {
  $icon.Dispose()
}
