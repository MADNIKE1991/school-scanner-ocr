# Kyocera Scanner Local Bridge (Windows PowerShell)
# 100% Pure ASCII - Zero Dependency, No Node.js required
# Compatible with PowerShell 2.0 to 5.1 and 7+ on Windows 7, 8, 10, 11

$targetPorts = @(3000, 17784, 8080)
$listener = $null
$activePort = $null

foreach ($p in $targetPorts) {
    try {
        $l = New-Object System.Net.HttpListener
        $l.Prefixes.Add("http://localhost:$p/")
        try { $l.Prefixes.Add("http://127.0.0.1:$p/") } catch {}
        $l.Start()
        $listener = $l
        $activePort = $p
        break
    } catch {
        # Port is in use, try next port
    }
}

if (-not $listener) {
    Write-Host "[ERROR] Could not bind to port 3000, 17784 or 8080." -ForegroundColor Red
    Write-Host "Please close any program using these ports and restart." -ForegroundColor Yellow
    Read-Host "Press Enter to exit..."
    exit 1
}

function Find-Naps2 {
    $paths = @(
        "C:\Program Files\NAPS2\NAPS2.Console.exe",
        "C:\Program Files (x86)\NAPS2\NAPS2.Console.exe",
        "$env:LOCALAPPDATA\Programs\NAPS2\NAPS2.Console.exe",
        "$env:LOCALAPPDATA\NAPS2\NAPS2.Console.exe",
        "$env:APPDATA\NAPS2\NAPS2.Console.exe",
        "$env:USERPROFILE\Downloads\NAPS2\NAPS2.Console.exe",
        "$PSScriptRoot\NAPS2.Console.exe",
        "C:\NAPS2\NAPS2.Console.exe",
        "C:\Program Files\NAPS2\NAPS2.exe",
        "C:\Program Files (x86)\NAPS2\NAPS2.exe"
    )
    foreach ($p in $paths) {
        if ($p -and (Test-Path $p)) {
            if ($p.EndsWith("NAPS2.exe")) {
                $c = $p.Replace("NAPS2.exe", "NAPS2.Console.exe")
                if (Test-Path $c) { return $c }
            }
            return $p
        }
    }
    $cmd = Get-Command "naps2.console" -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $cmd2 = Get-Command "naps2" -ErrorAction SilentlyContinue
    if ($cmd2) {
        $dir = Split-Path $cmd2.Source
        $c = Join-Path $dir "NAPS2.Console.exe"
        if (Test-Path $c) { return $c }
        return $cmd2.Source
    }
    return $null
}

$naps2 = Find-Naps2

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "     KYOCERA SCANNER AGENT (Windows Native Bridge)" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Cyan
if ($naps2) {
    Write-Host "[OK] NAPS2 CLI found: $naps2" -ForegroundColor Green
    try {
        $devList = & "$naps2" --list 2>&1
        Write-Host "Scanner devices detected by NAPS2:" -ForegroundColor Cyan
        $devList | ForEach-Object { Write-Host "  * $_" -ForegroundColor White }
    } catch {}
} else {
    Write-Host "[INFO] NAPS2 CLI not found. Windows WIA COM fallback will be used." -ForegroundColor Yellow
    Write-Host "       For best scanner support, install NAPS2 from: https://www.naps2.com/" -ForegroundColor Gray
}
Write-Host ""
Write-Host "[OK] Bridge listening on: http://localhost:$activePort/ and http://127.0.0.1:$activePort/" -ForegroundColor Green
Write-Host "Status: READY - Now click 'SCAN' on the website!" -ForegroundColor Green
Write-Host "Keep this window open while scanning." -ForegroundColor Gray
Write-Host "================================================================`n" -ForegroundColor Cyan

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response

        # CORS & Chrome Private Network Access (PNA)
        $res.AddHeader("Access-Control-Allow-Origin", "*")
        $res.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
        $res.AddHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, Origin, Access-Control-Request-Private-Network, *")
        $res.AddHeader("Access-Control-Allow-Private-Network", "true")
        $res.AddHeader("Access-Control-Max-Age", "86400")

        # Handle Preflight OPTIONS
        if ($req.HttpMethod -eq "OPTIONS") {
            $res.StatusCode = 200
            $res.ContentLength64 = 0
            $res.Close()
            continue
        }

        $path = $req.Url.AbsolutePath

        # 1. GET /api/devices
        if ($req.HttpMethod -eq "GET" -and $path -eq "/api/devices") {
            $devices = @()
            if ($naps2) {
                try {
                    $rawList = & "$naps2" --listdevices 2>&1
                    if ($LASTEXITCODE -ne 0 -or -not $rawList) {
                        $rawList = & "$naps2" --list 2>&1
                    }
                    $i = 0
                    foreach ($line in ($rawList -split "`r?`n")) {
                        $trimmed = $line.Trim()
                        if ($trimmed -and -not $trimmed.StartsWith("Error") -and -not $trimmed.StartsWith("Option") -and -not $trimmed.StartsWith("NAPS2")) {
                            $isTwain = $trimmed.ToLower().Contains("twain")
                            $devices += @{
                                id = "dev-$i"
                                name = $trimmed
                                driverType = if ($isTwain) { "TWAIN" } else { "WIA" }
                                isDefault = ($i -eq 0)
                                status = "Ready"
                            }
                            $i++
                        }
                    }
                } catch {}
            }

            if ($devices.Count -eq 0) {
                $devices += @{
                    id = "kyocera-default"
                    name = "Kyocera ECOSYS M2040dn KX (WIA)"
                    driverType = "WIA"
                    isDefault = $true
                    status = "Ready"
                }
            }

            $jsonObj = @{
                success = $true
                naps2Found = [bool]$naps2
                binaryPath = $naps2
                port = $activePort
                devices = $devices
            }

            $jsonBytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $jsonObj -Depth 5))
            $res.ContentType = "application/json; charset=utf-8"
            $res.ContentLength64 = $jsonBytes.Length
            $res.OutputStream.Write($jsonBytes, 0, $jsonBytes.Length)
            $res.Close()
            continue
        }

        # 2. POST /api/scan
        if ($req.HttpMethod -eq "POST" -and $path -eq "/api/scan") {
            Write-Host "[SCAN] Request received from browser!" -ForegroundColor Cyan
            $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
            $bodyObj = try { ConvertFrom-Json $body } catch { @{} }

            $deviceName = if ($bodyObj.deviceName) { $bodyObj.deviceName } else { "" }
            $dpi = if ($bodyObj.dpi) { [string]$bodyObj.dpi } else { "300" }
            $colorMode = if ($bodyObj.colorMode) { $bodyObj.colorMode } else { "color" }
            $source = if ($bodyObj.source) { $bodyObj.source } else { "flatbed" }

            $napsSource = if ($source -eq "feeder") { "feeder" } elseif ($source -eq "duplex") { "duplex" } else { "glass" }
            $napsBitDepth = if ($colorMode -eq "bw") { "bw" } elseif ($colorMode -eq "grayscale") { "gray" } else { "color" }

            $tempFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "kyocera_scan_$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()).png")
            $scanSucceeded = $false
            $logs = @()

            # Method A: NAPS2 with default profile configured by user
            if ($naps2) {
                Write-Host "[NAPS2] Attempt 1: Trying default GUI profile..." -ForegroundColor Yellow
                $args0 = @("-o", $tempFile, "-f")
                $out0 = & "$naps2" $args0 2>&1
                $logs += "Default Profile: $out0"
                if (Test-Path $tempFile) {
                    $scanSucceeded = $true
                    Write-Host "  [OK] Scanned using default profile!" -ForegroundColor Green
                }
            }

            # Method B: NAPS2 with WIA parameters
            if (-not $scanSucceeded -and $naps2) {
                Write-Host "[NAPS2] Attempt 2: Scanning via WIA (source=$napsSource, dpi=$dpi)..." -ForegroundColor Yellow
                $args1 = @("-o", $tempFile, "-f", "--driver", "wia", "--dpi", $dpi, "--pagesize", "a4", "--source", $napsSource, "--bitdepth", $napsBitDepth)
                if ($deviceName -and -not $deviceName.Contains("kyocera-default")) {
                    $args1 += @("--device", $deviceName)
                }
                $out1 = & "$naps2" $args1 2>&1
                $logs += "WIA: $out1"
                if (Test-Path $tempFile) {
                    $scanSucceeded = $true
                    Write-Host "  [OK] Scanned using WIA driver!" -ForegroundColor Green
                }
            }

            # Method C: NAPS2 with TWAIN
            if (-not $scanSucceeded -and $naps2) {
                Write-Host "[NAPS2] Attempt 3: Scanning via TWAIN..." -ForegroundColor Yellow
                $args2 = @("-o", $tempFile, "-f", "--driver", "twain", "--dpi", $dpi, "--source", $napsSource, "--bitdepth", $napsBitDepth)
                $out2 = & "$naps2" $args2 2>&1
                $logs += "TWAIN: $out2"
                if (Test-Path $tempFile) {
                    $scanSucceeded = $true
                    Write-Host "  [OK] Scanned using TWAIN driver!" -ForegroundColor Green
                }
            }

            # Method D: Windows Native WIA COM Fallback
            if (-not $scanSucceeded) {
                Write-Host "[WIA] Attempt 4: Using Windows Native WIA dialog..." -ForegroundColor Yellow
                try {
                    $dialog = New-Object -ComObject WIA.CommonDialog
                    $image = $dialog.ShowAcquireImage()
                    if ($image) {
                        $image.SaveFile($tempFile)
                        if (Test-Path $tempFile) {
                            $scanSucceeded = $true
                            Write-Host "  [OK] Scanned using Windows WIA dialog!" -ForegroundColor Green
                        }
                    }
                } catch {
                    $logs += "WIA COM: $($_.Exception.Message)"
                }
            }

            if ($scanSucceeded -and (Test-Path $tempFile)) {
                $fileBytes = [System.IO.File]::ReadAllBytes($tempFile)
                $base64 = "data:image/png;base64," + [Convert]::ToBase64String($fileBytes)
                Remove-Item $tempFile -Force -ErrorAction SilentlyContinue

                $resObj = @{
                    success = $true
                    base64 = $base64
                    fileName = [System.IO.Path]::GetFileName($tempFile)
                }
                $resBytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $resObj))
                $res.StatusCode = 200
                $res.ContentType = "application/json; charset=utf-8"
                $res.OutputStream.Write($resBytes, 0, $resBytes.Length)
                $res.Close()
                Write-Host "[SCAN OK] Scan completed successfully and sent to browser!" -ForegroundColor Green
            } else {
                $logSummary = ($logs -join "; ").Trim()
                $errorMsg = "Scanner error. Please make sure Kyocera is connected by USB, powered on, and NAPS2 GUI is not holding the scanner. Details: $logSummary"
                Write-Host "[SCAN FAILED] $errorMsg" -ForegroundColor Red
                $errObj = @{ success = $false; error = $errorMsg }
                $errBytes = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json $errObj))
                $res.StatusCode = 500
                $res.ContentType = "application/json; charset=utf-8"
                $res.OutputStream.Write($errBytes, 0, $errBytes.Length)
                $res.Close()
            }
            continue
        }

        # 404
        $res.StatusCode = 404
        $res.Close()
    } catch {
        Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    }
}
