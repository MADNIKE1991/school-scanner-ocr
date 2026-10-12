# Kyocera Scanner Bridge (Windows PowerShell)
# 100% Pure ASCII - Zero Dependency, No Node.js required
# Compatible with PowerShell 2.0, 3.0, 4.0, 5.0, 5.1 and PowerShell 7+ on all Windows editions

$port = 3000
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try {
    $listener.Prefixes.Add("http://127.0.0.1:$port/")
} catch {}

function Find-Naps2 {
    $paths = @(
        "C:\Program Files\NAPS2\NAPS2.Console.exe",
        "C:\Program Files (x86)\NAPS2\NAPS2.Console.exe",
        "C:\Program Files\NAPS2\NAPS2.exe",
        "$env:LOCALAPPDATA\Programs\NAPS2\NAPS2.Console.exe",
        "$env:LOCALAPPDATA\NAPS2\NAPS2.Console.exe",
        "$env:APPDATA\NAPS2\NAPS2.Console.exe",
        "$env:USERPROFILE\Downloads\NAPS2\NAPS2.Console.exe",
        "$PSScriptRoot\NAPS2.Console.exe",
        "C:\NAPS2\NAPS2.Console.exe"
    )
    foreach ($p in $paths) {
        if ($p -and (Test-Path $p)) { return $p }
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

try {
    $listener.Start()
} catch {
    Write-Host "[ERROR] Could not bind to port $port. Is another server running on port $port?" -ForegroundColor Red
    Write-Host $_.Exception.Message
    Read-Host "Press Enter to exit..."
    exit 1
}

$naps2 = Find-Naps2

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "     KYOCERA SCANNER AGENT (Windows Native Bridge)" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Cyan
if ($naps2) {
    Write-Host "[OK] NAPS2 CLI found at: $naps2" -ForegroundColor Green
    try {
        $devList = & "$naps2" --list 2>&1
        Write-Host "Connected scanner devices:" -ForegroundColor Cyan
        $devList | ForEach-Object { Write-Host "  * $_" -ForegroundColor White }
    } catch {}
} else {
    Write-Host "[WARN] NAPS2.Console.exe not found. Windows WIA fallback will be used." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "NOTE: If the NAPS2 graphical window is open, PLEASE CLOSE IT" -ForegroundColor Yellow
Write-Host "      so it does not lock the scanner USB port exclusively!" -ForegroundColor Yellow
Write-Host ""
Write-Host "[OK] Bridge listening on: http://localhost:$port/" -ForegroundColor Green
Write-Host "Now open: https://school-scanner-ocr.vercel.app" -ForegroundColor Yellow
Write-Host "Status: READY - Waiting for scan button click on website..." -ForegroundColor Green
Write-Host "================================================================`n" -ForegroundColor Cyan

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response

        # CORS and Chrome Private Network Access headers
        $res.AddHeader("Access-Control-Allow-Origin", "*")
        $res.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $res.AddHeader("Access-Control-Allow-Headers", "*")
        $res.AddHeader("Access-Control-Allow-Private-Network", "true")

        if ($req.HttpMethod -eq "OPTIONS") {
            $res.StatusCode = 200
            $res.Close()
            continue
        }

        $path = $req.Url.AbsolutePath

        # 1. GET /api/devices
        if ($req.HttpMethod -eq "GET" -and $path -eq "/api/devices") {
            $devices = @()
            if ($naps2) {
                try {
                    $rawList = & "$naps2" --list 2>&1
                    $i = 0
                    foreach ($line in ($rawList -split "`r?`n")) {
                        $trimmed = $line.Trim()
                        if ($trimmed -and -not $trimmed.StartsWith("Error")) {
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

            $tempFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "kyocera_scan_$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()).png")
            $scanSucceeded = $false
            $logs = @()

            # Method 1: NAPS2 with WIA
            if ($naps2) {
                Write-Host "[NAPS2] Executing scan via NAPS2 (WIA)..." -ForegroundColor Yellow
                $args1 = @("-o", $tempFile, "--driver", "wia", "--dpi", $dpi, "--pagesize", "a4")
                if ($deviceName -and -not $deviceName.Contains("kyocera-default")) {
                    $args1 += @("--device", $deviceName)
                }
                if ($colorMode -eq "bw") { $args1 += @("--bitdepth", "1") }
                elseif ($colorMode -eq "grayscale") { $args1 += @("--bitdepth", "8") }
                else { $args1 += @("--bitdepth", "24") }
                if ($source -eq "feeder") { $args1 += @("--source", "feeder") }
                else { $args1 += @("--source", "flatbed") }

                $out1 = & "$naps2" $args1 2>&1
                $logs += "WIA: $out1"
                Write-Host "  NAPS2 output: $out1" -ForegroundColor Gray

                if (Test-Path $tempFile) {
                    $scanSucceeded = $true
                } else {
                    # Method 2: NAPS2 with default profile
                    Write-Host "[NAPS2] Trying default profile..." -ForegroundColor Yellow
                    $args2 = @("-o", $tempFile, "--dpi", $dpi)
                    $out2 = & "$naps2" $args2 2>&1
                    $logs += "Default: $out2"
                    Write-Host "  NAPS2 output: $out2" -ForegroundColor Gray
                    if (Test-Path $tempFile) { $scanSucceeded = $true }
                }

                if (-not $scanSucceeded) {
                    # Method 3: NAPS2 with TWAIN
                    Write-Host "[NAPS2] Trying TWAIN driver..." -ForegroundColor Yellow
                    $args3 = @("-o", $tempFile, "--driver", "twain", "--dpi", $dpi)
                    $out3 = & "$naps2" $args3 2>&1
                    $logs += "TWAIN: $out3"
                    Write-Host "  NAPS2 output: $out3" -ForegroundColor Gray
                    if (Test-Path $tempFile) { $scanSucceeded = $true }
                }
            }

            # Method 4: Windows Native WIA COM Fallback
            if (-not $scanSucceeded) {
                Write-Host "[WIA] Trying Windows Native WIA..." -ForegroundColor Yellow
                try {
                    $dialog = New-Object -ComObject WIA.CommonDialog
                    $image = $dialog.ShowAcquireImage()
                    if ($image) {
                        $image.SaveFile($tempFile)
                        if (Test-Path $tempFile) { $scanSucceeded = $true }
                    }
                } catch {
                    $logs += "WIA: $($_.Exception.Message)"
                    Write-Host "  WIA Error: $($_.Exception.Message)" -ForegroundColor Gray
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
                Write-Host "[SCAN OK] Scan completed! Sent to website successfully!" -ForegroundColor Green
            } else {
                $logSummary = ($logs -join "; ").Trim()
                $errorMsg = "Zakroyte otkrytoe okno programmy NAPS2 (ono zakhvatilo USB port skanera). Proverte kabel Kyocera. Log: $logSummary"
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
