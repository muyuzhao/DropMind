Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-ValidCredentialFile {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Credential file not found: $Path"
    }

    try {
        $content = [System.IO.File]::ReadAllText($Path)
        $json = $content | ConvertFrom-Json -ErrorAction Stop
    } catch {
        throw "Credential file is not valid JSON: $Path"
    }

    if ($null -eq $json) {
        throw "Credential file is empty: $Path"
    }
}

function Get-SwitcherPaths {
    param([Parameter(Mandatory)][string]$CodexHome)

    $root = Join-Path $CodexHome 'account-switcher'
    @{
        Auth = Join-Path $CodexHome 'auth.json'
        Root = $root
        Marker = Join-Path $root 'active-account.txt'
        A = Join-Path $root 'auth.account-a.json'
        B = Join-Path $root 'auth.account-b.json'
    }
}

function Protect-CurrentUserOnly {
    param([Parameter(Mandatory)][string]$Path)

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $acl = Get-Acl -LiteralPath $Path
    $acl.SetAccessRuleProtection($true, $false)

    foreach ($rule in @($acl.Access)) {
        [void]$acl.RemoveAccessRuleAll($rule)
    }

    $rights = if (Test-Path -LiteralPath $Path -PathType Container) {
        [System.Security.AccessControl.FileSystemRights]::FullControl
    } else {
        [System.Security.AccessControl.FileSystemRights]::FullControl
    }
    $inheritance = if (Test-Path -LiteralPath $Path -PathType Container) {
        [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    } else {
        [System.Security.AccessControl.InheritanceFlags]::None
    }
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $identity,
        $rights,
        $inheritance,
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow)
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
}

function Ensure-SwitcherDirectory {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        [System.IO.Directory]::CreateDirectory($Path) | Out-Null
    }
    Protect-CurrentUserOnly -Path $Path
}

function Copy-AtomicFile {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Destination
    )

    Assert-ValidCredentialFile -Path $Source
    $directory = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        [System.IO.Directory]::CreateDirectory($directory) | Out-Null
    }
    $temporary = Join-Path $directory ('.tmp-' + [guid]::NewGuid().ToString('N'))
    $replacementBackup = Join-Path $directory ('.bak-' + [guid]::NewGuid().ToString('N'))

    try {
        [System.IO.File]::Copy($Source, $temporary, $true)
        Assert-ValidCredentialFile -Path $temporary
        Protect-CurrentUserOnly -Path $temporary

        if (Test-Path -LiteralPath $Destination -PathType Leaf) {
            [System.IO.File]::Replace($temporary, $Destination, $replacementBackup)
        } else {
            [System.IO.File]::Move($temporary, $Destination)
        }
        Protect-CurrentUserOnly -Path $Destination
    } finally {
        if (Test-Path -LiteralPath $temporary) {
            Remove-Item -LiteralPath $temporary -Force
        }
        if (Test-Path -LiteralPath $replacementBackup) {
            Remove-Item -LiteralPath $replacementBackup -Force
        }
    }
}

function Set-ActiveMarker {
    param(
        [Parameter(Mandatory)][hashtable]$Paths,
        [Parameter(Mandatory)][ValidateSet('A','B')][string]$Slot
    )

    Ensure-SwitcherDirectory -Path $Paths.Root
    [System.IO.File]::WriteAllText(
        $Paths.Marker,
        $Slot,
        [System.Text.UTF8Encoding]::new($false))
    Protect-CurrentUserOnly -Path $Paths.Marker
}

function Register-CodexAccount {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet('A','B')][string]$Slot,
        [Parameter(Mandatory)][string]$CodexHome,
        [switch]$Force
    )

    $paths = Get-SwitcherPaths -CodexHome $CodexHome
    Assert-ValidCredentialFile -Path $paths.Auth
    $destination = $paths[$Slot]

    if ((Test-Path -LiteralPath $destination -PathType Leaf) -and -not $Force) {
        throw "Account $Slot is already registered. Use -Force to replace it."
    }

    Ensure-SwitcherDirectory -Path $paths.Root
    Copy-AtomicFile -Source $paths.Auth -Destination $destination
    Set-ActiveMarker -Paths $paths -Slot $Slot
}

function Test-CodexRunning {
    @(Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -match '^(Codex|codex)$' }).Count -gt 0
}

function Switch-CodexAccount {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet('A','B')][string]$Slot,
        [Parameter(Mandatory)][string]$CodexHome,
        [scriptblock]$ProcessProbe = { Test-CodexRunning }
    )

    if (& $ProcessProbe) {
        throw 'Codex Desktop is running. Exit it completely before switching.'
    }

    $paths = Get-SwitcherPaths -CodexHome $CodexHome
    Assert-ValidCredentialFile -Path $paths.Auth
    Assert-ValidCredentialFile -Path $paths[$Slot]

    $activeSlot = $null
    if (Test-Path -LiteralPath $paths.Marker -PathType Leaf) {
        $candidate = [System.IO.File]::ReadAllText(
            $paths.Marker).Trim().ToUpperInvariant()
        if ($candidate -in @('A','B')) {
            $activeSlot = $candidate
        }
    }

    $backupDirectory = Join-Path $paths.Root 'backups'
    Ensure-SwitcherDirectory -Path $backupDirectory
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $backupPath = Join-Path $backupDirectory "auth-before-$Slot-$stamp.json"
    Copy-AtomicFile -Source $paths.Auth -Destination $backupPath

    if ($activeSlot) {
        Copy-AtomicFile -Source $paths.Auth -Destination $paths[$activeSlot]
    }

    Copy-AtomicFile -Source $paths[$Slot] -Destination $paths.Auth
    Set-ActiveMarker -Paths $paths -Slot $Slot
}

function Get-CodexAccountStatus {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$CodexHome)

    $paths = Get-SwitcherPaths -CodexHome $CodexHome
    $active = 'Unknown'
    if (Test-Path -LiteralPath $paths.Marker -PathType Leaf) {
        $candidate = [System.IO.File]::ReadAllText($paths.Marker).Trim()
        if ($candidate -in @('A','B')) {
            $active = $candidate
        }
    }

    [pscustomobject]@{
        Active = $active
        ARegistered = Test-Path -LiteralPath $paths.A -PathType Leaf
        BRegistered = Test-Path -LiteralPath $paths.B -PathType Leaf
    }
}

Export-ModuleMember -Function @(
    'Register-CodexAccount'
    'Switch-CodexAccount'
    'Get-CodexAccountStatus'
)
