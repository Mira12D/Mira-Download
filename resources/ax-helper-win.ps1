#Requires -Version 5.1
<#
  ax-helper-win.ps1  —  Windows UI Automation helper (PowerShell edition)
  Identical interface to ax-helper-win.exe — no .NET SDK or compilation required.
  PowerShell 5.1 is built into every Windows 10 / 11 machine.

  Usage:
    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ax-helper-win.ps1 <cmd> [args]

  Commands:
    check-permission
    frontmost
    focused
    find <desc> [--bundle <procname>]
    list [--bundle <procname>]
    at --x <N> --y <N>
#>

$cmd  = if ($args.Count -gt 0) { $args[0] } else { '' }
$rest = if ($args.Count -gt 1) { $args[1..($args.Count - 1)] } else { @() }

# ── UIAutomation assemblies ───────────────────────────────────────────────────
Add-Type -AssemblyName UIAutomationClient  -ErrorAction Stop
Add-Type -AssemblyName UIAutomationTypes   -ErrorAction Stop

# ── Win32 P/Invoke ────────────────────────────────────────────────────────────
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win32Ax {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = false)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxLength);
}
'@

# ── Role mapping (mirrors C# binary) ─────────────────────────────────────────
function Get-AxRole([System.Windows.Automation.ControlType]$ct) {
    if ($ct -eq [System.Windows.Automation.ControlType]::Button)      { return 'AXButton' }
    if ($ct -eq [System.Windows.Automation.ControlType]::Edit)        { return 'AXTextField' }
    if ($ct -eq [System.Windows.Automation.ControlType]::Document)    { return 'AXTextArea' }
    if ($ct -eq [System.Windows.Automation.ControlType]::CheckBox)    { return 'AXCheckBox' }
    if ($ct -eq [System.Windows.Automation.ControlType]::RadioButton) { return 'AXRadioButton' }
    if ($ct -eq [System.Windows.Automation.ControlType]::ComboBox)    { return 'AXComboBox' }
    if ($ct -eq [System.Windows.Automation.ControlType]::MenuItem)    { return 'AXMenuItem' }
    if ($ct -eq [System.Windows.Automation.ControlType]::MenuBar)     { return 'AXMenuBar' }
    if ($ct -eq [System.Windows.Automation.ControlType]::Menu)        { return 'AXMenu' }
    if ($ct -eq [System.Windows.Automation.ControlType]::Hyperlink)   { return 'AXLink' }
    if ($ct -eq [System.Windows.Automation.ControlType]::Slider)      { return 'AXSlider' }
    if ($ct -eq [System.Windows.Automation.ControlType]::Tab)         { return 'AXTabGroup' }
    if ($ct -eq [System.Windows.Automation.ControlType]::TabItem)     { return 'AXTab' }
    if ($ct -eq [System.Windows.Automation.ControlType]::Text)        { return 'AXStaticText' }
    if ($ct -eq [System.Windows.Automation.ControlType]::ListItem)    { return 'AXStaticText' }
    if ($ct -eq [System.Windows.Automation.ControlType]::Image)       { return 'AXImage' }
    if ($ct -eq [System.Windows.Automation.ControlType]::Window)      { return 'AXWindow' }
    if ($ct -eq [System.Windows.Automation.ControlType]::Pane)        { return 'AXGroup' }
    if ($ct -eq [System.Windows.Automation.ControlType]::Group)       { return 'AXGroup' }
    if ($ct -eq [System.Windows.Automation.ControlType]::ToolBar)     { return 'AXToolbar' }
    if ($ct -eq [System.Windows.Automation.ControlType]::StatusBar)   { return 'AXGroup' }
    if ($ct -eq [System.Windows.Automation.ControlType]::List)        { return 'AXList' }
    if ($ct -eq [System.Windows.Automation.ControlType]::Tree)        { return 'AXOutline' }
    if ($ct -eq [System.Windows.Automation.ControlType]::TreeItem)    { return 'AXRow' }
    return 'AX' + $ct.ProgrammaticName.Replace('ControlType.', '')
}

# ── Element value (ValuePattern) ──────────────────────────────────────────────
function Get-ElemValue([System.Windows.Automation.AutomationElement]$el) {
    try {
        $vp = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
            $v = $vp.Current.Value
            if ($v -ne $null -and $v.Length -le 200) { return $v }
        }
    } catch {}
    return ''
}

# ── Element → ordered dict ────────────────────────────────────────────────────
function To-ElemDict([System.Windows.Automation.AutomationElement]$el) {
    $rect = $el.Current.BoundingRectangle
    $name = if ($el.Current.Name)     { $el.Current.Name }     else { '' }
    $help = if ($el.Current.HelpText) { $el.Current.HelpText } else { '' }
    $val  = Get-ElemValue $el

    $x = if ([double]::IsInfinity($rect.Left)   -or [double]::IsNaN($rect.Left))   { 0 } else { [int]$rect.Left }
    $y = if ([double]::IsInfinity($rect.Top)    -or [double]::IsNaN($rect.Top))    { 0 } else { [int]$rect.Top }
    $w = if ([double]::IsInfinity($rect.Width)  -or [double]::IsNaN($rect.Width))  { 0 } else { [int]$rect.Width }
    $h = if ([double]::IsInfinity($rect.Height) -or [double]::IsNaN($rect.Height)) { 0 } else { [int]$rect.Height }

    return [ordered]@{
        role        = Get-AxRole $el.Current.ControlType
        title       = $name
        label       = ''
        description = $help
        value       = $val
        enabled     = [bool]$el.Current.IsEnabled
        x           = $x
        y           = $y
        width       = $w
        height      = $h
        centerX     = $x + [int]($w / 2)
        centerY     = $y + [int]($h / 2)
    }
}

# ── Interactive control types ─────────────────────────────────────────────────
$INTERACTIVE = @(
    [System.Windows.Automation.ControlType]::Button,
    [System.Windows.Automation.ControlType]::Edit,
    [System.Windows.Automation.ControlType]::Document,
    [System.Windows.Automation.ControlType]::CheckBox,
    [System.Windows.Automation.ControlType]::RadioButton,
    [System.Windows.Automation.ControlType]::ComboBox,
    [System.Windows.Automation.ControlType]::MenuItem,
    [System.Windows.Automation.ControlType]::Hyperlink,
    [System.Windows.Automation.ControlType]::Text,
    [System.Windows.Automation.ControlType]::ListItem
)

# ── Scoring (mirrors C# binary) ───────────────────────────────────────────────
function Get-Score([System.Windows.Automation.AutomationElement]$el, [string]$query) {
    $rect = $el.Current.BoundingRectangle
    if ([double]::IsInfinity($rect.Left) -or [double]::IsNaN($rect.Left)) { return 0.0 }
    if ($rect.Width -lt 5 -or $rect.Height -lt 5)                         { return 0.0 }
    if ($rect.Top -lt -50 -or $rect.Top -gt 12000)                        { return 0.0 }

    $name = if ($el.Current.Name)     { $el.Current.Name.ToLower() }     else { '' }
    $help = if ($el.Current.HelpText) { $el.Current.HelpText.ToLower() } else { '' }
    $val  = (Get-ElemValue $el).ToLower()
    if ($name.Length -eq 0 -and $help.Length -eq 0) { return 0.0 }

    $s = 0.0; $matched = $false
    foreach ($text in @($name, $help, $val)) {
        if ($text.Length -eq 0 -or $matched) { continue }
        if ($text -eq $query)             { $s += 0.60; $matched = $true }
        elseif ($text.StartsWith($query)) { $s += 0.45; $matched = $true }
        elseif ($text.Contains($query))   { $s += 0.35; $matched = $true }
    }
    foreach ($word in ($query -split ' ' | Where-Object { $_.Length -gt 2 })) {
        if ($name.Contains($word) -or $help.Contains($word) -or $val.Contains($word)) { $s += 0.08 }
    }
    if ($INTERACTIVE -contains $el.Current.ControlType) { $s += 0.08 }
    if ($el.Current.IsEnabled)                          { $s += 0.04 }
    return [Math]::Min($s, 1.0)
}

# ── Find-Best (recursive DFS) ─────────────────────────────────────────────────
$script:bestEl    = $null
$script:bestScore = 0.0

function Find-Best([System.Windows.Automation.AutomationElement]$root, [string]$query, [int]$depth = 0) {
    if ($depth -gt 12) { return }
    $s = Get-Score $root $query
    if ($s -ge 0.20 -and $s -gt $script:bestScore) { $script:bestEl = $root; $script:bestScore = $s }
    try {
        foreach ($child in $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
            Find-Best $child $query ($depth + 1)
        }
    } catch {}
}

# ── Collect-All (recursive) ───────────────────────────────────────────────────
$script:collected = [System.Collections.Generic.List[object]]::new()

function Collect-All([System.Windows.Automation.AutomationElement]$el, [int]$depth = 0) {
    if ($depth -gt 7) { return }
    $rect        = $el.Current.BoundingRectangle
    $visible     = -not ([double]::IsInfinity($rect.Left) -or [double]::IsNaN($rect.Left)) -and $rect.Width -gt 5 -and $rect.Height -gt 5 -and $rect.Top -gt -10
    $name        = if ($el.Current.Name) { $el.Current.Name } else { '' }
    $help        = if ($el.Current.HelpText) { $el.Current.HelpText } else { '' }
    $hasText     = $name.Length -gt 0 -or $help.Length -gt 0
    $interactive = $INTERACTIVE -contains $el.Current.ControlType
    if (($hasText -or $interactive) -and $visible) { $script:collected.Add((To-ElemDict $el)) }
    try {
        foreach ($child in $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) {
            Collect-All $child ($depth + 1)
        }
    } catch {}
}

# ── Get-Root ──────────────────────────────────────────────────────────────────
function Get-Root([string]$processName = '') {
    if ($processName -ne '') {
        $procs = [System.Diagnostics.Process]::GetProcessesByName($processName)
        if ($procs.Count -gt 0) {
            try { return [System.Windows.Automation.AutomationElement]::FromHandle($procs[0].MainWindowHandle) } catch {}
        }
        $cond  = [System.Windows.Automation.PropertyCondition]::new(
            [System.Windows.Automation.AutomationElement]::NameProperty, $processName,
            [System.Windows.Automation.PropertyConditionFlags]::IgnoreCase)
        $found = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Children, $cond)
        if ($found) { return $found }
        return $null
    }
    $hwnd = [Win32Ax]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) { return $null }
    try { return [System.Windows.Automation.AutomationElement]::FromHandle($hwnd) } catch { return $null }
}

# ── Compact JSON output ───────────────────────────────────────────────────────
function Out-J($obj) { $obj | ConvertTo-Json -Compress -Depth 5 }

# ── Arg parser (--key value pairs) ───────────────────────────────────────────
function Parse-KV([string[]]$arr) {
    $r = @{}; $i = 0
    while ($i -lt $arr.Count) {
        if ($arr[$i] -like '--*' -and ($i + 1) -lt $arr.Count) {
            $r[$arr[$i].Substring(2)] = $arr[$i + 1]; $i += 2
        } elseif (-not $arr[$i].StartsWith('-') -and -not $r.ContainsKey('description')) {
            $r['description'] = $arr[$i]; $i++
        } else { $i++ }
    }
    return $r
}

# ── Main dispatch ─────────────────────────────────────────────────────────────
try {
    switch ($cmd) {

        'check-permission' {
            Out-J @{ granted = $true }
        }

        'frontmost' {
            $hwnd = [Win32Ax]::GetForegroundWindow()
            if ($hwnd -eq [IntPtr]::Zero) { Out-J @{ error = 'no_foreground_window' }; exit }
            $pidOut = [uint32]0
            [Win32Ax]::GetWindowThreadProcessId($hwnd, [ref]$pidOut) | Out-Null
            $sb = [System.Text.StringBuilder]::new(512)
            [Win32Ax]::GetWindowText($hwnd, $sb, $sb.Capacity) | Out-Null
            $title    = $sb.ToString()
            $procName = 'unknown'
            try { $procName = [System.Diagnostics.Process]::GetProcessById([int]$pidOut).ProcessName } catch {}
            Out-J @{
                bundleId = $procName
                name     = if ($title.Length -gt 0) { $title } else { $procName }
                pid      = [int]$pidOut
            }
        }

        'focused' {
            try {
                $el = [System.Windows.Automation.AutomationElement]::FocusedElement
                if ($el -eq $null) { Out-J @{ found = $false }; exit }
                $d = To-ElemDict $el; $d['found'] = $true; Out-J $d
            } catch { Out-J @{ found = $false } }
        }

        'find' {
            $opts = Parse-KV $rest
            $desc = if ($opts.ContainsKey('description')) { $opts['description'].Trim() } else { '' }
            $bund = if ($opts.ContainsKey('bundle'))      { $opts['bundle'] }             else { '' }
            if ($desc -eq '') { Out-J @{ found = $false; error = 'find requires description' }; exit }
            $root = Get-Root $bund
            if ($root -eq $null) { Out-J @{ found = $false; error = 'target_not_found' }; exit }
            $script:bestEl = $null; $script:bestScore = 0.0
            Find-Best $root $desc.ToLower()
            if ($script:bestEl -eq $null -or $script:bestScore -lt 0.25) {
                Out-J @{ found = $false; confidence = $script:bestScore }; exit
            }
            $d = To-ElemDict $script:bestEl; $d['found'] = $true; $d['confidence'] = $script:bestScore
            Out-J $d
        }

        'list' {
            $opts = Parse-KV $rest
            $bund = if ($opts.ContainsKey('bundle')) { $opts['bundle'] } else { '' }
            $root = Get-Root $bund
            if ($root -eq $null) { Out-J @{ elements = @(); count = 0 }; exit }
            $script:collected = [System.Collections.Generic.List[object]]::new()
            Collect-All $root
            Out-J @{ elements = $script:collected.ToArray(); count = $script:collected.Count }
        }

        'at' {
            $opts = Parse-KV $rest
            if (-not $opts.ContainsKey('x') -or -not $opts.ContainsKey('y')) {
                Out-J @{ found = $false; error = 'at requires --x and --y' }; exit
            }
            $px = [double]$opts['x']; $py = [double]$opts['y']
            try {
                $el = [System.Windows.Automation.AutomationElement]::FromPoint([System.Windows.Point]::new($px, $py))
                if ($el -eq $null) { Out-J @{ found = $false }; exit }
                $d = To-ElemDict $el; $d['found'] = $true; Out-J $d
            } catch { Out-J @{ found = $false } }
        }

        default {
            Out-J @{ error = "unknown command: $cmd" }
            exit 1
        }
    }
} catch {
    Out-J @{ error = $_.Exception.Message }
    exit 1
}
