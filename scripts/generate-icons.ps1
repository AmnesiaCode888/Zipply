Add-Type -AssemblyName System.Drawing

$resourcesDir = Join-Path $PSScriptRoot "..\resources"
$buildDir = Join-Path $PSScriptRoot "..\build"
$iconsDir = Join-Path $buildDir "icons"

$srcPath = if ($args.Count -gt 0 -and $args[0]) { $args[0] } else { Join-Path $resourcesDir "logo.png" }
if (-not (Test-Path $srcPath)) {
    Write-Error "Source image not found: $srcPath. Please specify an image path or place logo.png into resources/."
    exit 1
}

$srcImg = [System.Drawing.Image]::FromFile($srcPath)

New-Item -ItemType Directory -Force -Path $resourcesDir | Out-Null
New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null

function Resize-Image($img, $width, $height) {
    $destRect = New-Object System.Drawing.Rectangle(0, 0, $width, $height)
    $destImg = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($destImg)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    
    $graphics.DrawImage($img, $destRect, 0, 0, $img.Width, $img.Height, [System.Drawing.GraphicsUnit]::Pixel)
    $graphics.Dispose()
    return $destImg
}

$sizes = @(16, 24, 32, 48, 64, 128, 256, 512)
$icoSizes = @(16, 24, 32, 48, 64, 128, 256)
$pngDataList = @()

foreach ($s in $sizes) {
    $resized = Resize-Image $srcImg $s $s
    $outPath = Join-Path $iconsDir "$($s)x$($s).png"
    $resized.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    
    if ($s -eq 512) {
        $resized.Save((Join-Path $resourcesDir "icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        $resized.Save((Join-Path $buildDir "icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    }

    if ($icoSizes -contains $s) {
        $ms = New-Object System.IO.MemoryStream
        $resized.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $ms.ToArray()
        $ms.Dispose()
        $pngDataList += ,@($s, $bytes)
    }

    $resized.Dispose()
}

# Also copy original to resources if different
$destLogo = Join-Path $resourcesDir "logo.png"
if ((Resolve-Path $srcPath).Path -ne (Resolve-Path $destLogo).Path) {
    Copy-Item -Path $srcPath -Destination $destLogo -Force
}

# Generate .ico file containing PNG entries
function Write-Ico($icoPath, $images) {
    $fs = New-Object System.IO.FileStream($icoPath, [System.IO.FileMode]::Create)
    $bw = New-Object System.IO.BinaryWriter($fs)

    # Header
    $bw.Write([uint16]0)          # Reserved
    $bw.Write([uint16]1)          # Type: 1 = ICO
    $bw.Write([uint16]$images.Count) # Number of images

    $offset = 6 + ($images.Count * 16)

    # Directory entries
    foreach ($entry in $images) {
        $s = $entry[0]
        $data = $entry[1]
        $w = if ($s -ge 256) { 0 } else { $s }
        $h = if ($s -ge 256) { 0 } else { $s }

        $bw.Write([byte]$w)       # Width
        $bw.Write([byte]$h)       # Height
        $bw.Write([byte]0)        # Color count
        $bw.Write([byte]0)        # Reserved
        $bw.Write([uint16]1)      # Color planes
        $bw.Write([uint16]32)     # Bits per pixel
        $bw.Write([uint32]$data.Length) # Size of image data
        $bw.Write([uint32]$offset)      # Offset of image data

        $offset += $data.Length
    }

    # Image data
    foreach ($entry in $images) {
        $data = $entry[1]
        $bw.Write($data)
    }

    $bw.Flush()
    $bw.Close()
    $fs.Close()
}

Write-Ico (Join-Path $resourcesDir "icon.ico") $pngDataList
Write-Ico (Join-Path $buildDir "icon.ico") $pngDataList

$srcImg.Dispose()
Write-Host "Icons generated successfully in resources/ and build/!"
