[CmdletBinding()]
param(
    [Parameter(Position=0, Mandatory)]
    [ValidateSet('register','switch','status')]
    [string]$Command,

    [Parameter(Position=1)]
    [ValidateSet('A','B')]
    [string]$Slot,

    [string]$CodexHome = (Join-Path $env:USERPROFILE '.codex'),

    [switch]$Force
)

$ErrorActionPreference = 'Stop'

try {
    Import-Module (Join-Path $PSScriptRoot 'CodexAccountSwitcher.psm1') -Force

    if ($Command -in @('register','switch') -and [string]::IsNullOrWhiteSpace($Slot)) {
        throw "Command '$Command' requires account slot A or B."
    }

    switch ($Command) {
        'register' {
            Register-CodexAccount -Slot $Slot -CodexHome $CodexHome -Force:$Force
            Write-Output "Registered account $Slot."
            Write-Output 'Exit and reopen Codex Desktop before using another account.'
        }
        'switch' {
            Switch-CodexAccount -Slot $Slot -CodexHome $CodexHome
            Write-Output "Switched to account $Slot."
            Write-Output 'Open Codex Desktop to use the selected account.'
        }
        'status' {
            $status = Get-CodexAccountStatus -CodexHome $CodexHome
            Write-Output "Active: $($status.Active)"
            Write-Output "A registered: $($status.ARegistered)"
            Write-Output "B registered: $($status.BRegistered)"
        }
    }
} catch {
    [Console]::Error.WriteLine("Error: $($_.Exception.Message)")
    exit 1
}
