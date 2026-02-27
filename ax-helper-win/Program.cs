/**
 * ax-helper-win — Windows UI Automation CLI
 *
 * Wraps the Windows UI Automation API (System.Windows.Automation) and exposes
 * the same commands + JSON output as ax-helper (macOS AXUIElement).
 *
 * Commands:
 *   check-permission              → { "granted": true }   (always true on Windows)
 *   frontmost                     → { "bundleId", "name", "pid" }
 *   focused                       → element dict or { "found": false }
 *   find <desc> [--bundle <name>] → element dict with "found", "confidence"
 *   list [--bundle <name>]        → { "elements": [...], "count": N }
 *   at --x <N> --y <N>            → element dict or { "found": false }
 *
 * Coordinate system: top-left origin, Y increases downward.
 * This matches nut.js and Windows screen coordinates — no flipping needed.
 *
 * Build (on Windows, requires .NET 8 SDK):
 *   dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -o ../resources
 */

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Automation;

// ── Win32 interop ──────────────────────────────────────────────────────────────
static partial class Win32
{
    [DllImport("user32.dll")]
    internal static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    internal static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = false)]
    internal static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxLength);
}

// ── Interactive control types (role bonus in scoring) ─────────────────────────
static class Roles
{
    internal static readonly HashSet<ControlType> Interactive = new()
    {
        ControlType.Button, ControlType.Edit, ControlType.Document,
        ControlType.CheckBox, ControlType.RadioButton, ControlType.ComboBox,
        ControlType.MenuItem, ControlType.Hyperlink, ControlType.Slider,
        ControlType.Tab, ControlType.TabItem, ControlType.ListItem,
        ControlType.Text,
    };

    /// <summary>
    /// Maps Windows ControlType to an AX-style role string (matching Mac output).
    /// </summary>
    internal static string ToAxRole(ControlType ct)
    {
        if (ct == ControlType.Button)      return "AXButton";
        if (ct == ControlType.Edit)        return "AXTextField";
        if (ct == ControlType.Document)    return "AXTextArea";
        if (ct == ControlType.CheckBox)    return "AXCheckBox";
        if (ct == ControlType.RadioButton) return "AXRadioButton";
        if (ct == ControlType.ComboBox)    return "AXComboBox";
        if (ct == ControlType.MenuItem)    return "AXMenuItem";
        if (ct == ControlType.MenuBar)     return "AXMenuBar";
        if (ct == ControlType.Menu)        return "AXMenu";
        if (ct == ControlType.Hyperlink)   return "AXLink";
        if (ct == ControlType.Slider)      return "AXSlider";
        if (ct == ControlType.Tab)         return "AXTabGroup";
        if (ct == ControlType.TabItem)     return "AXTab";
        if (ct == ControlType.Text)        return "AXStaticText";
        if (ct == ControlType.ListItem)    return "AXStaticText";
        if (ct == ControlType.Image)       return "AXImage";
        if (ct == ControlType.Window)      return "AXWindow";
        if (ct == ControlType.Pane)        return "AXGroup";
        if (ct == ControlType.Group)       return "AXGroup";
        if (ct == ControlType.ToolBar)     return "AXToolbar";
        if (ct == ControlType.StatusBar)   return "AXGroup";
        if (ct == ControlType.List)        return "AXList";
        if (ct == ControlType.Tree)        return "AXOutline";
        if (ct == ControlType.TreeItem)    return "AXRow";
        // Fallback: strip "ControlType." prefix
        return "AX" + ct.ProgrammaticName.Replace("ControlType.", "");
    }
}

// ── JSON helpers ──────────────────────────────────────────────────────────────
static class Json
{
    private static readonly JsonSerializerOptions Opts = new() { WriteIndented = false };

    internal static void Output(object obj) =>
        Console.WriteLine(JsonSerializer.Serialize(obj, Opts));

    internal static void OutputDict(Dictionary<string, object?> dict) =>
        Console.WriteLine(JsonSerializer.Serialize(dict, Opts));
}

// ── Argument parser ───────────────────────────────────────────────────────────
static class Args
{
    /// <summary>
    /// Parses --key value pairs. First positional arg (no --) → "description".
    /// </summary>
    internal static Dictionary<string, string> Parse(string[] args, int startIndex)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        int i = startIndex;
        while (i < args.Length)
        {
            if (args[i].StartsWith("--") && i + 1 < args.Length)
            {
                result[args[i][2..]] = args[i + 1];
                i += 2;
            }
            else if (!args[i].StartsWith('-') && !result.ContainsKey("description"))
            {
                result["description"] = args[i];
                i++;
            }
            else i++;
        }
        return result;
    }
}

// ── Element helpers ───────────────────────────────────────────────────────────
static class Elements
{
    /// <summary>
    /// Get the string value of an element if it supports ValuePattern and it's short.
    /// Ignores long values (document content, terminal buffers).
    /// </summary>
    internal static string GetValue(AutomationElement el)
    {
        try
        {
            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out object? pat))
            {
                string v = ((ValuePattern)pat).Current.Value ?? "";
                return v.Length <= 200 ? v : "";
            }
        }
        catch { }
        return "";
    }

    /// <summary>Convert an AutomationElement to the standard JSON dictionary.</summary>
    internal static Dictionary<string, object?> ToDict(AutomationElement el)
    {
        var rect   = el.Current.BoundingRectangle;
        var ct     = el.Current.ControlType;
        string name  = el.Current.Name    ?? "";
        string help  = el.Current.HelpText ?? "";
        string value = GetValue(el);

        // Guard against infinite/NaN rects (hidden or virtual elements)
        int x = double.IsInfinity(rect.Left)   || double.IsNaN(rect.Left)   ? 0 : (int)rect.Left;
        int y = double.IsInfinity(rect.Top)    || double.IsNaN(rect.Top)    ? 0 : (int)rect.Top;
        int w = double.IsInfinity(rect.Width)  || double.IsNaN(rect.Width)  ? 0 : (int)rect.Width;
        int h = double.IsInfinity(rect.Height) || double.IsNaN(rect.Height) ? 0 : (int)rect.Height;

        return new Dictionary<string, object?>
        {
            ["role"]        = Roles.ToAxRole(ct),
            ["title"]       = name,
            ["label"]       = "",           // Windows has no separate label concept
            ["description"] = help,
            ["value"]       = value,
            ["enabled"]     = el.Current.IsEnabled,
            ["x"]           = x,
            ["y"]           = y,
            ["width"]       = w,
            ["height"]      = h,
            ["centerX"]     = x + w / 2,
            ["centerY"]     = y + h / 2,
        };
    }

    /// <summary>
    /// Score how well an element matches a natural-language query (0.0–1.0).
    /// Mirrors the scoring logic in ax-helper.swift and context-manager.js.
    /// </summary>
    internal static double Score(AutomationElement el, string query)
    {
        var rect = el.Current.BoundingRectangle;

        // Skip elements with no usable geometry
        if (double.IsInfinity(rect.Left) || double.IsNaN(rect.Left)) return 0;
        if (rect.Width < 5 || rect.Height < 5) return 0;

        // Skip off-screen elements (scrolled content, virtual rows)
        if (rect.Top < -50 || rect.Top > 12000) return 0;

        string name  = (el.Current.Name    ?? "").ToLowerInvariant();
        string help  = (el.Current.HelpText ?? "").ToLowerInvariant();
        string value = GetValue(el).ToLowerInvariant();

        if (name.Length == 0 && help.Length == 0) return 0;

        double s = 0;
        foreach (string text in new[] { name, help, value })
        {
            if (text.Length == 0) continue;
            if (text == query)              { s += 0.60; break; }
            if (text.StartsWith(query))     { s += 0.45; break; }
            if (text.Contains(query))       { s += 0.35; break; }
        }

        // Partial word overlap
        foreach (var word in query.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (word.Length > 2)
            {
                if (name.Contains(word) || help.Contains(word) || value.Contains(word))
                    s += 0.08;
            }
        }

        if (Roles.Interactive.Contains(el.Current.ControlType)) s += 0.08;
        if (el.Current.IsEnabled)                               s += 0.04;

        return Math.Min(s, 1.0);
    }

    /// <summary>Recursive best-match search through the element tree.</summary>
    internal static (AutomationElement? el, double score) FindBest(
        AutomationElement root, string query, int depth = 0)
    {
        if (depth > 12) return (null, 0);

        double s = Score(root, query);
        AutomationElement? best      = s >= 0.20 ? root : null;
        double             bestScore = s;

        AutomationElementCollection? children = null;
        try { children = root.FindAll(TreeScope.Children, Condition.TrueCondition); }
        catch { }

        if (children != null)
        {
            foreach (AutomationElement child in children)
            {
                var (cEl, cScore) = FindBest(child, query, depth + 1);
                if (cEl != null && cScore > bestScore)
                {
                    best      = cEl;
                    bestScore = cScore;
                }
            }
        }

        return (best, bestScore);
    }

    /// <summary>Recursively collect all visible, labelled or interactive elements.</summary>
    internal static void CollectAll(
        AutomationElement el,
        List<Dictionary<string, object?>> result,
        int depth = 0)
    {
        if (depth > 7) return;

        var ct    = el.Current.ControlType;
        var rect  = el.Current.BoundingRectangle;
        string name = el.Current.Name ?? "";
        string help = el.Current.HelpText ?? "";

        bool hasText    = name.Length > 0 || help.Length > 0;
        bool interactive = Roles.Interactive.Contains(ct);
        bool visible     = !double.IsInfinity(rect.Left)
                          && !double.IsNaN(rect.Left)
                          && rect.Width > 5 && rect.Height > 5
                          && rect.Top > -10;

        if ((hasText || interactive) && visible)
            result.Add(ToDict(el));

        AutomationElementCollection? children = null;
        try { children = el.FindAll(TreeScope.Children, Condition.TrueCondition); }
        catch { }

        if (children != null)
            foreach (AutomationElement child in children)
                CollectAll(child, result, depth + 1);
    }

    /// <summary>
    /// Resolve the root AutomationElement for a target process name (bundleId on Windows).
    /// Falls back to the foreground window if no target given.
    /// </summary>
    internal static AutomationElement? GetRoot(string? processName)
    {
        if (!string.IsNullOrEmpty(processName))
        {
            // 1. Try exact process name match
            var procs = Process.GetProcessesByName(processName);
            if (procs.Length > 0)
            {
                try { return AutomationElement.FromHandle(procs[0].MainWindowHandle); }
                catch { }
            }

            // 2. Fallback: search by window title (case-insensitive)
            var cond = new PropertyCondition(
                AutomationElement.NameProperty, processName,
                PropertyConditionFlags.IgnoreCase);
            var found = AutomationElement.RootElement.FindFirst(TreeScope.Children, cond);
            if (found != null) return found;

            return null;
        }

        // Default: foreground window
        var hwnd = Win32.GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return null;
        try { return AutomationElement.FromHandle(hwnd); }
        catch { return null; }
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────
static class Commands
{
    internal static void CheckPermission()
    {
        // Windows UI Automation does not require explicit user permission.
        // It is always available to any process.
        Json.Output(new { granted = true });
    }

    internal static void Frontmost()
    {
        var hwnd = Win32.GetForegroundWindow();
        if (hwnd == IntPtr.Zero)
        {
            Json.Output(new { error = "no_foreground_window" });
            return;
        }

        Win32.GetWindowThreadProcessId(hwnd, out uint pid);

        // Get window title via Win32 (faster than UIA for just the title)
        var sb = new StringBuilder(512);
        Win32.GetWindowText(hwnd, sb, sb.Capacity);
        string winTitle = sb.ToString();

        // Get process name for bundleId equivalent
        string procName = "unknown";
        try
        {
            var proc = Process.GetProcessById((int)pid);
            procName = proc.ProcessName;
        }
        catch { }

        Json.Output(new
        {
            // bundleId = process name on Windows (e.g. "WINWORD", "chrome", "EXCEL")
            bundleId = procName,
            name     = winTitle.Length > 0 ? winTitle : procName,
            pid      = (int)pid,
        });
    }

    internal static void Focused()
    {
        try
        {
            var el = AutomationElement.FocusedElement;
            if (el == null) { Json.Output(new { found = false }); return; }

            var dict = Elements.ToDict(el);
            dict["found"] = true;
            Json.OutputDict(dict);
        }
        catch { Json.Output(new { found = false }); }
    }

    internal static void Find(string[] args)
    {
        var opts = Args.Parse(args, 1);
        string desc = opts.TryGetValue("description", out var d) ? d.Trim() : "";
        string? proc = opts.TryGetValue("bundle", out var b) ? b : null;

        if (desc.Length == 0)
        {
            Json.Output(new { found = false, error = "find requires --description <text>" });
            return;
        }

        var root = Elements.GetRoot(proc);
        if (root == null)
        {
            Json.Output(new { found = false, error = "target_not_found" });
            return;
        }

        var (best, bestScore) = Elements.FindBest(root, desc.ToLowerInvariant());

        if (best == null || bestScore < 0.25)
        {
            Json.Output(new { found = false, confidence = bestScore });
            return;
        }

        var result = Elements.ToDict(best);
        result["found"]      = true;
        result["confidence"] = bestScore;
        Json.OutputDict(result);
    }

    internal static void List(string[] args)
    {
        var opts = Args.Parse(args, 1);
        string? proc = opts.TryGetValue("bundle", out var b) ? b : null;

        var root = Elements.GetRoot(proc);
        if (root == null)
        {
            Json.Output(new { elements = Array.Empty<object>(), count = 0 });
            return;
        }

        var elements = new List<Dictionary<string, object?>>();
        Elements.CollectAll(root, elements);
        Json.Output(new { elements, count = elements.Count });
    }

    internal static void At(string[] args)
    {
        var opts = Args.Parse(args, 1);
        if (!opts.TryGetValue("x", out var xs) || !double.TryParse(xs, out double x) ||
            !opts.TryGetValue("y", out var ys) || !double.TryParse(ys, out double y))
        {
            Json.Output(new { found = false, error = "at requires --x and --y" });
            return;
        }

        try
        {
            var el = AutomationElement.FromPoint(new System.Windows.Point(x, y));
            if (el == null) { Json.Output(new { found = false }); return; }

            var dict = Elements.ToDict(el);
            dict["found"] = true;
            Json.OutputDict(dict);
        }
        catch { Json.Output(new { found = false }); }
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────
if (args.Length < 1)
{
    Json.Output(new { error = "usage: ax-helper-win <check-permission|frontmost|focused|find|list|at>" });
    Environment.Exit(1);
}

try
{
    switch (args[0])
    {
        case "check-permission": Commands.CheckPermission(); break;
        case "frontmost":        Commands.Frontmost();       break;
        case "focused":          Commands.Focused();         break;
        case "find":             Commands.Find(args);        break;
        case "list":             Commands.List(args);        break;
        case "at":               Commands.At(args);          break;
        default:
            Json.Output(new { error = $"unknown command: {args[0]}" });
            Environment.Exit(1);
            break;
    }
}
catch (Exception e)
{
    Json.Output(new { error = e.Message });
    Environment.Exit(1);
}
