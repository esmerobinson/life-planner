// Esmeworld: a thin AppKit + WKWebView shell around the bundled web app (hub/dist).
//
// The web app is served from Contents/Resources/web through a custom URL scheme,
// esmeworld://app/. That origin is where WKWebView keeps the app's IndexedDB, so it
// must NEVER change: a different scheme or host would show an empty app (the data
// would still be on disk, under the old origin). See mac/README.md.
//
// Native chrome is system default only: standard window, standard menus, no colours.

import AppKit
import WebKit

// MARK: - Constants

let kScheme = "esmeworld"
let kHost = "app"
let kStartURL = URL(string: "esmeworld://app/")!
let kAppName = "Esmeworld"

let env = ProcessInfo.processInfo.environment
let isSelfTest = env["ESMEWORLD_SELFTEST"] == "1"
/// Self-test only: delete the throwaway `esmeworld-selftest` database first so a
/// fresh pair of runs always reads 1 then 2. Never touches the app's own data.
let isSelfTestReset = env["ESMEWORLD_SELFTEST_RESET"] == "1"
/// Web Inspector: `ESMEWORLD_DEBUG=1` or `defaults write world.esme.esmeworld EsmeworldDebug -bool YES`.
let isDebug = env["ESMEWORLD_DEBUG"] == "1" || UserDefaults.standard.bool(forKey: "EsmeworldDebug")

/// Self-test output: every line starts with "SELFTEST " and is flushed at once
/// (stdout is block-buffered when the build script captures it).
func say(_ s: String) {
    print("SELFTEST \(s)")
    fflush(stdout)
}

// MARK: - Serving the bundled web app

/// Maps esmeworld://app/<path> to files under Contents/Resources/web/.
final class WebAppSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL
    private let rootPath: String

    init(root: URL) {
        let resolved = root.standardizedFileURL.resolvingSymlinksInPath()
        self.root = resolved
        self.rootPath = resolved.path.hasSuffix("/") ? resolved.path : resolved.path + "/"
    }

    private static let mimeTypes: [String: String] = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "webmanifest": "application/manifest+json; charset=utf-8",
        "png": "image/png",
        "svg": "image/svg+xml",
        "ico": "image/x-icon",
        "woff2": "font/woff2",
        "txt": "text/plain; charset=utf-8",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        guard url.scheme?.lowercased() == kScheme, url.host?.lowercased() == kHost else {
            respond(task, url: url, status: 404, body: Data("Not found".utf8), mime: Self.mimeTypes["txt"]!)
            return
        }
        guard let file = resolve(url) else {
            respond(task, url: url, status: 404, body: Data("Not found".utf8), mime: Self.mimeTypes["txt"]!)
            return
        }
        do {
            let data = try Data(contentsOf: file)
            let ext = file.pathExtension.lowercased()
            let mime = Self.mimeTypes[ext] ?? "application/octet-stream"
            let isHead = task.request.httpMethod?.uppercased() == "HEAD"
            respond(task, url: url, status: 200, body: isHead ? Data() : data, mime: mime, length: data.count)
        } catch {
            respond(task, url: url, status: 404, body: Data("Not found".utf8), mime: Self.mimeTypes["txt"]!)
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        // Responses are written synchronously in start, so there is nothing to cancel.
    }

    /// The file to serve, or nil for 404. A path with no extension is an app route
    /// (BrowserRouter) and gets index.html. Any "." or ".." segment is refused, and
    /// the resolved file must still sit inside the web root.
    private func resolve(_ url: URL) -> URL? {
        let path = url.path // percent-decoded
        if path.contains("\0") || path.contains("\\") { return nil }
        let segments = path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        if segments.contains(where: { $0 == ".." || $0 == "." }) { return nil }

        let isRoute = segments.isEmpty || (segments.last.map { ($0 as NSString).pathExtension.isEmpty } ?? true)
        let candidate: URL
        if isRoute {
            candidate = root.appendingPathComponent("index.html")
        } else {
            candidate = segments.reduce(root) { $0.appendingPathComponent($1) }
        }
        let resolved = candidate.standardizedFileURL.resolvingSymlinksInPath()
        guard resolved.path.hasPrefix(rootPath) else { return nil }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: resolved.path, isDirectory: &isDir), !isDir.boolValue else {
            return nil
        }
        return resolved
    }

    private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, body: Data, mime: String, length: Int? = nil) {
        let headers = [
            "Content-Type": mime,
            "Content-Length": String(length ?? body.count),
            "Cache-Control": "no-cache",
        ]
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        if !body.isEmpty { task.didReceive(body) }
        task.didFinish()
    }
}

// MARK: - Console bridge (self-test and debug only)

/// Forwards console.error, uncaught errors and unhandled rejections to stdout.
final class ConsoleBridge: NSObject, WKScriptMessageHandler {
    static let name = "esmeworldConsole"
    static let script = """
    (() => {
      const send = (kind, args) => {
        try {
          const text = args.map((a) => {
            try {
              if (a instanceof Error) return a.stack || String(a);
              return typeof a === "string" ? a : JSON.stringify(a);
            } catch (e) { return String(a); }
          }).join(" ");
          window.webkit.messageHandlers.\(name).postMessage(kind + ": " + text);
        } catch (e) {}
      };
      const original = console.error.bind(console);
      console.error = (...args) => { send("console.error", args); original(...args); };
      window.addEventListener("error", (e) => send("error", [e.message + " @ " + e.filename + ":" + e.lineno]));
      window.addEventListener("unhandledrejection", (e) => send("unhandledrejection", [e.reason]));
    })();
    """

    var messages: [String] = []

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let text = String(describing: message.body)
        messages.append(text)
        if isSelfTest {
            say("console \(text)")
        } else {
            FileHandle.standardError.write(Data("[web] \(text)\n".utf8))
        }
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate,
    WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate
{
    var window: NSWindow!
    var webView: WKWebView!
    let console = ConsoleBridge()

    // Self-test plumbing.
    private var loadWaiter: CheckedContinuation<Void, Error>?
    private var downloadWaiter: CheckedContinuation<URL, Error>?
    private var selfTestDownloadDir: URL?
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSWindow.allowsAutomaticWindowTabbing = false
        NSApp.mainMenu = buildMainMenu()

        let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
        let config = WKWebViewConfiguration()
        // The default, persistent store: this is where her tasks live. Never use
        // .nonPersistent() here.
        config.websiteDataStore = WKWebsiteDataStore.default()
        config.setURLSchemeHandler(WebAppSchemeHandler(root: webRoot), forURLScheme: kScheme)
        if isSelfTest || isDebug {
            config.userContentController.add(console, name: ConsoleBridge.name)
            config.userContentController.addUserScript(
                WKUserScript(source: ConsoleBridge.script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }

        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1100, height: 760), configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        if isDebug {
            if #available(macOS 13.3, *) { webView.isInspectable = true }
            // Enables Inspect Element and Cmd+Option+I inside the window.
            config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        }

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false)
        window.title = kAppName
        window.minSize = NSSize(width: 480, height: 400)
        window.contentView = webView
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.center()

        if isSelfTest {
            // Headless-ish: no Dock icon, window never shown, no saved frame touched.
            NSApp.setActivationPolicy(.accessory)
            Task { @MainActor in await self.runSelfTest() }
            return
        }

        // Restores the saved size and position if there is one.
        window.setFrameAutosaveName("EsmeworldMainWindow")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        webView.load(URLRequest(url: kStartURL))
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    // MARK: Menus (system standard items only)

    private func buildMainMenu() -> NSMenu {
        let main = NSMenu()

        let appMenu = NSMenu(title: kAppName)
        appMenu.addItem(withTitle: "About \(kAppName)",
                        action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide \(kAppName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit \(kAppName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        main.addItem(submenuItem(appMenu))

        // Without these, text fields get no Cmd+C / Cmd+V.
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        main.addItem(submenuItem(edit))

        let view = NSMenu(title: "View")
        view.addItem(withTitle: "Reload", action: #selector(reloadPage(_:)), keyEquivalent: "r").target = self
        view.addItem(.separator())
        view.addItem(withTitle: "Actual Size", action: #selector(actualSize(_:)), keyEquivalent: "0").target = self
        view.addItem(withTitle: "Zoom In", action: #selector(zoomIn(_:)), keyEquivalent: "+").target = self
        // Hidden twin so Cmd+= (the unshifted + key) also zooms in, as in Safari.
        let zoomInAlt = view.addItem(withTitle: "Zoom In", action: #selector(zoomIn(_:)), keyEquivalent: "=")
        zoomInAlt.target = self
        zoomInAlt.isHidden = true
        zoomInAlt.allowsKeyEquivalentWhenHidden = true
        view.addItem(withTitle: "Zoom Out", action: #selector(zoomOut(_:)), keyEquivalent: "-").target = self
        main.addItem(submenuItem(view))

        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        main.addItem(submenuItem(windowMenu))
        NSApp.windowsMenu = windowMenu

        return main
    }

    private func submenuItem(_ menu: NSMenu) -> NSMenuItem {
        let item = NSMenuItem(title: menu.title, action: nil, keyEquivalent: "")
        item.submenu = menu
        return item
    }

    @objc func reloadPage(_ sender: Any?) {
        // A reload of an error page has nothing to reload; go home instead.
        if webView.url == nil { webView.load(URLRequest(url: kStartURL)) } else { webView.reload() }
    }

    // Zoom steps are a behaviour setting (not a visual design choice): 10% per step, 50%..300%.
    @objc func actualSize(_ sender: Any?) { webView.pageZoom = 1.0 }
    @objc func zoomIn(_ sender: Any?) { webView.pageZoom = min(3.0, (webView.pageZoom * 1.1 * 100).rounded() / 100) }
    @objc func zoomOut(_ sender: Any?) { webView.pageZoom = max(0.5, (webView.pageZoom / 1.1 * 100).rounded() / 100) }

    // MARK: Navigation policy

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void)
    {
        if isSelfTest {
            let u = navigationAction.request.url?.absoluteString ?? "nil"
            say("nav \(u.hasPrefix("blob:") ? "blob:…" : u) shouldPerformDownload=\(navigationAction.shouldPerformDownload)")
        }
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
            decisionHandler(.cancel)
            return
        }
        switch scheme {
        case kScheme:
            decisionHandler(url.host?.lowercased() == kHost ? .allow : .cancel)
        case "blob", "data", "about":
            decisionHandler(.allow)
        default:
            // http, https, mailto, anything else: never inside the app window.
            let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
            if isMainFrame || navigationAction.navigationType == .linkActivated {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow) // a subframe's own resource load (the app has none today)
            }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void)
    {
        if let http = navigationResponse.response as? HTTPURLResponse,
           let disposition = http.value(forHTTPHeaderField: "Content-Disposition"),
           disposition.lowercased().trimmingCharacters(in: .whitespaces).hasPrefix("attachment")
        {
            decisionHandler(.download)
        } else if !navigationResponse.canShowMIMEType {
            decisionHandler(.download)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        if isSelfTest { say("nav didBecomeDownload") }
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadWaiter?.resume()
        loadWaiter = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loadFailed(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadFailed(error)
    }

    private func loadFailed(_ error: Error) {
        if let waiter = loadWaiter {
            loadWaiter = nil
            waiter.resume(throwing: error)
        } else if !isSelfTest {
            FileHandle.standardError.write(Data("Esmeworld: load failed: \(error.localizedDescription)\n".utf8))
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // The page's process crashed or was killed; bring the app back.
        webView.reload()
    }

    // MARK: New windows (target=_blank, window.open)

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView?
    {
        if let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() {
            if scheme == kScheme {
                if url.host?.lowercased() == kHost { webView.load(URLRequest(url: url)) }
            } else if scheme != "blob" && scheme != "data" && scheme != "about" && scheme != "javascript" {
                NSWorkspace.shared.open(url)
            }
        }
        return nil // never open a second web view
    }

    // MARK: File input

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor ([URL]?) -> Void)
    {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    // MARK: JavaScript dialogs

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void)
    {
        if isSelfTest { say("alert \(message)"); completionHandler(); return }
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void)
    {
        if isSelfTest { say("confirm \(message)"); completionHandler(false); return }
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { response in completionHandler(response == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor (String?) -> Void)
    {
        if isSelfTest { say("prompt \(prompt)"); completionHandler(nil); return }
        let alert = NSAlert()
        alert.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.window.initialFirstResponder = field
        alert.beginSheetModal(for: window) { response in
            completionHandler(response == .alertFirstButtonReturn ? field.stringValue : nil)
        }
    }

    // MARK: Downloads (WKDownload, macOS 11.3+)

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping @MainActor (URL?) -> Void)
    {
        if isSelfTest, let dir = selfTestDownloadDir {
            let dest = dir.appendingPathComponent(suggestedFilename)
            say("download suggestedFilename=\(suggestedFilename)")
            downloadDestinations[ObjectIdentifier(download)] = dest
            completionHandler(dest)
            return
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { [weak self] response in
            guard response == .OK, let dest = panel.url else { completionHandler(nil); return }
            // WKDownload refuses to write over an existing file. The Save panel has
            // already asked "Replace?", so move the old file to the Trash (recoverable)
            // rather than deleting it.
            if FileManager.default.fileExists(atPath: dest.path) {
                do {
                    try FileManager.default.trashItem(at: dest, resultingItemURL: nil)
                } catch {
                    self?.showError("The old file could not be replaced. Choose another name.", error)
                    completionHandler(nil)
                    return
                }
            }
            self?.downloadDestinations[ObjectIdentifier(download)] = dest
            completionHandler(dest)
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        let dest = downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
        if let waiter = downloadWaiter, let dest {
            downloadWaiter = nil
            waiter.resume(returning: dest)
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadDestinations.removeValue(forKey: ObjectIdentifier(download))
        if let waiter = downloadWaiter {
            downloadWaiter = nil
            waiter.resume(throwing: error)
            return
        }
        showError("The download did not finish.", error)
    }

    private func showError(_ message: String, _ error: Error) {
        let alert = NSAlert()
        alert.messageText = message
        alert.informativeText = error.localizedDescription
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window, completionHandler: nil)
    }

    // MARK: - Self-test (ESMEWORLD_SELFTEST=1, run by mac/build.sh)

    private func load(_ url: URL) async throws {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            loadWaiter = c
            webView.load(URLRequest(url: url))
        }
    }

    /// Runs an async JS function body that returns a JSON string; decodes it.
    private func js(_ body: String) async throws -> [String: Any] {
        let raw: Any = try await withCheckedThrowingContinuation { (c: CheckedContinuation<Any, Error>) in
            webView.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { result in
                c.resume(with: result)
            }
        }
        guard let text = raw as? String, let data = text.data(using: .utf8),
              let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            throw NSError(domain: "selftest", code: 1, userInfo: [NSLocalizedDescriptionKey: "bad JS result: \(raw)"])
        }
        return obj
    }

    private func waitForDownload(seconds: Double) async throws -> URL {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<URL, Error>) in
            downloadWaiter = c
            DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
                if let waiter = self?.downloadWaiter {
                    self?.downloadWaiter = nil
                    waiter.resume(throwing: NSError(domain: "selftest", code: 2,
                                                    userInfo: [NSLocalizedDescriptionKey: "download timed out"]))
                }
            }
        }
    }

    /// Polls in the page until `check` (a JS expression) is truthy or ~10 s pass.
    private static func waitJS(_ check: String) -> String {
        """
        for (let i = 0; i < 200; i++) {
          if (\(check)) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        """
    }

    @MainActor
    private func runSelfTest() async {
        // Watchdog: never hang the build.
        DispatchQueue.main.asyncAfter(deadline: .now() + 45) {
            say("FAIL watchdog timeout")
            exit(1)
        }
        var ok = true
        func check(_ cond: Bool, _ what: String) {
            if !cond { ok = false; say("FAIL \(what)") }
        }

        do {
            // (a) + (b): home page title and sidebar links.
            try await load(kStartURL)
            let home = try await js("""
            \(Self.waitJS("document.querySelectorAll('.sidebar a').length > 0"))
            return JSON.stringify({ title: document.title, links: document.querySelectorAll('.sidebar a').length });
            """)
            let title = home["title"] as? String ?? ""
            let links = home["links"] as? Int ?? -1
            say("title=\(title)")
            say("sidebarLinks=\(links)")
            check(title == "Esmeworld", "title")
            check(links >= 13, "sidebar links")

            // Scheme handler behaviour, checked from inside the page.
            let serve = try await js("""
            const r = async (p) => { const x = await fetch(p); return x.status + " " + (x.headers.get("content-type") || "-"); };
            return JSON.stringify({
              route: await r("/inbox"),
              icon: await r("/icons/icon-192.png"),
              manifest: await r("/manifest.webmanifest"),
              missing: await r("/assets/does-not-exist.js"),
              traversal: await r("/..%2F..%2FInfo.plist"),
              cache: (await fetch("/")).headers.get("cache-control"),
            });
            """)
            for key in ["route", "icon", "manifest", "missing", "traversal", "cache"] {
                say("serve.\(key)=\(serve[key] ?? "nil")")
            }
            check((serve["route"] as? String ?? "").hasPrefix("200 text/html"), "SPA fallback")
            check((serve["icon"] as? String ?? "").hasPrefix("200 image/png"), "png mime")
            check((serve["manifest"] as? String ?? "").hasPrefix("200 application/manifest+json"), "manifest mime")
            check((serve["missing"] as? String ?? "").hasPrefix("404"), "missing file 404")
            check((serve["traversal"] as? String ?? "").hasPrefix("404"), "path traversal refused")
            check(serve["cache"] as? String == "no-cache", "cache-control")

            // Sync needs a secure context (WebCrypto, Web Locks) and CORS access to the sync server.
            let sync = try await js("""
            let health = "-";
            try { const h = await fetch("https://esmeworld-sync.esme-brain.workers.dev/v1/health", { cache: "no-store" }); health = String(h.status); }
            catch (e) { health = "error " + e; }
            return JSON.stringify({
              secure: String(window.isSecureContext),
              subtle: String(!!(globalThis.crypto && crypto.subtle)),
              locks: String(!!navigator.locks),
              health,
            });
            """)
            for key in ["secure", "subtle", "locks", "health"] {
                say("sync.\(key)=\(sync[key] ?? "nil")")
            }
            check(sync["secure"] as? String == "true", "secure context")
            check(sync["subtle"] as? String == "true", "WebCrypto available")
            check(sync["locks"] as? String == "true", "Web Locks available")
            check(sync["health"] as? String == "200", "sync server reachable (CORS)")

            // (c) a deep link loads straight into the right page.
            try await load(URL(string: "esmeworld://app/area/writing")!)
            let area = try await js("""
            \(Self.waitJS("(document.querySelector('h1')?.textContent || '').trim() === 'Writing'"))
            return JSON.stringify({ h1: (document.querySelector('h1')?.textContent || '').trim() });
            """)
            let h1 = area["h1"] as? String ?? ""
            say("h1=\(h1)")
            check(h1 == "Writing", "h1")

            // (d) IndexedDB persists across launches (a throwaway database, not the app's).
            let idb = try await js("""
            if (\(isSelfTestReset ? "true" : "false")) {
              await new Promise((res, rej) => { const d = indexedDB.deleteDatabase("esmeworld-selftest"); d.onsuccess = res; d.onerror = () => rej(d.error); d.onblocked = res; });
            }
            const db = await new Promise((res, rej) => {
              const r = indexedDB.open("esmeworld-selftest", 1);
              r.onupgradeneeded = () => r.result.createObjectStore("kv");
              r.onsuccess = () => res(r.result);
              r.onerror = () => rej(r.error);
            });
            const n = await new Promise((res, rej) => {
              const tx = db.transaction("kv", "readwrite");
              const st = tx.objectStore("kv");
              let v = 0;
              const g = st.get("launchCount");
              g.onsuccess = () => { v = (typeof g.result === "number" ? g.result : 0) + 1; st.put(v, "launchCount"); };
              tx.oncomplete = () => res(v);
              tx.onerror = () => rej(tx.error);
            });
            db.close();
            let persisted = "unsupported";
            try { persisted = String(await navigator.storage.persisted()); } catch (e) {}
            return JSON.stringify({ n, persisted });
            """)
            let n = idb["n"] as? Int ?? -1
            say("launchCount=\(n)")
            say("storage.persisted=\(idb["persisted"] ?? "nil")")
            check(n >= 1, "IndexedDB write")

            // (e) service worker (informational only).
            let sw = try await js("""
            let regs = "n/a", err = "";
            try {
              if (navigator.serviceWorker) regs = String((await navigator.serviceWorker.getRegistrations()).length);
            } catch (e) { err = String(e); }
            let probe = "skipped";
            try {
              if (navigator.serviceWorker) { await navigator.serviceWorker.register("/selftest-no-such-sw.js"); probe = "registered"; }
            } catch (e) { probe = String(e && e.name) + ": " + String(e && e.message); }
            return JSON.stringify({ t: typeof navigator.serviceWorker, regs, err, probe });
            """)
            say("navigator.serviceWorker=\(sw["t"] ?? "nil")")
            say("serviceWorker.registrations=\(sw["regs"] ?? "nil") \(sw["err"] ?? "")")
            say("serviceWorker.registerProbe=\(sw["probe"] ?? "nil")")

            // Download: press the real Backup page's button; the delegate saves into a
            // temp folder made here, which is deleted afterwards.
            let dir = FileManager.default.temporaryDirectory
                .appendingPathComponent("esmeworld-selftest-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            selfTestDownloadDir = dir
            defer {
                try? FileManager.default.removeItem(at: dir)
                selfTestDownloadDir = nil
                say("download.tempDirRemoved=\(!FileManager.default.fileExists(atPath: dir.path))")
            }
            try await load(URL(string: "esmeworld://app/backup")!)
            let clicked = try await js("""
            const find = () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Download backup");
            \(Self.waitJS("find()"))
            const b = find();
            if (b) b.click();
            return JSON.stringify({ clicked: !!b });
            """)
            check(clicked["clicked"] as? Bool == true, "found Download backup button")
            do {
                let file = try await waitForDownload(seconds: 20)
                let data = try Data(contentsOf: file)
                let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                let named = file.lastPathComponent.hasPrefix("life-hub-backup-") && file.pathExtension == "json"
                say("download file=\(file.lastPathComponent) bytes=\(data.count) json=\(parsed != nil)")
                if named && parsed != nil {
                    say("download=ok")
                } else {
                    check(false, "download contents")
                }
            } catch {
                check(false, "download: \(error.localizedDescription)")
                // What the page says about it (Backup page status/alert lines).
                if let page = try? await js("""
                return JSON.stringify({ text: [...document.querySelectorAll('[role=status],[role=alert]')].map((e) => e.textContent).join(" | ") });
                """) {
                    say("download.pageSays=\(page["text"] ?? "")")
                }
            }
        } catch {
            check(false, "error \(error.localizedDescription)")
        }

        say("consoleErrors=\(console.messages.count)")
        say(ok ? "PASS" : "FAILED")
        exit(ok ? 0 : 1)
    }
}

// MARK: - Entry point

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    withExtendedLifetime(delegate) {
        app.run()
    }
}
