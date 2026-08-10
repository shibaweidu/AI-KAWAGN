[CmdletBinding()]
param(
  [switch]$SkipInstall,
  [switch]$SetupOnly,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot ".env"
$envExamplePath = Join-Path $repoRoot ".env.example"
$script:PnpmCommand = $null
$script:PnpmPrefix = @()

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Invoke-Checked([string]$FilePath, [string[]]$ArgumentList) {
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
}

function Invoke-Pnpm([string[]]$ArgumentList) {
  Invoke-Checked $script:PnpmCommand ($script:PnpmPrefix + $ArgumentList)
}

function New-HexSecret([int]$ByteCount = 32) {
  $bytes = New-Object byte[] $ByteCount
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
}

function Get-DotEnvValue([string]$Name) {
  if (-not (Test-Path -LiteralPath $envPath)) { return "" }
  $content = [System.IO.File]::ReadAllText($envPath)
  $match = [regex]::Match($content, "(?m)^$([regex]::Escape($Name))=(.*)$")
  if (-not $match.Success) { return "" }
  return $match.Groups[1].Value.Trim()
}

function Set-DotEnvValue([string]$Name, [string]$Value) {
  $content = [System.IO.File]::ReadAllText($envPath)
  $pattern = "(?m)^$([regex]::Escape($Name))=.*$"
  $line = "$Name=$Value"
  if ([regex]::IsMatch($content, $pattern)) {
    $content = [regex]::Replace($content, $pattern, $line)
  } else {
    if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) { $content += "`r`n" }
    $content += "$line`r`n"
  }
  [System.IO.File]::WriteAllText($envPath, $content, (New-Object System.Text.UTF8Encoding($false)))
}

function Import-DotEnv {
  foreach ($line in [System.IO.File]::ReadAllLines($envPath)) {
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
    $name = $matches[1]
    $value = $matches[2].Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

function Wait-TcpPort([int]$Port, [string]$Label, [int]$TimeoutSeconds = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $connection = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
      if ($connection.AsyncWaitHandle.WaitOne(800, $false) -and $client.Connected) {
        $client.EndConnect($connection)
        Write-Host "  Ready: $Label (port $Port)" -ForegroundColor Green
        return
      }
    } catch {
      # The service may still be starting.
    } finally {
      $client.Dispose()
    }
    Start-Sleep -Milliseconds 750
  }
  throw "$Label did not become ready on port $Port within $TimeoutSeconds seconds"
}

try {
  Set-Location -LiteralPath $repoRoot

  Write-Step "Checking local prerequisites"
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw "Node.js 20 or newer is required: https://nodejs.org/" }
  $nodeVersion = (& node --version).Trim().TrimStart("v")
  if ([int]($nodeVersion.Split(".")[0]) -lt 20) { throw "Node.js 20 or newer is required; found $nodeVersion" }

  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($pnpm) {
    $script:PnpmCommand = $pnpm.Source
  } else {
    $corepack = Get-Command corepack -ErrorAction SilentlyContinue
    if (-not $corepack) { throw "pnpm or Corepack is required" }
    $script:PnpmCommand = $corepack.Source
    $script:PnpmPrefix = @("pnpm")
  }

  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) { throw "Docker Desktop is required: https://www.docker.com/products/docker-desktop/" }
  & docker info --format "{{.ServerVersion}}" *> $null
  if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is installed but its engine is not running" }
  Write-Host "  Node $nodeVersion, pnpm and Docker are ready" -ForegroundColor Green

  Write-Step "Preparing local configuration"
  if (-not (Test-Path -LiteralPath $envPath)) {
    Copy-Item -LiteralPath $envExamplePath -Destination $envPath
    Write-Host "  Created .env from .env.example"
  }

  $adminEmail = Get-DotEnvValue "ADMIN_EMAIL"
  if ([string]::IsNullOrWhiteSpace($adminEmail)) {
    $adminEmail = "admin@localhost.local"
    Set-DotEnvValue "ADMIN_EMAIL" $adminEmail
  }
  $adminPassword = Get-DotEnvValue "ADMIN_PASSWORD"
  if ([string]::IsNullOrWhiteSpace($adminPassword) -or $adminPassword.Length -lt 12) {
    $adminPassword = "Local-$(New-HexSecret 12)"
    Set-DotEnvValue "ADMIN_PASSWORD" $adminPassword
  }
  foreach ($secretName in @("JWT_SECRET", "WORKER_TOKEN")) {
    $secret = Get-DotEnvValue $secretName
    if ($secret.Length -lt 32 -or $secret.StartsWith("replace-")) {
      Set-DotEnvValue $secretName (New-HexSecret 32)
    }
  }
  Set-DotEnvValue "ENABLE_SOURCE_SCHEDULERS" "false"
  Set-DotEnvValue "PAUSE_SOURCE_JOBS" "true"
  if ([string]::IsNullOrWhiteSpace((Get-DotEnvValue "SOURCE_211B_REQUEST_DELAY_MS"))) {
    Set-DotEnvValue "SOURCE_211B_REQUEST_DELAY_MS" "3000"
  }
  Import-DotEnv
  $env:ENABLE_SOURCE_SCHEDULERS = "false"
  $env:PAUSE_SOURCE_JOBS = "true"
  Write-Host "  Source collection is paused for this local session" -ForegroundColor Yellow

  Write-Step "Starting PostgreSQL, Redis, Meilisearch and MinIO"
  Invoke-Checked $docker.Source @("compose", "up", "-d", "postgres", "redis", "meilisearch", "minio")
  Wait-TcpPort 5432 "PostgreSQL"
  Wait-TcpPort 6379 "Redis"
  Wait-TcpPort 7700 "Meilisearch"
  Wait-TcpPort 9000 "MinIO"

  if (-not $SkipInstall) {
    Write-Step "Installing workspace dependencies"
    Invoke-Pnpm @("install", "--frozen-lockfile")
  }

  Write-Step "Generating database client and applying migrations"
  Invoke-Pnpm @("db:generate")
  Invoke-Pnpm @("--filter", "@ai-card/api", "prisma:deploy")

  Write-Step "Creating or updating the local administrator"
  Invoke-Pnpm @("--filter", "@ai-card/api", "admin:create")

  Write-Host "`nLocal administrator" -ForegroundColor Green
  Write-Host "  Email:    $adminEmail"
  Write-Host "  Password: $adminPassword"
  Write-Host "`nURLs"
  Write-Host "  Website:  http://localhost:3000"
  Write-Host "  Admin:    http://localhost:3000/admin"
  Write-Host "  API:      http://localhost:4000/v1/health"

  if ($SetupOnly) {
    Write-Host "`nSetup completed. Application processes were not started." -ForegroundColor Green
    exit 0
  }

  $browserJob = $null
  if (-not $NoBrowser) {
    $browserJob = Start-Job -ScriptBlock {
      for ($attempt = 0; $attempt -lt 90; $attempt++) {
        try {
          $response = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 2
          if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
            Start-Process "http://localhost:3000"
            return
          }
        } catch {}
        Start-Sleep -Seconds 1
      }
    }
  }

  Write-Step "Starting Web, API and Worker"
  Write-Host "Press Ctrl+C to stop application processes. Docker data services remain available for the next start.`n" -ForegroundColor DarkGray
  try {
    Invoke-Pnpm @("dev")
  } finally {
    if ($browserJob) {
      Stop-Job -Job $browserJob -ErrorAction SilentlyContinue
      Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
    }
  }
} catch {
  Write-Host "`nStartup failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
