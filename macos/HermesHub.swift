// Hermes Hub.app: a native window around the Command Center (docs/specs/macos-app.md).
// It only shows the page; starting and stopping the Hub stays with `bin/hermes-hub`.
import AppKit
import WebKit

let defaultHubURL = "http://127.0.0.1:4747/"
let hubURLKey = "hubURL"
/// Links on this scheme come from the app's own error page.
let appScheme = "hermes-app"

/// The saved Hub URL, normalised to its origin with a trailing slash.
func savedHubURL() -> URL {
  let raw = UserDefaults.standard.string(forKey: hubURLKey) ?? defaultHubURL
  return parseHubURL(raw) ?? URL(string: defaultHubURL)!
}

/// Accepts `http(s)://host[:port][/]`; anything else is refused so a typo never loads a stranger page.
func parseHubURL(_ raw: String) -> URL? {
  let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  guard let c = URLComponents(string: text), let scheme = c.scheme?.lowercased(), scheme == "http" || scheme == "https",
        let host = c.host, !host.isEmpty else { return nil }
  var out = URLComponents()
  out.scheme = scheme
  out.host = host
  out.port = c.port
  out.path = "/"
  return out.url
}

func sameOrigin(_ a: URL, _ b: URL) -> Bool {
  a.scheme?.lowercased() == b.scheme?.lowercased() && a.host?.lowercased() == b.host?.lowercased()
    && (a.port ?? (a.scheme == "https" ? 443 : 80)) == (b.port ?? (b.scheme == "https" ? 443 : 80))
}

func escapeHTML(_ s: String) -> String {
  s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
    .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  var window: NSWindow!
  var webView: WKWebView!
  var hubURL = savedHubURL()
  var titleObservation: NSKeyValueObservation?
  /// Challenges waiting on the one sign-in sheet: the page and its assets and streams all ask at once.
  var pendingAuth: [(URLSession.AuthChallengeDisposition, URLCredential?) -> Void] = []

  func applicationDidFinishLaunching(_ note: Notification) {
    buildMenu()

    let config = WKWebViewConfiguration()
    config.websiteDataStore = .default() // keeps the page's local storage between launches
    config.preferences.javaScriptCanOpenWindowsAutomatically = true
    // WKWebView defines `Notification`, but this app wires up no permission prompt. Hiding it makes the page report `denied`,
    // so the Hub posts its macOS notification fallback instead (hub-operations spec).
    config.userContentController.addUserScript(WKUserScript(
      source: "Object.defineProperty(window, 'Notification', { value: undefined, configurable: true });",
      injectionTime: .atDocumentStart, forMainFrameOnly: false))
    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    webView.allowsMagnification = true
    if #available(macOS 13.3, *) { webView.isInspectable = true }

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1280, height: 840),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered, defer: false)
    window.title = "Hermes Hub"
    window.minSize = NSSize(width: 720, height: 480)
    window.contentView = webView
    window.delegate = self
    window.center()
    window.setFrameAutosaveName("HermesHubMain")
    window.makeKeyAndOrderFront(nil)
    titleObservation = webView.observe(\.title) { [weak self] view, _ in
      let t = view.title ?? ""
      self?.window.title = t.isEmpty ? "Hermes Hub" : t
    }

    load()
    NSApp.activate(ignoringOtherApps: true)
  }

  // Closing the window quits: with no Command Center open, the Hub posts its own macOS notifications.
  func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

  func load() {
    webView.load(URLRequest(url: hubURL))
  }

  // MARK: Menu

  func buildMenu() {
    let main = NSMenu()

    let appMenu = NSMenu()
    appMenu.addItem(withTitle: "About Hermes Hub", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Hub URL…", action: #selector(changeHubURL), keyEquivalent: ",")
    appMenu.addItem(withTitle: "Forget Saved Password", action: #selector(forgetPassword), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Hide Hermes Hub", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    let others = appMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
    others.keyEquivalentModifierMask = [.command, .option]
    appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "Quit Hermes Hub", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    addSubmenu(main, "Hermes Hub", appMenu)

    // Without an Edit menu, ⌘C/⌘V/⌘A never reach the page's text fields.
    let edit = NSMenu(title: "Edit")
    edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
    edit.addItem(.separator())
    edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    addSubmenu(main, "Edit", edit)

    let view = NSMenu(title: "View")
    view.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
    view.addItem(withTitle: "Back", action: #selector(goBack), keyEquivalent: "[")
    view.addItem(withTitle: "Forward", action: #selector(goForward), keyEquivalent: "]")
    view.addItem(.separator())
    view.addItem(withTitle: "Actual Size", action: #selector(zoomReset), keyEquivalent: "0")
    view.addItem(withTitle: "Zoom In", action: #selector(zoomIn), keyEquivalent: "+")
    view.addItem(withTitle: "Zoom Out", action: #selector(zoomOut), keyEquivalent: "-")
    view.addItem(.separator())
    let open = view.addItem(withTitle: "Open in Browser", action: #selector(openInBrowser), keyEquivalent: "o")
    open.keyEquivalentModifierMask = [.command, .shift]
    let full = view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
    full.keyEquivalentModifierMask = [.command, .control]
    addSubmenu(main, "View", view)

    let win = NSMenu(title: "Window")
    win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    win.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
    win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    addSubmenu(main, "Window", win)
    NSApp.windowsMenu = win

    NSApp.mainMenu = main
  }

  func addSubmenu(_ main: NSMenu, _ title: String, _ sub: NSMenu) {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    item.submenu = sub
    main.addItem(item)
  }

  @objc func reload() {
    if webView.url == nil || webView.url?.scheme == "about" { load() } else { webView.reload() }
  }
  @objc func goBack() { webView.goBack() }
  @objc func goForward() { webView.goForward() }
  @objc func zoomReset() { webView.pageZoom = 1 }
  @objc func zoomIn() { webView.pageZoom = min(webView.pageZoom + 0.1, 3) }
  @objc func zoomOut() { webView.pageZoom = max(webView.pageZoom - 0.1, 0.5) }
  @objc func openInBrowser() {
    let current = webView.url.flatMap { sameOrigin($0, hubURL) ? $0 : nil } ?? hubURL
    NSWorkspace.shared.open(current)
  }

  @objc func changeHubURL() {
    let alert = NSAlert()
    alert.messageText = "Hub URL"
    alert.informativeText = "The Command Center this window shows, for example \(defaultHubURL). A Hub on another Mac asks for its remote username and password (set there with hermes-hub password)."
    let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
    field.stringValue = hubURL.absoluteString
    alert.accessoryView = field
    alert.addButton(withTitle: "Save")
    alert.addButton(withTitle: "Cancel")
    alert.addButton(withTitle: "Use Default")
    alert.window.initialFirstResponder = field
    let answer = alert.runModal()
    let raw: String
    switch answer {
    case .alertFirstButtonReturn: raw = field.stringValue
    case .alertThirdButtonReturn: raw = defaultHubURL
    default: return
    }
    guard let url = parseHubURL(raw) else {
      let bad = NSAlert()
      bad.messageText = "Not a Hub URL"
      bad.informativeText = "Use http://host:port, for example \(defaultHubURL)"
      bad.runModal()
      return
    }
    UserDefaults.standard.set(url.absoluteString, forKey: hubURLKey)
    hubURL = url
    load()
  }

  // MARK: Navigation

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { return decisionHandler(.allow) }
    if url.scheme == appScheme {
      decisionHandler(.cancel)
      if url.host == "settings" { changeHubURL() } else { load() }
      return
    }
    if url.scheme == "about" || url.scheme == "data" || sameOrigin(url, hubURL) {
      return decisionHandler(action.shouldPerformDownload ? .download : .allow)
    }
    // Any other site (a Round's links, docs) opens in the default browser.
    decisionHandler(.cancel)
    NSWorkspace.shared.open(url)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    decisionHandler(response.canShowMIMEType ? .allow : .download)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) {
    showError(error)
  }

  func webView(_ webView: WKWebView, didFail nav: WKNavigation!, withError error: Error) {
    showError(error)
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { load() }

  func showError(_ error: Error) {
    let ns = error as NSError
    if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
    if ns.domain == "WebKitErrorDomain" && ns.code == 102 { return } // a cancelled frame load (a download, an external link)
    let url = escapeHTML(hubURL.absoluteString)
    let html = """
      <!doctype html><html><head><meta charset="utf-8"><title>Hermes Hub</title><style>
      :root { color-scheme: light dark; font: 15px -apple-system, system-ui, sans-serif; }
      body { display: grid; place-items: center; min-height: 90vh; margin: 0; }
      main { max-width: 34rem; padding: 2rem; } h1 { font-size: 1.3rem; margin: 0 0 .5rem; }
      code { font: 13px ui-monospace, monospace; } p { line-height: 1.5; }
      a { display: inline-block; margin: .5rem 1rem 0 0; color: #d9773a; font-weight: 600; }
      </style></head><body><main>
      <h1>Can't reach the Hub</h1>
      <p>No Command Center at <code>\(url)</code>: \(escapeHTML(ns.localizedDescription))</p>
      <p>Start it with <code>"$HERMES_HUB_APP/hermes-hub" start</code>, then retry.</p>
      <a href="\(appScheme)://retry">Retry</a><a href="\(appScheme)://settings">Change Hub URL…</a>
      </main></body></html>
      """
    webView.loadHTMLString(html, baseURL: nil)
  }

  // MARK: Remote sign-in (security spec: Basic auth for any device but the Hub's own Mac)

  /// The Hub's protection space; Basic auth for any other origin goes to WebKit's default handling.
  func hubSpace(_ space: URLProtectionSpace) -> Bool {
    space.authenticationMethod == NSURLAuthenticationMethodHTTPBasic
      && space.host.lowercased() == hubURL.host?.lowercased()
      && space.port == (hubURL.port ?? (hubURL.scheme == "https" ? 443 : 80))
  }

  func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
               completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
    let space = challenge.protectionSpace
    guard hubSpace(space) else { return completionHandler(.performDefaultHandling, nil) }
    let storage = URLCredentialStorage.shared
    // WebKit can report a failure before any password was tried; only a refused password counts.
    let proposed = challenge.proposedCredential
    let failed = challenge.previousFailureCount > 0 && proposed?.hasPassword == true
    let saved = storage.defaultCredential(for: space)
    if !failed, let saved { return completionHandler(.useCredential, saved) }
    // A saved password the Hub refused is stale: drop it so the sheet asks again.
    if failed, let saved, saved.user == proposed?.user, saved.password == proposed?.password {
      storage.remove(saved, for: space)
    }
    pendingAuth.append(completionHandler)
    if pendingAuth.count > 1 { return } // the sheet is already up; this one waits for its answer
    let answer = askForPassword(space: space, failed: failed, user: proposed?.user)
    let waiting = pendingAuth
    pendingAuth = []
    guard let (credential, remember) = answer else {
      waiting.forEach { $0(.cancelAuthenticationChallenge, nil) }
      showSignInCancelled()
      return
    }
    if remember { storage.setDefaultCredential(credential, for: space) }
    waiting.forEach { $0(.useCredential, credential) }
  }

  /// The sign-in sheet: username, password and "Remember in Keychain". Nil when cancelled.
  func askForPassword(space: URLProtectionSpace, failed: Bool, user: String?) -> (URLCredential, Bool)? {
    let alert = NSAlert()
    alert.messageText = failed ? "Wrong username or password" : "Sign in to the Hub"
    alert.informativeText = "\(hubURL.absoluteString) needs its remote username and password (set on that Mac with hermes-hub password)."
    let userField = NSTextField(frame: NSRect(x: 0, y: 56, width: 300, height: 24))
    userField.placeholderString = "Username"
    userField.stringValue = user ?? "hermes"
    let passField = NSSecureTextField(frame: NSRect(x: 0, y: 28, width: 300, height: 24))
    passField.placeholderString = "Password"
    let remember = NSButton(checkboxWithTitle: "Remember in Keychain", target: nil, action: nil)
    remember.frame = NSRect(x: 0, y: 0, width: 300, height: 20)
    remember.state = .on
    let box = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 80))
    [userField, passField, remember].forEach(box.addSubview)
    alert.accessoryView = box
    alert.addButton(withTitle: "Sign In")
    alert.addButton(withTitle: "Cancel")
    alert.window.initialFirstResponder = passField
    guard alert.runModal() == .alertFirstButtonReturn else { return nil }
    let persistence: URLCredential.Persistence = remember.state == .on ? .permanent : .forSession
    return (URLCredential(user: userField.stringValue, password: passField.stringValue, persistence: persistence), remember.state == .on)
  }

  func showSignInCancelled() {
    let url = escapeHTML(hubURL.absoluteString)
    let html = """
      <!doctype html><html><head><meta charset="utf-8"><title>Hermes Hub</title><style>
      :root { color-scheme: light dark; font: 15px -apple-system, system-ui, sans-serif; }
      body { display: grid; place-items: center; min-height: 90vh; margin: 0; }
      main { max-width: 34rem; padding: 2rem; } h1 { font-size: 1.3rem; margin: 0 0 .5rem; }
      code { font: 13px ui-monospace, monospace; } p { line-height: 1.5; }
      a { display: inline-block; margin: .5rem 1rem 0 0; color: #d9773a; font-weight: 600; }
      </style></head><body><main>
      <h1>Not signed in</h1>
      <p>The Hub at <code>\(url)</code> needs its remote username and password. Set them on that Mac with <code>hermes-hub password</code>.</p>
      <a href="\(appScheme)://retry">Sign In</a><a href="\(appScheme)://settings">Change Hub URL…</a>
      </main></body></html>
      """
    webView.loadHTMLString(html, baseURL: nil)
  }

  /// Removes every saved password for the current Hub's host and port, then reloads (which asks again if needed).
  @objc func forgetPassword() {
    let storage = URLCredentialStorage.shared
    for (space, credentials) in storage.allCredentials where hubSpace(space) {
      for credential in credentials.values { storage.remove(credential, for: space) }
    }
    load()
  }

  // MARK: Page UI

  /// `target=_blank` and `window.open`: never a second web view.
  func webView(_ webView: WKWebView, createWebViewWith config: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url {
      if sameOrigin(url, hubURL) { webView.load(action.request) } else { NSWorkspace.shared.open(url) }
    }
    return nil
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.runModal()
    completionHandler()
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: "OK")
    alert.addButton(withTitle: "Cancel")
    completionHandler(alert.runModal() == .alertFirstButtonReturn)
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
  }

  // MARK: Downloads (attachments), saved to ~/Downloads

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    let name = (suggestedFilename as NSString)
    var dest = dir.appendingPathComponent(suggestedFilename)
    var n = 1
    while FileManager.default.fileExists(atPath: dest.path) {
      let ext = name.pathExtension
      let base = name.deletingPathExtension
      dest = dir.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
      n += 1
    }
    completionHandler(dest)
  }

  func downloadDidFinish(_ download: WKDownload) {
    if let url = download.progress.fileURL { NSWorkspace.shared.activateFileViewerSelecting([url]) }
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
