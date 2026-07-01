$ErrorActionPreference = 'Stop'

$script:Passed = 0
$script:Failed = 0
$script:TestRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
    'codex-account-switcher-tests-' + [guid]::NewGuid().ToString('N'))

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        throw "Assertion failed: $Message"
    }
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Message)
    if ($Expected -ne $Actual) {
        throw "Assertion failed: $Message. Expected '$Expected', actual '$Actual'"
    }
}

function Assert-Throws {
    param([scriptblock]$Action, [string]$ExpectedMessage)
    try {
        & $Action
    } catch {
        if ($_.Exception.Message -notlike "*$ExpectedMessage*") {
            throw "Exception mismatch. Expected '$ExpectedMessage', actual '$($_.Exception.Message)'"
        }
        return
    }
    throw "Expected exception containing '$ExpectedMessage', but operation succeeded"
}

function Invoke-Test {
    param([string]$Name, [scriptblock]$Action)
    try {
        & $Action
        $script:Passed++
        Write-Host "[PASS] $Name"
    } catch {
        $script:Failed++
        Write-Host "[FAIL] $Name"
        Write-Host "       $($_.Exception.Message)"
    }
}

function New-TestCodexHome {
    param([string]$Name, [string]$Token = 'TOKEN_A')
    $codexHome = Join-Path $script:TestRoot $Name
    [System.IO.Directory]::CreateDirectory($codexHome) | Out-Null
    $json = '{"tokens":{"access_token":"' + $Token + '"}}'
    [System.IO.File]::WriteAllText(
        (Join-Path $codexHome 'auth.json'),
        $json,
        [System.Text.UTF8Encoding]::new($false))
    return $codexHome
}

try {
    [System.IO.Directory]::CreateDirectory($script:TestRoot) | Out-Null
    Import-Module (Join-Path $PSScriptRoot 'CodexAccountSwitcher.psm1') -Force

    Invoke-Test 'register A creates slot and active marker' {
        $codexHome = New-TestCodexHome 'register-a'
        Register-CodexAccount -Slot A -CodexHome $codexHome

        $slot = Join-Path $codexHome 'account-switcher\auth.account-a.json'
        $marker = Join-Path $codexHome 'account-switcher\active-account.txt'
        Assert-True (Test-Path -LiteralPath $slot) 'slot A should exist'
        Assert-Equal 'A' ([System.IO.File]::ReadAllText($marker).Trim()) 'active account should be A'
    }

    Invoke-Test 'duplicate registration is rejected by default' {
        $codexHome = New-TestCodexHome 'duplicate'
        Register-CodexAccount -Slot A -CodexHome $codexHome
        Assert-Throws {
            Register-CodexAccount -Slot A -CodexHome $codexHome
        } 'already registered'
    }

    Invoke-Test 'Force replaces an existing slot' {
        $codexHome = New-TestCodexHome 'force' 'TOKEN_OLD'
        Register-CodexAccount -Slot A -CodexHome $codexHome
        [System.IO.File]::WriteAllText(
            (Join-Path $codexHome 'auth.json'),
            '{"tokens":{"access_token":"TOKEN_NEW"}}',
            [System.Text.UTF8Encoding]::new($false))

        Register-CodexAccount -Slot A -CodexHome $codexHome -Force
        $saved = [System.IO.File]::ReadAllText(
            (Join-Path $codexHome 'account-switcher\auth.account-a.json'))
        Assert-True ($saved.Contains('TOKEN_NEW')) 'slot should contain new credentials'
    }

    Invoke-Test 'missing auth.json is rejected' {
        $codexHome = Join-Path $script:TestRoot 'missing-auth'
        [System.IO.Directory]::CreateDirectory($codexHome) | Out-Null
        Assert-Throws {
            Register-CodexAccount -Slot A -CodexHome $codexHome
        } 'Credential file not found'
    }

    Invoke-Test 'malformed auth.json is rejected' {
        $codexHome = New-TestCodexHome 'invalid-json'
        [System.IO.File]::WriteAllText(
            (Join-Path $codexHome 'auth.json'),
            '{bad json',
            [System.Text.UTF8Encoding]::new($false))
        Assert-Throws {
            Register-CodexAccount -Slot A -CodexHome $codexHome
        } 'not valid JSON'
    }

    Invoke-Test 'switching restores target and saves refreshed active credentials' {
        $codexHome = New-TestCodexHome 'switch' 'TOKEN_A'
        Register-CodexAccount -Slot A -CodexHome $codexHome

        [System.IO.File]::WriteAllText(
            (Join-Path $codexHome 'auth.json'),
            '{"tokens":{"access_token":"TOKEN_B"}}',
            [System.Text.UTF8Encoding]::new($false))
        Register-CodexAccount -Slot B -CodexHome $codexHome

        [System.IO.File]::WriteAllText(
            (Join-Path $codexHome 'auth.json'),
            '{"tokens":{"access_token":"TOKEN_B_REFRESHED"}}',
            [System.Text.UTF8Encoding]::new($false))
        Switch-CodexAccount -Slot A -CodexHome $codexHome -ProcessProbe { $false }

        $active = [System.IO.File]::ReadAllText((Join-Path $codexHome 'auth.json'))
        $savedB = [System.IO.File]::ReadAllText(
            (Join-Path $codexHome 'account-switcher\auth.account-b.json'))
        $marker = [System.IO.File]::ReadAllText(
            (Join-Path $codexHome 'account-switcher\active-account.txt')).Trim()
        $backups = @(Get-ChildItem (Join-Path $codexHome 'account-switcher\backups') -File)

        Assert-True ($active.Contains('TOKEN_A')) 'A credentials should become active'
        Assert-True ($savedB.Contains('TOKEN_B_REFRESHED')) 'refreshed B credentials should be saved'
        Assert-Equal 'A' $marker 'active marker should be A'
        Assert-True ($backups.Count -ge 1) 'a pre-switch backup should exist'
    }

    Invoke-Test 'missing target slot is rejected without changing auth.json' {
        $codexHome = New-TestCodexHome 'missing-slot' 'TOKEN_ORIGINAL'
        $before = [System.IO.File]::ReadAllText((Join-Path $codexHome 'auth.json'))
        Assert-Throws {
            Switch-CodexAccount -Slot B -CodexHome $codexHome -ProcessProbe { $false }
        } 'Credential file not found'
        $after = [System.IO.File]::ReadAllText((Join-Path $codexHome 'auth.json'))
        Assert-Equal $before $after 'auth.json should be unchanged'
    }

    Invoke-Test 'running Codex blocks switching without changing auth.json' {
        $codexHome = New-TestCodexHome 'process-running' 'TOKEN_A'
        Register-CodexAccount -Slot A -CodexHome $codexHome
        [System.IO.File]::WriteAllText(
            (Join-Path $codexHome 'auth.json'),
            '{"tokens":{"access_token":"TOKEN_B"}}',
            [System.Text.UTF8Encoding]::new($false))
        Register-CodexAccount -Slot B -CodexHome $codexHome
        $before = [System.IO.File]::ReadAllText((Join-Path $codexHome 'auth.json'))

        Assert-Throws {
            Switch-CodexAccount -Slot A -CodexHome $codexHome -ProcessProbe { $true }
        } 'Codex Desktop is running'

        $after = [System.IO.File]::ReadAllText((Join-Path $codexHome 'auth.json'))
        Assert-Equal $before $after 'auth.json should be unchanged'
    }

    Invoke-Test 'switching does not change the Codex home directory ACL' {
        $codexHome = New-TestCodexHome 'preserve-home-acl' 'TOKEN_A'
        Register-CodexAccount -Slot A -CodexHome $codexHome
        [System.IO.File]::WriteAllText(
            (Join-Path $codexHome 'auth.json'),
            '{"tokens":{"access_token":"TOKEN_B"}}',
            [System.Text.UTF8Encoding]::new($false))
        Register-CodexAccount -Slot B -CodexHome $codexHome
        $beforeAcl = (Get-Acl -LiteralPath $codexHome).Sddl

        Switch-CodexAccount -Slot A -CodexHome $codexHome -ProcessProbe { $false }

        $afterAcl = (Get-Acl -LiteralPath $codexHome).Sddl
        Assert-Equal $beforeAcl $afterAcl 'Codex home ACL should remain unchanged'
    }

    Invoke-Test 'status reports slots without exposing credentials' {
        $codexHome = New-TestCodexHome 'status' 'TOKEN_A_SECRET'
        Register-CodexAccount -Slot A -CodexHome $codexHome
        $status = Get-CodexAccountStatus -CodexHome $codexHome
        $rendered = $status | Out-String

        Assert-Equal 'A' $status.Active 'active slot should be A'
        Assert-True $status.ARegistered 'A should be registered'
        Assert-True (-not $status.BRegistered) 'B should not be registered'
        Assert-True (-not $rendered.Contains('TOKEN_A_SECRET')) 'status must not expose tokens'
    }

    Invoke-Test 'CLI status succeeds and does not create switcher files' {
        $codexHome = New-TestCodexHome 'cli-status' 'TOKEN_CLI_SECRET'
        $cli = Join-Path $PSScriptRoot 'codex-account.ps1'
        $output = & powershell -NoProfile -ExecutionPolicy Bypass -File $cli `
            status -CodexHome $codexHome 2>&1 | Out-String
        $exitCode = $LASTEXITCODE

        Assert-Equal 0 $exitCode 'CLI status should succeed'
        Assert-True ($output.Contains('Active: Unknown')) 'CLI should report unknown active slot'
        Assert-True (-not $output.Contains('TOKEN_CLI_SECRET')) 'CLI must not expose tokens'
        Assert-True (
            -not (Test-Path -LiteralPath (Join-Path $codexHome 'account-switcher'))
        ) 'status should not create files'
    }
} finally {
    if (Test-Path -LiteralPath $script:TestRoot) {
        Remove-Item -LiteralPath $script:TestRoot -Recurse -Force
    }
}

Write-Host ""
Write-Host "Result: passed $script:Passed, failed $script:Failed"
if ($script:Failed -gt 0) {
    exit 1
}
