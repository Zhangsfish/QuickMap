import { execFile } from 'node:child_process';

// UI Automation reads the selection without sending Ctrl+C or touching the
// clipboard. Keep the script embedded so the bundled desktop build needs no
// additional runtime files.
const selectionScript = String.raw`
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $element = [System.Windows.Automation.AutomationElement]::FocusedElement
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  for ($depth = 0; $depth -lt 8 -and $null -ne $element; $depth++) {
    if ($element.Current.IsPassword) { exit 0 }
    $pattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
      $parts = @()
      foreach ($range in $pattern.GetSelection()) {
        $text = $range.GetText(4096)
        if (-not [string]::IsNullOrWhiteSpace($text)) { $parts += $text }
      }
      $selected = ($parts -join [Environment]::NewLine).Trim()
      if ($selected.Length -gt 4096) { $selected = $selected.Substring(0, 4096) }
      if ($selected.Length -gt 0) {
        [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($selected)))
        exit 0
      }
    }
    $element = $walker.GetParent($element)
  }
} catch {
  # Applications can disappear, deny access, or omit UI Automation support.
  exit 0
}
`;

let pendingSelection: Promise<string | null> | undefined;

/** Read the foreground app's selection before showing or focusing our window. */
export function readSelectedText(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  if (pendingSelection) return pendingSelection;

  const encodedScript = Buffer.from(selectionScript, 'utf16le').toString('base64');
  pendingSelection = new Promise<string | null>((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encodedScript],
      { windowsHide: true, timeout: 2500, maxBuffer: 64 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error) return resolve(null);
        const encodedText = stdout.trim();
        if (!encodedText || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedText)) return resolve(null);
        const selected = Buffer.from(encodedText, 'base64').toString('utf8').trim();
        resolve(selected ? selected.slice(0, 4096) : null);
      },
    );
  }).finally(() => {
    pendingSelection = undefined;
  });

  return pendingSelection;
}
