import Cocoa
import ApplicationServices

// MARK: - JSON Output

func output(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: []),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    } else {
        print("{\"error\":\"serialization_failed\"}")
    }
}

// MARK: - AX Attribute Helpers

func getString(_ el: AXUIElement, _ attr: String) -> String {
    var ref: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &ref) == .success else { return "" }
    return (ref as? String) ?? ""
}

func getBool(_ el: AXUIElement, _ attr: String) -> Bool {
    var ref: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, attr as CFString, &ref) == .success else { return false }
    return (ref as? Bool) ?? false
}

/// Returns the element's frame in AX/Quartz coordinates (origin bottom-left of primary screen, Y up).
func getAXFrame(_ el: AXUIElement) -> CGRect {
    var posRef: CFTypeRef?
    var sizeRef: CFTypeRef?
    var pos = CGPoint.zero
    var size = CGSize.zero

    if AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &posRef) == .success,
       let axVal = posRef {
        AXValueGetValue(axVal as! AXValue, .cgPoint, &pos)
    }
    if AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &sizeRef) == .success,
       let axVal = sizeRef {
        AXValueGetValue(axVal as! AXValue, .cgSize, &size)
    }
    return CGRect(origin: pos, size: size)
}

/// Converts from AX Quartz coordinates to screen pixel coordinates (origin top-left, Y down).
/// This matches the coordinate system used by nut.js / Electron screen APIs.
func toScreenCoords(_ axRect: CGRect) -> CGRect {
    let screenH = NSScreen.main?.frame.size.height ?? 1080
    let flippedY = screenH - axRect.origin.y - axRect.size.height
    return CGRect(x: axRect.origin.x, y: flippedY, width: axRect.size.width, height: axRect.size.height)
}

func elementToDict(_ el: AXUIElement) -> [String: Any] {
    let frame = toScreenCoords(getAXFrame(el))
    // Cap value to 200 chars — avoids serialising terminal buffers
    let rawValue = getString(el, kAXValueAttribute as String)
    let shortValue = rawValue.count > 200 ? "" : rawValue
    return [
        "role":        getString(el, kAXRoleAttribute as String),
        "title":       getString(el, kAXTitleAttribute as String),
        "label":       getString(el, kAXLabelValueAttribute as String),
        "description": getString(el, kAXDescriptionAttribute as String),
        "value":       shortValue,
        "enabled":     getBool(el, kAXEnabledAttribute as String),
        "x":           Int(frame.origin.x),
        "y":           Int(frame.origin.y),
        "width":       Int(frame.size.width),
        "height":      Int(frame.size.height),
        "centerX":     Int(frame.origin.x + frame.size.width  / 2),
        "centerY":     Int(frame.origin.y + frame.size.height / 2)
    ]
}

// MARK: - Element Scoring

/// Scores how well an element matches the natural-language query (0.0 – 1.0).
func score(_ el: AXUIElement, query: String) -> Double {
    let q    = query.lowercased().trimmingCharacters(in: .whitespaces)
    let role = getString(el, kAXRoleAttribute as String)
    let title = getString(el, kAXTitleAttribute as String).lowercased()
    let label = getString(el, kAXLabelValueAttribute as String).lowercased()
    let desc  = getString(el, kAXDescriptionAttribute as String).lowercased()
    // Ignore value if it's very long (terminal buffers, text areas with document content)
    let rawValue = getString(el, kAXValueAttribute as String)
    let value = rawValue.count > 200 ? "" : rawValue.lowercased()

    // Skip elements with no searchable text at all
    if title.isEmpty && label.isEmpty && desc.isEmpty && value.isEmpty { return 0 }

    // Skip elements that are too small to interact with
    let frame = getAXFrame(el)
    if frame.size.width < 5 || frame.size.height < 5 { return 0 }

    // Skip off-screen elements (e.g. scrolled-away terminal content)
    let screenH = NSScreen.main?.frame.size.height ?? 1080
    let screenW = NSScreen.main?.frame.size.width  ?? 1920
    let screenY = toScreenCoords(frame).origin.y
    let screenX = toScreenCoords(frame).origin.x
    if screenY < -frame.size.height || screenY > screenH { return 0 }
    if screenX < -frame.size.width  || screenX > screenW { return 0 }

    var s: Double = 0

    // Text matching — ordered by specificity
    let candidates = [title, label, desc, value]
    for text in candidates where !text.isEmpty {
        if text == q              { s += 0.60; break }
        if text.hasPrefix(q)     { s += 0.45; break }
        if text.contains(q)      { s += 0.35; break }
    }
    // Partial word overlap (each shared word adds a little)
    let qWords = q.split(separator: " ").map(String.init)
    for word in qWords where word.count > 2 {
        if candidates.contains(where: { $0.contains(word) }) { s += 0.10 }
    }

    // Role hints from the query string
    let roleLower = role.lowercased()
    if (q.contains("button") || q.contains("btn"))          && roleLower == "axbutton"      { s += 0.15 }
    if (q.contains("textfield") || q.contains("feld") || q.contains("eingabe"))
                                                              && (roleLower == "axtextfield" || roleLower == "axtextarea") { s += 0.15 }
    if q.contains("checkbox")                                && roleLower == "axcheckbox"    { s += 0.15 }
    if q.contains("menu")                                    && roleLower.contains("menu")   { s += 0.15 }

    // Prefer enabled, interactive elements
    if getBool(el, kAXEnabledAttribute as String) { s += 0.05 }
    let interactiveRoles: Set<String> = [
        "AXButton", "AXTextField", "AXTextArea", "AXCheckBox",
        "AXRadioButton", "AXPopUpButton", "AXComboBox",
        "AXMenuItem", "AXLink", "AXSlider", "AXTab"
    ]
    if interactiveRoles.contains(role) { s += 0.10 }

    return min(s, 1.0)
}

// MARK: - Recursive Tree Search

typealias ScoredElement = (element: AXUIElement, score: Double)

func findBest(_ el: AXUIElement, query: String, depth: Int = 0) -> ScoredElement? {
    guard depth < 15 else { return nil }

    let s = score(el, query: query)
    var best: ScoredElement? = s >= 0.20 ? (el, s) : nil

    var childrenRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &childrenRef) == .success,
          let children = childrenRef as? [AXUIElement] else { return best }

    for child in children {
        if let candidate = findBest(child, query: query, depth: depth + 1) {
            if best == nil || candidate.score > best!.score {
                best = candidate
            }
        }
    }
    return best
}

func collectAll(_ el: AXUIElement, depth: Int = 0, into result: inout [[String: Any]]) {
    guard depth < 8 else { return }

    let role  = getString(el, kAXRoleAttribute as String)
    let title = getString(el, kAXTitleAttribute as String)
    let label = getString(el, kAXLabelValueAttribute as String)
    let desc  = getString(el, kAXDescriptionAttribute as String)

    let interactiveRoles: Set<String> = [
        "AXButton", "AXTextField", "AXTextArea", "AXCheckBox",
        "AXRadioButton", "AXPopUpButton", "AXComboBox",
        "AXMenuItem", "AXLink", "AXSlider", "AXTab", "AXStaticText"
    ]
    let hasText = !title.isEmpty || !label.isEmpty || !desc.isEmpty
    let frame   = getAXFrame(el)

    if (hasText || interactiveRoles.contains(role)) && frame.size.width > 5 && frame.size.height > 5 {
        result.append(elementToDict(el))
    }

    var childrenRef: CFTypeRef?
    if AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &childrenRef) == .success,
       let children = childrenRef as? [AXUIElement] {
        for child in children { collectAll(child, depth: depth + 1, into: &result) }
    }
}

// MARK: - Commands

func cmdCheckPermission() {
    output(["granted": AXIsProcessTrustedWithOptions(nil)])
}

func cmdFrontmost() {
    guard let app = NSWorkspace.shared.frontmostApplication else {
        output(["error": "no_frontmost_app"]); return
    }
    output([
        "bundleId": app.bundleIdentifier ?? "",
        "name":     app.localizedName    ?? "",
        "pid":      Int(app.processIdentifier)
    ])
}

func cmdFind(description: String, bundleId: String?) {
    let apps: [NSRunningApplication]
    if let bid = bundleId, !bid.isEmpty {
        apps = NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == bid }
    } else {
        apps = NSWorkspace.shared.frontmostApplication.map { [$0] } ?? []
    }
    guard let app = apps.first else {
        output(["found": false, "error": "app_not_found"]); return
    }

    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    guard let result = findBest(axApp, query: description), result.score >= 0.25 else {
        output(["found": false, "confidence": 0.0]); return
    }

    var dict = elementToDict(result.element)
    dict["found"]      = true
    dict["confidence"] = result.score
    output(dict)
}

func cmdList(bundleId: String?) {
    let bid: String
    if let b = bundleId, !b.isEmpty {
        bid = b
    } else if let frontBid = NSWorkspace.shared.frontmostApplication?.bundleIdentifier {
        bid = frontBid
    } else {
        output(["error": "no_bundle_id", "elements": []]); return
    }

    let apps = NSWorkspace.shared.runningApplications.filter { $0.bundleIdentifier == bid }
    guard let app = apps.first else {
        output(["error": "app_not_found", "elements": []]); return
    }

    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    var windowsRef: CFTypeRef?
    guard AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &windowsRef) == .success,
          let windows = windowsRef as? [AXUIElement], !windows.isEmpty else {
        output(["elements": [], "count": 0]); return
    }

    var elements: [[String: Any]] = []
    for window in windows { collectAll(window, into: &elements) }
    output(["elements": elements, "count": elements.count])
}

func cmdFocused() {
    let systemEl = AXUIElementCreateSystemWide()
    var focusedRef: CFTypeRef?

    guard AXUIElementCopyAttributeValue(systemEl, kAXFocusedUIElementAttribute as CFString, &focusedRef) == .success,
          let focusedEl = focusedRef else {
        output(["found": false]); return
    }

    var dict = elementToDict(focusedEl as! AXUIElement)
    dict["found"] = true
    output(dict)
}

func cmdAt(x: Double, y: Double) {
    // Convert from top-left (nut.js) back to Quartz for the AX query
    let screenH = NSScreen.main?.frame.size.height ?? 1080
    let axY = screenH - y

    var element: AXUIElement?
    let systemEl = AXUIElementCreateSystemWide()
    let result = AXUIElementCopyElementAtPosition(systemEl, Float(x), Float(axY), &element)

    guard result == .success, let el = element else {
        output(["found": false]); return
    }

    var dict = elementToDict(el)
    dict["found"] = true
    output(dict)
}

// MARK: - CLI Entry Point

let args = CommandLine.arguments
guard args.count >= 2 else {
    output(["error": "usage: ax-helper <check-permission|frontmost|find|list|at> [options]"])
    exit(1)
}

func parseArgs(_ startIndex: Int) -> [String: String] {
    var result: [String: String] = [:]
    var i = startIndex
    while i < args.count {
        let key = args[i]
        if key.hasPrefix("--"), i + 1 < args.count {
            result[String(key.dropFirst(2))] = args[i + 1]
            i += 2
        } else if !key.hasPrefix("-") && result["description"] == nil {
            result["description"] = key  // positional first arg = description
            i += 1
        } else {
            i += 1
        }
    }
    return result
}

switch args[1] {

case "check-permission":
    cmdCheckPermission()

case "frontmost":
    cmdFrontmost()

case "find":
    let opts = parseArgs(2)
    let desc = opts["description"] ?? opts["d"] ?? ""
    let bid  = opts["bundle"]      ?? opts["b"]
    if desc.isEmpty {
        output(["error": "find requires --description <text>"]); exit(1)
    }
    cmdFind(description: desc, bundleId: bid)

case "list":
    let opts = parseArgs(2)
    cmdList(bundleId: opts["bundle"] ?? opts["b"])

case "focused":
    cmdFocused()

case "at":
    let opts = parseArgs(2)
    let x = Double(opts["x"] ?? "0") ?? 0
    let y = Double(opts["y"] ?? "0") ?? 0
    cmdAt(x: x, y: y)

default:
    output(["error": "unknown command: \(args[1])"])
    exit(1)
}
