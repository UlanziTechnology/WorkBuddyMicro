param(
  [ValidateSet('WorkBuddy', 'WorkBuddy AI')][string]$Brand = 'WorkBuddy',
  [ValidateSet('resolve', 'restart', 'foreground')][string]$Mode = 'resolve'
)
$ErrorActionPreference = 'Stop'

# Resolve before requesting exit, including custom-drive and per-user installs.
function Find-WorkBuddyExe {
  if ($env:WORKBUDDY_EXE) {
    if (!(Test-Path -LiteralPath $env:WORKBUDDY_EXE -PathType Leaf) -or
        [IO.Path]::GetFileName($env:WORKBUDDY_EXE) -ne "$Brand.exe") {
      throw 'WORKBUDDY_EXE must point to the selected WorkBuddy executable.'
    }
    return (Get-Item -LiteralPath $env:WORKBUDDY_EXE).FullName
  }
  $running = Get-Process -Name $Brand -ErrorAction SilentlyContinue |
    Where-Object Path | Select-Object -First 1 -ExpandProperty Path
  if ($running) { return $running }
  $scheme = if ($Brand -eq 'WorkBuddy AI') {'workbuddy-ai'} else {'workbuddy'}
  $commandKey = Get-Item -LiteralPath "Registry::HKEY_CLASSES_ROOT\$scheme\shell\open\command" -ErrorAction SilentlyContinue
  if ($commandKey) {
    $command = [Environment]::ExpandEnvironmentVariables($commandKey.GetValue(''))
    if ($command -match '^\s*"([^"]+\.exe)"|^\s*(.+?\.exe)(?:\s|$)') {
      $registered = if ($Matches[1]) {$Matches[1]} else {$Matches[2]}
      if ([IO.Path]::GetFileName($registered) -eq "$Brand.exe" -and
          (Test-Path -LiteralPath $registered -PathType Leaf)) { return $registered }
    }
  }
  $candidates = @()
  if ($env:LOCALAPPDATA) {
    $candidates += Join-Path $env:LOCALAPPDATA "$Brand\$Brand.exe"
    $candidates += Join-Path $env:LOCALAPPDATA "Programs\$Brand\$Brand.exe"
  }
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if ($base) { $candidates += Join-Path $base "$Brand\$Brand.exe" }
  }
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  $keys = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
  foreach ($key in $keys) {
    foreach ($entry in (Get-ItemProperty $key -ErrorAction SilentlyContinue)) {
      if ($entry.DisplayName -like "*$Brand*" -and $entry.InstallLocation) {
        $candidate = Join-Path $entry.InstallLocation "$Brand.exe"
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
      }
    }
  }
  throw 'WorkBuddy not found. Install it or set WORKBUDDY_EXE to its executable path.'
}

try {
  $exe = Find-WorkBuddyExe
  if ($Mode -eq 'resolve') { $exe; exit }
  $all = @(Get-Process -Name $Brand -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $exe})
  if ($Mode -eq 'foreground') {
    # The renderer can become ready before Electron publishes its native window.
    $deadline = (Get-Date).AddSeconds(5)
    $shell = New-Object -ComObject WScript.Shell
    do {
      $windows = @(Get-Process -Name $Brand -ErrorAction SilentlyContinue |
        Where-Object {$_.Path -eq $exe -and $_.MainWindowHandle -ne 0})
      if ($windows.Count -and $shell.AppActivate($windows[0].Id)) { exit }
      Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $deadline)
    throw 'Could not activate WorkBuddy. Open its window and retry.'
  }
  # Closing Electron's window leaves the tray process and single-instance lock alive.
  # Force restart is intentional; only terminate processes from the resolved install.
  foreach ($app in $all) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
  $deadline = (Get-Date).AddSeconds(10)
  do {
    $remaining = @(Get-Process -Name $Brand -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $exe})
    if (!$remaining.Count) { break }
    if ((Get-Date) -ge $deadline) { throw 'Could not stop WorkBuddy. Quit it from the tray menu and retry.' }
    Start-Sleep -Milliseconds 200
  } while ($true)
  # WorkBuddy is the interactive target, not a background helper.
  Start-Process -FilePath $exe -ArgumentList '--remote-debugging-address=127.0.0.1 --remote-debugging-port=9223' -WindowStyle Normal
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
