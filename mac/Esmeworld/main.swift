// Esmeworld: a thin AppKit + WKWebView shell around the bundled web app (hub/dist).
//
// The web app is served from Contents/Resources/web through a custom URL scheme,
// esmeworld://app/. That origin is where WKWebView keeps the app's IndexedDB, so it
// must NEVER change: a different scheme or host would show an empty app (the data
// would still be on disk, under the old origin). See mac/README.md.
//
// Native chrome is system default only: standard window, standard menus, no colours.

import AppKit
import UserNotifications
import WebKit

// MARK: - Constants

let kScheme = "esmeworld"
let kHost = "app"
let kStartURL = URL(string: "esmeworld://app/")!
let kAppName = "Esmeworld"

let env = ProcessInfo.processInfo.environment
let isSelfTest = env["ESMEWORLD_SELFTEST"] == "1"
/// Self-test only: delete the self-test data store first so a fresh pair of runs
/// always reads 1 then 2. Never touches the app's own data.
let isSelfTestReset = env["ESMEWORLD_SELFTEST_RESET"] == "1"
/// The self-test's own persistent data store (WKWebsiteDataStore(forIdentifier:)).
/// Fixed so launch 2 sees what launch 1 wrote. Normal launches never use it.
let kSelfTestStoreID = UUID(uuidString: "5E1F7E57-0000-4000-8000-00000000E5E1")!
/// Web Inspector: `ESMEWORLD_DEBUG=1` or `defaults write world.esme.esmeworld EsmeworldDebug -bool YES`.
let isDebug = env["ESMEWORLD_DEBUG"] == "1" || UserDefaults.standard.bool(forKey: "EsmeworldDebug")

/// Self-test output: every line starts with "SELFTEST " and is flushed at once
/// (stdout is block-buffered when the build script captures it).
func say(_ s: String) {
    print("SELFTEST \(s)")
    fflush(stdout)
}

// MARK: - WebCrypto master key (never the login keychain)

/// WebKit wraps every CryptoKey a page stores in IndexedDB (the journal key) with a
/// "master key". By default it keeps that key in the login keychain as
/// "Esmeworld WebCrypto Master Key", and macOS asks for the keychain password whenever
/// the app's signature changes (every ad-hoc build). Instead the navigation delegate
/// hands WebKit this key (private SPI `_webCryptoMasterKeyForWebView:`), so the
/// keychain is never used.
///
/// The key is 32 random bytes made once and kept in
/// ~/Library/Application Support/Esmeworld/webcrypto-master.key (folder 0700, file
/// 0600). The self-test uses its own file and never reads or writes hers. The bytes
/// are never logged. If this file is lost, stored CryptoKeys can no longer be read
/// (the journal then asks for the passphrase once); nothing else depends on it.
enum WebCryptoMasterKey {
    static let length = 32

    static var directory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(kAppName, isDirectory: true)
    }

    static var fileURL: URL {
        directory.appendingPathComponent(isSelfTest ? "webcrypto-master-selftest.key" : "webcrypto-master.key")
    }

    enum Origin: String { case created, loaded }

    /// Self-test reset only: deletes the self-test key file (never hers).
    static func deleteSelfTestKey() {
        precondition(isSelfTest)
        try? FileManager.default.removeItem(at: fileURL)
    }

    /// The key from the file, or a new one written to it. Never overwrites an
    /// existing file (a bad one is an error, so no stored key is ever orphaned).
    static func loadOrCreate() throws -> (Data, Origin) {
        let url = fileURL
        if let existing = try read(url) { return (existing, .loaded) }

        let fm = FileManager.default
        try fm.createDirectory(at: directory, withIntermediateDirectories: true,
                               attributes: [.posixPermissions: 0o700])
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)

        var bytes = [UInt8](repeating: 0, count: length)
        guard SecRandomCopyBytes(kSecRandomDefault, length, &bytes) == errSecSuccess else {
            throw error("SecRandomCopyBytes failed")
        }
        defer { bytes.withUnsafeMutableBytes { _ = memset_s($0.baseAddress, $0.count, 0, $0.count) } }

        // Atomic and no-clobber: write a 0600 temp file, fsync, then link() it into
        // place (fails if the file appeared meanwhile, and then that one is used).
        let temp = directory.appendingPathComponent(".webcrypto-master-\(UUID().uuidString).tmp")
        let fd = open(temp.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw error("can't create \(temp.lastPathComponent): \(String(cString: strerror(errno)))") }
        defer { unlink(temp.path) }
        let written = bytes.withUnsafeBytes { write(fd, $0.baseAddress, $0.count) }
        let synced = fsync(fd)
        close(fd)
        guard written == length, synced == 0 else { throw error("can't write the master key file") }
        if link(temp.path, url.path) != 0 {
            let e = errno
            if e == EEXIST, let existing = try read(url) { return (existing, .loaded) }
            throw error("can't place the master key file: \(String(cString: strerror(e)))")
        }
        // The folder entry itself is durable too.
        let dfd = open(directory.path, O_RDONLY)
        if dfd >= 0 { fsync(dfd); close(dfd) }
        return (Data(bytes), .created)
    }

    /// nil if there is no file; an error if it is there but not a 32-byte key.
    private static func read(_ url: URL) throws -> Data? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let data = try Data(contentsOf: url)
        guard data.count == length else {
            throw error("\(url.path) is \(data.count) bytes, not \(length); left as it is")
        }
        return data
    }

    private static func error(_ text: String) -> NSError {
        NSError(domain: "Esmeworld.WebCryptoMasterKey", code: 1, userInfo: [NSLocalizedDescriptionKey: text])
    }
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

// MARK: - Reminders (local notifications)


/// The web app works out the reminders ahead (hub/src/reminders/schedule.ts: soonest first, up
/// to 60) and sends the whole list here; this replaces every pending Esmeworld reminder with
/// it. They are ordinary scheduled local notifications, so they fire with the app closed. Only
/// titles, counts and an app path cross the bridge (never journal text).
///
/// Messages (window.webkit.messageHandlers.esmeworldReminders.postMessage, which returns a
/// Promise with the reply):
///   { action: "status" }                → { status }
///   { action: "requestPermission" }     → { status }   (macOS asks once, the first time)
///   { action: "schedule", reminders, today?, keepToday? } → { status, scheduled, pending }
///      `today` (the app-day) and `keepToday` (today's reminder ids that still stand): any other
///      of today's already in Notification Center is taken out (it was done).
/// status is "authorized", "denied" or "not-determined". Nothing is scheduled until she allows
/// notifications; the app never asks at launch (only the Reminders page asks).
///
/// Self-test: the binary shares her bundle id (so her notification settings and her pending
/// list, 64 at most). It uses its own identifier prefix, and only the harness's probe schedule
/// (`selfTestProbe: true`) is ever scheduled: the page's own scheduler is answered and ignored.
final class RemindersBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let name = "esmeworldReminders"
    /// Apple keeps at most 64 pending requests per app; the web app sends at most 60, which
    /// leaves room for the self-test's 2 probe requests.
    static let maxRequests = 60
    /// Every Esmeworld reminder's identifier starts with this; the self-test's never match hers.
    static var prefix: String { isSelfTest ? "esmeworld-selftest." : "esmeworld.reminder." }

    private let center = UNUserNotificationCenter.current()
    /// Schedules (and the self-test's cleanups) run one at a time, in the order they arrived.
    private var queue: [(@escaping () -> Void) -> Void] = []
    private var busy = false

    static func statusName(_ s: UNAuthorizationStatus) -> String {
        switch s {
        case .authorized, .provisional: return "authorized"
        case .denied: return "denied"
        case .notDetermined: return "not-determined"
        default: return "denied"
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping @MainActor (Any?, String?) -> Void)
    {
        // Only the app's own page may schedule.
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == kScheme, origin.host == kHost,
              let body = message.body as? [String: Any], let action = body["action"] as? String
        else {
            replyHandler(nil, "not allowed")
            return
        }
        switch action {
        case "status":
            status { replyHandler(["status": $0], nil) }
        case "requestPermission":
            requestPermission { replyHandler(["status": $0], nil) }
        case "schedule":
            // A missing or malformed list is refused: it never empties her pending reminders.
            guard let raw = body["reminders"] as? [Any] else {
                replyHandler(nil, "reminders must be a list")
                return
            }
            if isSelfTest && body["selfTestProbe"] as? Bool != true {
                // The page's own scheduler during a self-test: never scheduled.
                status { replyHandler(["status": $0, "scheduled": 0, "pending": 0, "ignored": true], nil) }
                return
            }
            let list = raw.compactMap { $0 as? [String: Any] }
            let today = body["today"] as? String
            let keep = Set((body["keepToday"] as? [Any] ?? []).compactMap { $0 as? String })
            schedule(list, today: today, keepToday: keep) { status, scheduled, pending in
                replyHandler(["status": status, "scheduled": scheduled, "pending": pending], nil)
            }
        default:
            replyHandler(nil, "unknown action")
        }
    }

    func status(_ done: @escaping @MainActor (String) -> Void) {
        center.getNotificationSettings { s in
            let name = Self.statusName(s.authorizationStatus)
            DispatchQueue.main.async { MainActor.assumeIsolated { done(name) } }
        }
    }

    /// macOS shows its own prompt only while the answer is "not determined". The self-test
    /// never asks (it must not put a prompt on her screen): it only reports the status.
    func requestPermission(_ done: @escaping @MainActor (String) -> Void) {
        if isSelfTest { status(done); return }
        center.requestAuthorization(options: [.alert, .sound]) { [weak self] _, _ in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self else { return }
                    self.status(done)
                }
            }
        }
    }

    /// "YYYY-MM-DDTHH:MM" (local wall-clock time, Gregorian whatever her calendar setting) as
    /// calendar components, or nil: a real date, this year or next, nothing more or less.
    static func components(_ at: String, now: Date = Date()) -> DateComponents? {
        let gregorian = Calendar(identifier: .gregorian)
        guard at.count == 16, at.range(of: #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$"#, options: .regularExpression) != nil else { return nil }
        let parts = at.split(whereSeparator: { $0 == "-" || $0 == "T" || $0 == ":" }).compactMap { Int($0) }
        let thisYear = gregorian.component(.year, from: now)
        guard parts.count == 5, (thisYear...thisYear + 1).contains(parts[0]), (1...12).contains(parts[1]),
              (0...23).contains(parts[3]), (0...59).contains(parts[4]) else { return nil }
        var c = DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: parts[3], minute: parts[4])
        // The day must exist in that month (no 30 February).
        guard let firstOfMonth = gregorian.date(from: DateComponents(year: parts[0], month: parts[1], day: 1)),
              let days = gregorian.range(of: .day, in: .month, for: firstOfMonth), days.contains(parts[2]) else { return nil }
        c.calendar = gregorian
        return c
    }

    /// An app route ("/today"), never another site.
    static func isAppPath(_ p: String) -> Bool {
        p.hasPrefix("/") && !p.hasPrefix("//") && !p.contains("\\") && p.count < 512
    }

    /// The app-day in an id ("checkin:2026-11-04", "session:2026-11-04:<item>").
    static func appDay(ofID id: String) -> String? {
        let parts = id.split(separator: ":", omittingEmptySubsequences: false)
        return parts.count >= 2 ? String(parts[1]) : nil
    }

    /// Replaces every pending Esmeworld reminder with `list`. Nothing is added unless she has
    /// allowed notifications. `pending` is how many of ours the system then holds
    /// (getPendingNotificationRequests).
    func schedule(_ list: [[String: Any]], today: String?, keepToday: Set<String>,
                  _ done: @escaping @MainActor (String, Int, Int) -> Void)
    {
        let requests: [UNNotificationRequest] = list.prefix(Self.maxRequests).compactMap { r in
            guard let id = r["id"] as? String, !id.isEmpty, id.count < 200,
                  let at = r["at"] as? String, let when = Self.components(at),
                  let title = r["title"] as? String, let text = r["body"] as? String,
                  let path = r["path"] as? String, Self.isAppPath(path) else { return nil }
            let content = UNMutableNotificationContent()
            content.title = String(title.prefix(200))
            content.body = String(text.prefix(400))
            content.sound = .default
            content.userInfo = ["path": path]
            let trigger = UNCalendarNotificationTrigger(dateMatching: when, repeats: false)
            return UNNotificationRequest(identifier: Self.prefix + id, content: content, trigger: trigger)
        }
        enqueue { [center] finished in
            center.getNotificationSettings { s in
                let status = Self.statusName(s.authorizationStatus)
                let allowed = s.authorizationStatus == .authorized || s.authorizationStatus == .provisional
                center.getPendingNotificationRequests { pending in
                    let ours = pending.map(\.identifier).filter { $0.hasPrefix(Self.prefix) }
                    if !allowed {
                        // Not allowed (yet): leave nothing of ours waiting.
                        center.removePendingNotificationRequests(withIdentifiers: ours)
                        DispatchQueue.main.async { MainActor.assumeIsolated { done(status, 0, 0); finished() } }
                        return
                    }
                    if let today {
                        // Today's reminders already shown whose thing is now done leave Notification Center.
                        center.getDeliveredNotifications { delivered in
                            let gone = delivered.map(\.request.identifier).filter { full in
                                guard full.hasPrefix(Self.prefix) else { return false }
                                let id = String(full.dropFirst(Self.prefix.count))
                                return Self.appDay(ofID: id) == today && !keepToday.contains(id)
                            }
                            if !gone.isEmpty { center.removeDeliveredNotifications(withIdentifiers: gone) }
                        }
                    }
                    center.removePendingNotificationRequests(withIdentifiers: ours)
                    let group = DispatchGroup()
                    let lock = NSLock()
                    var added = 0
                    for req in requests {
                        group.enter()
                        center.add(req) { error in
                            if error == nil { lock.lock(); added += 1; lock.unlock() }
                            group.leave()
                        }
                    }
                    group.notify(queue: .global()) {
                        center.getPendingNotificationRequests { after in
                            let count = after.filter { $0.identifier.hasPrefix(Self.prefix) }.count
                            DispatchQueue.main.async { MainActor.assumeIsolated { done(status, added, count); finished() } }
                        }
                    }
                }
            }
        }
    }

    /// Self-test only: removes the self-test's own pending reminders (never hers), in turn
    /// after any schedule still running; then reports how many of its own are left.
    func removeSelfTestReminders(_ done: @escaping @MainActor (Int) -> Void) {
        precondition(isSelfTest)
        enqueue { [center] finished in
            center.getPendingNotificationRequests { pending in
                center.removePendingNotificationRequests(
                    withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix(Self.prefix) })
                center.getPendingNotificationRequests { after in
                    let left = after.filter { $0.identifier.hasPrefix(Self.prefix) }.count
                    DispatchQueue.main.async { MainActor.assumeIsolated { done(left); finished() } }
                }
            }
        }
    }

    private func enqueue(_ job: @escaping (@escaping () -> Void) -> Void) {
        queue.append(job)
        runNext()
    }

    private func runNext() {
        guard !busy, !queue.isEmpty else { return }
        busy = true
        let job = queue.removeFirst()
        job { [weak self] in
            self?.busy = false
            self?.runNext()
        }
    }
}

// MARK: - New versions under a running app (bug #39)

/// mac/build.sh --install swaps a whole new bundle in under a running Esmeworld. Its files
/// then sit at the same path, so the running app keeps old code in memory but would serve
/// NEW files to its old page. The build writes two ids into Info.plist: a hash of the web
/// files (EsmeworldWebBuild) and of the compiled app (EsmeworldShellBuild). The app compares
/// the ids on disk with the ones it is running: a new web build means "save, then reload the
/// page"; a new app build means "save, then quit and reopen". Never mid-typing: see
/// AppDelegate.checkForNewVersion.
struct BuildID: Equatable {
    let web: String
    let shell: String
}

enum AppVersion {
    static let webKey = "EsmeworldWebBuild"
    static let shellKey = "EsmeworldShellBuild"
    /// Posted by mac/build.sh --install (object: the installed bundle's path) so a running
    /// app looks at once instead of at its next check.
    static let installedNotification = Notification.Name("world.esme.esmeworld.newVersionInstalled")
    /// How often a running app looks at the bundle on disk anyway.
    static let checkInterval: TimeInterval = 120
    /// While a new version waits (she is typing), how soon to look again.
    static let retryInterval: TimeInterval = 10
    /// In front, the page reloads only after this long with nothing typed (ms).
    static let idleBeforeReloadMs = 30_000

    /// The bundle's Info.plist on disk now (after a swap: the new one). The self-test points
    /// this at a copy it can change.
    static var infoPlistURL = Bundle.main.bundleURL.appendingPathComponent("Contents/Info.plist")

    static func ids(_ info: [String: Any]?) -> BuildID? {
        guard let web = info?[webKey] as? String, let shell = info?[shellKey] as? String,
              !web.isEmpty, !shell.isEmpty else { return nil }
        return BuildID(web: web, shell: shell)
    }

    /// What this process is running (read once at launch, before any install can swap it).
    static let launched: BuildID? = ids(Bundle.main.infoDictionary)

    static func onDisk() -> BuildID? {
        ids(NSDictionary(contentsOf: infoPlistURL) as? [String: Any])
    }

    enum Action: String { case none, reload, relaunch }

    /// Unknown ids (an old build without them, an unreadable file mid-swap) never act.
    static func decide(launched: BuildID?, page: String?, disk: BuildID?) -> Action {
        guard let launched, let disk else { return .none }
        if disk.shell != launched.shell { return .relaunch }
        if disk.web != (page ?? launched.web) { return .reload }
        return .none
    }

    /// What the running app is on, for mac/build.sh to report. The self-test has its own file.
    static var statusURL: URL {
        WebCryptoMasterKey.directory.appendingPathComponent(isSelfTest ? "running-build-selftest.json" : "running-build.json")
    }

    /// state: "current" (on the version on disk) or "waiting" (a new one is on disk and is
    /// taken as soon as she stops typing). Best effort: a failure here changes nothing else.
    static func writeStatus(state: String, reason: String = "", page: String?, disk: BuildID?) {
        let status: [String: Any] = [
            "pid": Int(ProcessInfo.processInfo.processIdentifier),
            "web": page ?? "",
            "shell": launched?.shell ?? "",
            "diskWeb": disk?.web ?? "",
            "diskShell": disk?.shell ?? "",
            "state": state,
            "reason": reason,
            "at": ISO8601DateFormatter().string(from: Date()),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: status, options: [.sortedKeys]) else { return }
        try? FileManager.default.createDirectory(at: WebCryptoMasterKey.directory, withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        try? data.write(to: statusURL, options: .atomic)
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate,
    WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, UNUserNotificationCenterDelegate
{
    var window: NSWindow!
    var webView: WKWebView!
    let console = ConsoleBridge()
    let reminders = RemindersBridge()
    /// A reminder clicked before the window existed (the click launched the app): opened first.
    private var launchPath: String?

    /// The WebCrypto master key handed to WebKit (see WebCryptoMasterKey). nil only
    /// if the key file could not be read or made.
    private var masterKey: Data?
    /// How often WebKit asked for it, per SPI variant (the self-test checks this).
    private var masterKeyCallsSync = 0
    private var masterKeyCallsAsync = 0

    // Self-test plumbing.
    private var loadWaiter: CheckedContinuation<Void, Error>?
    private var downloadWaiter: CheckedContinuation<URL, Error>?
    private var selfTestDownloadDir: URL?
    private var downloadDestinations: [ObjectIdentifier: URL] = [:]

    // New versions (see AppVersion).
    /// The web build the page in the window was loaded from (set when a load commits).
    private(set) var pageWebBuild: String?
    private var versionTimer: Timer?
    private var versionRetry: DispatchWorkItem?
    private var versionCheckRunning = false
    /// Set once the page has been flushed for quitting (relaunch or ⌘Q), so it is done once.
    private var flushedForQuit = false
    /// Self-test only: behave as if the window were in front (the self-test app never is).
    var selfTestPretendInFront = false
    private var selfTestCommits = 0
    static let relaunchPathKey = "EsmeworldRelaunchPath"
    static let relaunchInBackgroundKey = "EsmeworldRelaunchInBackground"

    func applicationWillFinishLaunching(_ notification: Notification) {
        // Before launch finishes, so a reminder click that launched the app reaches us. Never in
        // the self-test: a click on one of her reminders must not go to its hidden window.
        if !isSelfTest { UNUserNotificationCenter.current().delegate = self }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSWindow.allowsAutomaticWindowTabbing = false
        NSApp.mainMenu = buildMainMenu()

        if isSelfTest {
            // Headless-ish: no Dock icon, window never shown, no saved frame touched.
            NSApp.setActivationPolicy(.accessory)
            Task { @MainActor in
                // Watchdog: never hang the build.
                DispatchQueue.main.asyncAfter(deadline: .now() + 75) {
                    say("FAIL watchdog timeout")
                    exit(1)
                }
                guard let store = await self.selfTestDataStore() else {
                    say("FAILED")
                    exit(1)
                }
                if isSelfTestReset { WebCryptoMasterKey.deleteSelfTestKey() }
                self.loadMasterKey()
                guard self.masterKey != nil else {
                    say("FAILED")
                    exit(1)
                }
                self.setUpWindow(dataStore: store)
                self.startWatchingForNewVersions()
                await self.runSelfTest()
            }
            return
        }

        // The default, persistent store: this is where her tasks live. Never use
        // .nonPersistent() here, and never change it.
        loadMasterKey()
        setUpWindow(dataStore: WKWebsiteDataStore.default())

        // Reopened by itself onto a new version (relaunchOntoNewVersion): back to the same
        // page, and left behind her other windows if she was in another app.
        let defaults = UserDefaults.standard
        let relaunchPath = defaults.string(forKey: Self.relaunchPathKey)
        let relaunchedInBackground = defaults.bool(forKey: Self.relaunchInBackgroundKey)
        defaults.removeObject(forKey: Self.relaunchPathKey)
        defaults.removeObject(forKey: Self.relaunchInBackgroundKey)
        if launchPath == nil { launchPath = relaunchPath }

        // Restores the saved size and position if there is one.
        window.setFrameAutosaveName("EsmeworldMainWindow")
        if relaunchedInBackground && launchPath == relaunchPath {
            window.orderBack(nil)
        } else {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
        webView.load(URLRequest(url: launchPath.flatMap(Self.appURL) ?? kStartURL))
        launchPath = nil
        startWatchingForNewVersions()
    }

    // MARK: New versions (bug #39; see AppVersion)

    /// Looks when she comes back to the app, when she leaves it, every few minutes, and when
    /// mac/build.sh --install says it has just installed one.
    func startWatchingForNewVersions() {
        DistributedNotificationCenter.default().addObserver(
            self, selector: #selector(newVersionInstalled(_:)), name: AppVersion.installedNotification,
            object: nil, suspensionBehavior: .deliverImmediately)
        if !isSelfTest {
            versionTimer = Timer.scheduledTimer(withTimeInterval: AppVersion.checkInterval, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated { self?.checkForNewVersion("timer") }
            }
        }
    }

    @objc func newVersionInstalled(_ note: Notification) {
        // Only an install of this very bundle (the self-test's build is elsewhere).
        guard let path = note.object as? String,
              URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath().path
                == Bundle.main.bundleURL.standardizedFileURL.resolvingSymlinksInPath().path
        else { return }
        MainActor.assumeIsolated { checkForNewVersion("installed") }
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        if !isSelfTest { checkForNewVersion("active") }
    }

    func applicationDidResignActive(_ notification: Notification) {
        // She has gone to another app: nothing can be typed here, the safest moment.
        if !isSelfTest { checkForNewVersion("inactive") }
    }

    func windowDidMiniaturize(_ notification: Notification) {
        if !isSelfTest { checkForNewVersion("minimized") }
    }

    /// Nothing can be typed into the window: another app is in front, or it is hidden or minimized.
    private var windowIsBehind: Bool {
        if isSelfTest { return !selfTestPretendInFront }
        return !NSApp.isActive || NSApp.isHidden || !window.isVisible || window.isMiniaturized
    }

    /// If the bundle on disk is newer than what is running: save the page (the same saves as
    /// switching away), then reload it from the new files, or quit and reopen for a new app
    /// build. In front, only after 30 s with nothing typed; otherwise it tries again shortly.
    @MainActor
    func checkForNewVersion(_ why: String) {
        guard webView != nil, !versionCheckRunning, !flushedForQuit else { return }
        let disk = AppVersion.onDisk()
        let action = AppVersion.decide(launched: AppVersion.launched, page: pageWebBuild, disk: disk)
        if isSelfTest { say("version.check why=\(why) action=\(action.rawValue)") }
        guard action != .none else {
            versionRetry?.cancel()
            versionRetry = nil
            return
        }
        versionCheckRunning = true
        let behind = windowIsBehind
        prepareForReload(minIdleMs: behind ? 0 : AppVersion.idleBeforeReloadMs, pageMayBeOld: behind) { [weak self] ready, reason in
            guard let self else { return }
            self.versionCheckRunning = false
            if isSelfTest { say("version.prepare ready=\(ready) reason=\(reason)") }
            guard ready else {
                AppVersion.writeStatus(state: "waiting", reason: reason, page: self.pageWebBuild, disk: disk)
                self.scheduleVersionRetry()
                return
            }
            self.versionRetry?.cancel()
            self.versionRetry = nil
            switch action {
            case .reload: self.reloadOntoNewVersion()
            case .relaunch: self.relaunchOntoNewVersion(inBackground: behind)
            case .none: break
            }
        }
    }

    private func scheduleVersionRetry() {
        versionRetry?.cancel()
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated { self?.checkForNewVersion("retry") }
        }
        versionRetry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + AppVersion.retryInterval, execute: work)
    }

    /// Asks the page to save everything and say when it has landed (window.esmeworldPrepareReload,
    /// hub/src/native/appUpdate.ts). A page from before that hook gets the "page hidden" event its
    /// saves listen for, then a moment for them to land; that is only done when nothing can be
    /// typed (`pageMayBeOld`), since such a page can't tell whether she is typing.
    private func prepareForReload(minIdleMs: Int, pageMayBeOld: Bool, done: @escaping @MainActor (Bool, String) -> Void) {
        guard webView.url != nil else { done(true, ""); return } // an error page: nothing to save
        var answered = false
        let answer: @MainActor (Bool, String) -> Void = { ready, reason in
            if answered { return }
            answered = true
            done(ready, reason)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { answer(false, "no answer from the page") }
        webView.callAsyncJavaScript("""
            const prepare = window.esmeworldPrepareReload;
            if (typeof prepare === "function") return JSON.stringify(await prepare(minIdleMs));
            if (!pageMayBeOld) return JSON.stringify({ ready: false, reason: "old page; waiting until the window is behind" });
            Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
            try { document.dispatchEvent(new Event("visibilitychange")); } finally { delete document.visibilityState; }
            await new Promise((r) => setTimeout(r, 2000));
            return JSON.stringify({ ready: true, reason: "" });
            """, arguments: ["minIdleMs": minIdleMs, "pageMayBeOld": pageMayBeOld], in: nil, in: .page
        ) { result in
            guard case .success(let raw) = result, let text = raw as? String, let data = text.data(using: .utf8),
                  let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            else { answer(false, "the page did not answer"); return }
            answer(obj["ready"] as? Bool == true, obj["reason"] as? String ?? "")
        }
    }

    private func reloadOntoNewVersion() {
        if isSelfTest { say("version.reload") }
        // From the files on disk, not from any cache; the same page she was on.
        if webView.url == nil { webView.load(URLRequest(url: kStartURL)) } else { webView.reloadFromOrigin() }
    }

    /// The app itself changed: a small shell waits for this process to end, then opens the
    /// installed app again (in the background if she was elsewhere), on the same page.
    private func relaunchOntoNewVersion(inBackground: Bool) {
        if isSelfTest { return } // never: the self-test only checks the decision
        let path = webView.url.flatMap { $0.scheme == kScheme ? $0.path : nil } ?? "/"
        UserDefaults.standard.set(path, forKey: Self.relaunchPathKey)
        UserDefaults.standard.set(inBackground, forKey: Self.relaunchInBackgroundKey)
        let reopen = Process()
        reopen.executableURL = URL(fileURLWithPath: "/bin/sh")
        reopen.arguments = ["-c", "while kill -0 \"$1\" 2>/dev/null; do sleep 0.2; done; exec /usr/bin/open \(inBackground ? "-g " : "")\"$2\"",
                            "esmeworld-relaunch", String(ProcessInfo.processInfo.processIdentifier), Bundle.main.bundlePath]
        do {
            try reopen.run()
        } catch {
            UserDefaults.standard.removeObject(forKey: Self.relaunchPathKey)
            UserDefaults.standard.removeObject(forKey: Self.relaunchInBackgroundKey)
            FileHandle.standardError.write(Data("Esmeworld: can't reopen itself: \(error.localizedDescription)\n".utf8))
            return
        }
        flushedForQuit = true // just saved by prepareForReload
        NSApp.terminate(nil)
    }

    /// Quitting (⌘Q, the Quit menu, a relaunch, or closing the window): the page saves first.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !isSelfTest, !flushedForQuit, let webView, webView.url != nil else { return .terminateNow }
        flushedForQuit = true
        var answered = false
        let finish = {
            if answered { return }
            answered = true
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { finish() }
        webView.callAsyncJavaScript(
            "const f = window.esmeworldFlush; if (typeof f === 'function') await f(); return true;",
            arguments: [:], in: nil, in: .page
        ) { _ in finish() }
        return .terminateLater
    }

    /// esmeworld://app<path> for an app path ("/today"), or nil.
    static func appURL(_ path: String) -> URL? {
        RemindersBridge.isAppPath(path) ? URL(string: "\(kScheme)://\(kHost)\(path)") : nil
    }

    /// Self-test only: a separate persistent store, so the self-test never shares
    /// IndexedDB, Web Locks or anything else with her real store (which a running
    /// Esmeworld holds open). With ESMEWORLD_SELFTEST_RESET=1 that store, and only
    /// that store, is deleted first.
    @MainActor
    private func selfTestDataStore() async -> WKWebsiteDataStore? {
        guard #available(macOS 14.0, *) else {
            say("FAIL self-test needs macOS 14 or later (WKWebsiteDataStore(forIdentifier:))")
            return nil
        }
        say("store=selftest \(kSelfTestStoreID.uuidString)")
        if isSelfTestReset {
            // WebKit crashes (null RunLoop in removeDataStoreWithIdentifierImpl) when
            // this is the process's first WebKit call; creating any WebKit object first
            // avoids it.
            _ = WKWebViewConfiguration()
            do {
                try await WKWebsiteDataStore.remove(forIdentifier: kSelfTestStoreID)
                say("store.reset=ok")
            } catch {
                // Normal on the very first run, when the store does not exist yet.
                say("store.reset=\(error.localizedDescription)")
            }
        }
        return WKWebsiteDataStore(forIdentifier: kSelfTestStoreID)
    }

    /// Must run before the web view exists, so WebKit's first request finds the key.
    private func loadMasterKey() {
        do {
            let (key, origin) = try WebCryptoMasterKey.loadOrCreate()
            masterKey = key
            if isSelfTest { say("masterKey=\(origin.rawValue) file=\(WebCryptoMasterKey.fileURL.lastPathComponent)") }
        } catch {
            // Never the bytes; only what went wrong.
            if isSelfTest {
                say("FAIL masterKey \(error.localizedDescription)")
            } else {
                FileHandle.standardError.write(Data("Esmeworld: WebCrypto master key: \(error.localizedDescription)\n".utf8))
            }
        }
    }

    private func setUpWindow(dataStore: WKWebsiteDataStore) {
        let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
        let config = WKWebViewConfiguration()
        config.websiteDataStore = dataStore
        config.setURLSchemeHandler(WebAppSchemeHandler(root: webRoot), forURLScheme: kScheme)
        // Reminders: the web app sends its schedule here (RemindersBridge).
        config.userContentController.addScriptMessageHandler(reminders, contentWorld: .page, name: RemindersBridge.name)
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

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        selfTestCommits += 1
        // A new page is in: it came from the files on disk now (the scheme handler reads them per request).
        pageWebBuild = AppVersion.onDisk()?.web ?? AppVersion.launched?.web
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let disk = AppVersion.onDisk()
        if AppVersion.decide(launched: AppVersion.launched, page: pageWebBuild, disk: disk) == .none {
            AppVersion.writeStatus(state: "current", page: pageWebBuild, disk: disk)
        } else {
            // Swapped while loading: get onto it as usual.
            DispatchQueue.main.async { [weak self] in MainActor.assumeIsolated { self?.checkForNewVersion("loaded") } }
        }
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

    // MARK: WebCrypto master key (private WKNavigationDelegatePrivate SPI)

    // WebKit asks the navigation delegate for the key that wraps CryptoKeys stored in
    // IndexedDB; when the delegate answers, it never creates or reads the
    // "Esmeworld WebCrypto Master Key" keychain item. Both variants are implemented
    // so whichever this WebKit calls is answered (the completion-handler one is
    // preferred by newer WebKit). nil (no key file) lets WebKit fall back to its default.

    @objc(_webCryptoMasterKeyForWebView:)
    func _webCryptoMasterKey(forWebView webView: WKWebView) -> NSData? {
        masterKeyCallsSync += 1
        return masterKey.map { $0 as NSData }
    }

    @objc(_webCryptoMasterKeyForWebView:completionHandler:)
    func _webCryptoMasterKey(forWebView webView: WKWebView, completionHandler: @escaping (NSData?) -> Void) {
        masterKeyCallsAsync += 1
        completionHandler(masterKey.map { $0 as NSData })
    }

    // MARK: Reminders (UNUserNotificationCenterDelegate)

    /// While Esmeworld is the front app, a reminder still shows as a banner.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void)
    {
        completionHandler([.banner, .list, .sound])
    }

    /// Clicking a reminder opens Esmeworld at its page.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void)
    {
        let path = response.notification.request.content.userInfo["path"] as? String
        let clicked = response.actionIdentifier == UNNotificationDefaultActionIdentifier
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated {
                if let path, clicked { self?.openFromReminder(path) }
                completionHandler()
            }
        }
    }

    /// Shows the window and goes to `path`: through the app's router when the page is up (no
    /// reload, nothing typed is lost), else by loading that address.
    @MainActor
    func openFromReminder(_ path: String) {
        guard Self.appURL(path) != nil else { return }
        guard webView != nil, let window else {
            launchPath = path // the window isn't made yet; applicationDidFinishLaunching opens it
            return
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        go(toAppPath: path)
    }

    /// Goes to an app path inside the web view (the router, else a load).
    @MainActor
    func go(toAppPath path: String, then done: (() -> Void)? = nil) {
        guard let url = Self.appURL(path), let webView else { done?(); return }
        webView.callAsyncJavaScript(
            "return typeof window.esmeworldNavigate === 'function' ? window.esmeworldNavigate(p) === true : false",
            arguments: ["p": path], in: nil, in: .page
        ) { result in
            if case .success(let went) = result, went as? Bool == true { done?(); return }
            webView.load(URLRequest(url: url))
            done?()
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

    /// Our pending requests, as the system holds them (self-test prefix only).
    private func selfTestPending() async -> [String] {
        await withCheckedContinuation { (c: CheckedContinuation<[String], Never>) in
            UNUserNotificationCenter.current().getPendingNotificationRequests { reqs in
                c.resume(returning: reqs.map(\.identifier).filter { $0.hasPrefix(RemindersBridge.prefix) })
            }
        }
    }

    /// Never asks for permission (the bridge refuses to in the self-test, so no prompt reaches
    /// her screen). When notifications aren't allowed for Esmeworld, the scheduling part is
    /// skipped and says so. Everything it schedules uses the self-test prefix and is removed.
    @MainActor
    private func runReminderSelfTest(_ check: (Bool, String) -> Void) async {
        do {
            // The Reminders page, in the Mac app, speaks of this Mac.
            try await load(URL(string: "esmeworld://app/reminders")!)
            let page = try await js("""
            \(Self.waitJS("document.querySelectorAll('.rem-row').length > 0"))
            return JSON.stringify({
              h1: (document.querySelector('h1')?.textContent || '').trim(),
              rows: document.querySelectorAll('.rem-row').length,
              mac: (document.querySelector('.rem-intro')?.textContent || '').includes('on this Mac'),
            });
            """)
            say("reminders.page h1=\(page["h1"] ?? "nil") rows=\(page["rows"] ?? "nil") mac=\(page["mac"] as? Bool ?? false)")
            check(page["h1"] as? String == "Reminders", "Reminders page")
            check(page["rows"] as? Int == 6, "Reminders page has six rows")
            check(page["mac"] as? Bool == true, "Reminders page knows it is in the Mac app")

            // The bridge's time parsing (checked here, whether or not notifications are allowed).
            let y = Calendar(identifier: .gregorian).component(.year, from: Date())
            let good = RemindersBridge.components("\(y + 1)-01-31T09:05")
            let bad = ["\(y + 1)-02-30T09:00", "\(y + 1)-01-31T09:00:00", "\(y + 5)-01-01T09:00", "\(y + 1)-13-01T09:00",
                       "\(y + 1)-01-31T24:00", "not a date", "\(y + 1)-1-31T09:00"].filter { RemindersBridge.components($0) != nil }
            say("reminders.parse good=\(good?.day ?? -1)/\(good?.minute ?? -1) acceptedBad=\(bad)")
            check(good?.day == 31 && good?.minute == 5 && good?.calendar?.identifier == .gregorian, "a valid reminder time is read")
            check(bad.isEmpty, "invalid reminder times are refused")

            // The bridge: status, a permission request (answered without asking), a schedule.
            let r = try await js("""
            const h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.\(RemindersBridge.name);
            if (!h || typeof h.postMessage !== "function") return JSON.stringify({ bridge: false });
            const st = await h.postMessage({ action: "status" });
            const asked = await h.postMessage({ action: "requestPermission" });
            const far = new Date(); far.setDate(far.getDate() + 300);
            const p = (n) => String(n).padStart(2, "0");
            const d = far.getFullYear() + "-" + p(far.getMonth() + 1) + "-" + p(far.getDate());
            const y = new Date().getFullYear();
            // The page's own scheduler is never scheduled in a self-test (only the probe below is).
            const page = await h.postMessage({ action: "schedule", reminders: [
              { id: "selftest:page", at: d + "T09:00", title: "x", body: "x", path: "/today" },
            ] });
            let malformed = "accepted";
            try { await h.postMessage({ action: "schedule", reminders: "not a list", selfTestProbe: true }); } catch (e) { malformed = "rejected"; }
            const reply = await h.postMessage({ action: "schedule", selfTestProbe: true, reminders: [
              { id: "selftest:a", at: d + "T09:00", title: "Self-test", body: "Pretend reminder one", path: "/today" },
              { id: "selftest:b", at: d + "T10:00", title: "Self-test", body: "Pretend reminder two", path: "/journal/morning" },
              { id: "selftest:bad-date", at: "not a date", title: "x", body: "x", path: "/today" },
              { id: "selftest:no-such-day", at: (y + 1) + "-02-30T09:00", title: "x", body: "x", path: "/today" },
              { id: "selftest:seconds", at: d + "T09:00:00", title: "x", body: "x", path: "/today" },
              { id: "selftest:far-year", at: (y + 5) + "-01-01T09:00", title: "x", body: "x", path: "/today" },
              { id: "selftest:bad-path", at: d + "T11:00", title: "x", body: "x", path: "https://example.org/" },
              "not an object",
            ] });
            let unknown = "accepted";
            try { await h.postMessage({ action: "no-such-action" }); } catch (e) { unknown = "rejected"; }
            return JSON.stringify({
              bridge: true, status: st.status, asked: asked.status, pageIgnored: page.ignored === true && page.scheduled === 0,
              malformed, scheduled: reply.scheduled, pending: reply.pending, replyStatus: reply.status, unknown,
            });
            """)
            let status = r["status"] as? String ?? "nil"
            say("reminders.bridge=\(r["bridge"] as? Bool ?? false) status=\(status) afterRequest=\(r["asked"] ?? "nil") unknownAction=\(r["unknown"] ?? "nil")")
            check(r["bridge"] as? Bool == true, "reminders bridge exists")
            check(["authorized", "denied", "not-determined"].contains(status), "reminders status")
            check(r["asked"] as? String == status, "self-test never asks for notification permission")
            check(r["unknown"] as? String == "rejected", "reminders bridge rejects unknown actions")
            say("reminders.pageSchedulerIgnored=\(r["pageIgnored"] as? Bool ?? false) malformedList=\(r["malformed"] ?? "nil")")
            check(r["pageIgnored"] as? Bool == true, "the page's own scheduler is never scheduled in a self-test")
            check(r["malformed"] as? String == "rejected", "a malformed reminders list is refused")
            let scheduled = r["scheduled"] as? Int ?? -1
            let pendingReply = r["pending"] as? Int ?? -1
            if status == "authorized" {
                let held = await selfTestPending()
                say("reminders.schedule scheduled=\(scheduled) pending=\(pendingReply) getPendingNotificationRequests=\(held.count)")
                check(scheduled == 2 && pendingReply == 2 && held.count == 2, "schedule sent and held (2 valid of 8)")
            } else {
                say("reminders.schedule=skipped (notifications not authorised: \(status)) scheduled=\(scheduled) pending=\(pendingReply)")
                check(scheduled == 0 && pendingReply == 0, "nothing scheduled while not authorised")
            }

            // A reminder's link: opens the page through the app's router.
            try await load(kStartURL)
            _ = try await js("""
            \(Self.waitJS("typeof window.esmeworldNavigate === 'function'"))
            return JSON.stringify({});
            """)
            await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
                go(toAppPath: "/journal/morning") { c.resume() }
            }
            let nav = try await js("""
            \(Self.waitJS("location.pathname === '/journal/morning'"))
            return JSON.stringify({ path: location.pathname });
            """)
            say("reminders.link path=\(nav["path"] ?? "nil")")
            check(nav["path"] as? String == "/journal/morning", "a reminder's link opens its page")
        } catch {
            check(false, "reminders: \(error.localizedDescription)")
        }
    }

    private func waitUntil(seconds: Double, _ cond: () -> Bool) async -> Bool {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end {
            if cond() { return true }
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        return cond()
    }

    private func readStatus() -> [String: Any] {
        guard let data = try? Data(contentsOf: AppVersion.statusURL),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return [:] }
        return obj
    }

    /// Never touches the bundle: the app is pointed at a copy of its Info.plist, which the test
    /// changes as an install would. Never relaunches (only that decision is checked).
    @MainActor
    private func runVersionSelfTest(_ check: (Bool, String) -> Void) async {
        let realPlist = AppVersion.infoPlistURL
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("esmeworld-selftest-version-\(UUID().uuidString)", isDirectory: true)
        defer {
            AppVersion.infoPlistURL = realPlist
            selfTestPretendInFront = false
            try? FileManager.default.removeItem(at: dir)
        }
        do {
            let launched = AppVersion.launched
            say("version.launched web=\(launched?.web ?? "nil") app=\(launched?.shell ?? "nil") page=\(pageWebBuild ?? "nil")")
            check(launched != nil, "build ids in Info.plist")
            check(AppVersion.onDisk() == launched, "build ids on disk match the running app")
            check(pageWebBuild != nil && pageWebBuild == launched?.web, "the page's build is recorded")

            let a = BuildID(web: "w1", shell: "s1")
            let decisions: [(AppVersion.Action, AppVersion.Action, String)] = [
                (AppVersion.decide(launched: a, page: "w1", disk: a), .none, "same"),
                (AppVersion.decide(launched: a, page: nil, disk: a), .none, "same, no page yet"),
                (AppVersion.decide(launched: a, page: "w1", disk: BuildID(web: "w2", shell: "s1")), .reload, "new web"),
                (AppVersion.decide(launched: a, page: "w2", disk: BuildID(web: "w2", shell: "s1")), .none, "already reloaded"),
                (AppVersion.decide(launched: a, page: "w1", disk: BuildID(web: "w1", shell: "s2")), .relaunch, "new app"),
                (AppVersion.decide(launched: a, page: "w1", disk: nil), .none, "unreadable on disk"),
                (AppVersion.decide(launched: nil, page: "w1", disk: a), .none, "running build has no ids"),
            ]
            let wrong = decisions.filter { $0.0 != $0.1 }.map { "\($0.2)=\($0.0.rawValue)" }
            say("version.decisions wrong=\(wrong)")
            check(wrong.isEmpty, "new-version decisions")

            // The page's hooks; a flush waits for a write still in progress; typing holds a reload.
            try await load(URL(string: "esmeworld://app/area/writing")!)
            let hooks = try await js("""
            \(Self.waitJS("typeof window.esmeworldPrepareReload === 'function'"))
            const hooks = typeof window.esmeworldFlush === "function" && typeof window.esmeworldPrepareReload === "function";
            const db = await new Promise((res, rej) => {
              const r = indexedDB.open("esmeworld-selftest-flush", 1);
              r.onupgradeneeded = () => r.result.createObjectStore("kv");
              r.onsuccess = () => res(r.result);
              r.onerror = () => rej(r.error);
            });
            let landed = false;
            const tx = db.transaction("kv", "readwrite");
            const st = tx.objectStore("kv");
            const until = Date.now() + 400;
            const step = () => { st.put(Date.now(), "t").onsuccess = () => { if (Date.now() < until) step(); }; };
            step();
            tx.oncomplete = () => { landed = true; };
            const t0 = Date.now();
            const flushed = await window.esmeworldFlush();
            const flushMs = Date.now() - t0;
            const landedAtFlush = landed;
            const t1 = Date.now();
            await new Promise((r) => setTimeout(r, 20));
            const timeout20Ms = Date.now() - t1;
            db.close();
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
            const typing = await window.esmeworldPrepareReload(30000);
            window.__esmeworldSelfTestMarker = 1;
            return JSON.stringify({ hooks, landedAtFlush, settled: flushed.settled, typingReady: typing.ready, typingReason: typing.reason, flushMs, timeout20Ms, vis: document.visibilityState });
            """)
            say("version.hooks=\(hooks["hooks"] as? Bool ?? false) flushWaitedForWrite=\(hooks["landedAtFlush"] as? Bool ?? false) settled=\(hooks["settled"] as? Bool ?? false) whileTyping=\(hooks["typingReason"] ?? "nil") flushMs=\(hooks["flushMs"] ?? "nil") timeout20Ms=\(hooks["timeout20Ms"] ?? "nil") visibility=\(hooks["vis"] ?? "nil")")
            check(hooks["hooks"] as? Bool == true, "the page has the flush hooks")
            check(hooks["landedAtFlush"] as? Bool == true && hooks["settled"] as? Bool == true, "a flush waits for a write in progress")
            check(hooks["typingReady"] as? Bool == false && hooks["typingReason"] as? String == "typing", "no reload while she is typing")

            // An install: a new web build on disk.
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let copy = dir.appendingPathComponent("Info.plist")
            try FileManager.default.copyItem(at: realPlist, to: copy)
            AppVersion.infoPlistURL = copy
            let info = NSMutableDictionary(contentsOf: copy) ?? NSMutableDictionary()
            info[AppVersion.webKey] = "selftest-new-web"
            guard info.write(to: copy, atomically: true) else { throw NSError(domain: "selftest", code: 3) }
            let post = {
                DistributedNotificationCenter.default().postNotificationName(
                    AppVersion.installedNotification, object: Bundle.main.bundlePath, userInfo: nil, deliverImmediately: true)
            }

            // In front and just typed: it waits (no reload), and says so.
            selfTestPretendInFront = true
            let commitsBefore = selfTestCommits
            post()
            let waited = await waitUntil(seconds: 8) { self.readStatus()["state"] as? String == "waiting" }
            let st1 = readStatus()
            say("version.inFrontTyping state=\(st1["state"] ?? "nil") reason=\(st1["reason"] ?? "nil") diskWeb=\(st1["diskWeb"] ?? "nil") reloaded=\(selfTestCommits != commitsBefore)")
            check(waited && st1["reason"] as? String == "typing" && st1["diskWeb"] as? String == "selftest-new-web",
                  "a new version waits while she types")
            check(selfTestCommits == commitsBefore, "no reload while she types")

            // Behind other windows: it saves, then reloads onto the new files, on the same page.
            selfTestPretendInFront = false
            post()
            // Long enough for one retry (AppVersion.retryInterval): the first try can find a save
            // still landing, as the self-test page is hidden and its timers run slowly.
            let reloaded = await waitUntil(seconds: AppVersion.retryInterval + 12) {
                self.pageWebBuild == "selftest-new-web" && self.readStatus()["state"] as? String == "current"
            }
            let after = try await js("""
            \(Self.waitJS("typeof window.esmeworldPrepareReload === 'function'"))
            return JSON.stringify({ path: location.pathname, marker: window.__esmeworldSelfTestMarker === 1,
              hooks: typeof window.esmeworldPrepareReload === "function" });
            """)
            let st2 = readStatus()
            say("version.behind reloaded=\(reloaded) path=\(after["path"] ?? "nil") oldPageGone=\(after["marker"] as? Bool == false) status=\(st2["state"] ?? "nil")/\(st2["web"] ?? "nil") pid=\(st2["pid"] ?? "nil")")
            check(reloaded && after["marker"] as? Bool == false, "the page reloads onto a new version")
            check(after["path"] as? String == "/area/writing", "the reload keeps her page")
            check(st2["web"] as? String == "selftest-new-web"
                  && st2["pid"] as? Int == Int(ProcessInfo.processInfo.processIdentifier), "the status file says what is running")

            // A lazy chunk that fails to load: save and reload, but never twice in a minute.
            let c0 = selfTestCommits
            _ = try await js("""
            window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
            return JSON.stringify({});
            """)
            let chunkReload = await waitUntil(seconds: 8) { self.selfTestCommits > c0 }
            _ = try await js("""
            \(Self.waitJS("typeof window.esmeworldPrepareReload === 'function'"))
            return JSON.stringify({});
            """)
            let c1 = selfTestCommits
            _ = try await js("""
            window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
            return JSON.stringify({});
            """)
            let again = await waitUntil(seconds: 2) { self.selfTestCommits > c1 }
            say("version.chunkError reloaded=\(chunkReload) reloadedAgainWithinAMinute=\(again)")
            check(chunkReload, "a failed chunk load reloads the page")
            check(!again, "a failed chunk load never reloads over and over")
        } catch {
            check(false, "version: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func runSelfTest() async {
        var ok = true
        func check(_ cond: Bool, _ what: String) {
            if !cond { ok = false; say("FAIL \(what)") }
        }

        // Leftovers of a self-test that was killed (watchdog, timeout) go first.
        let leftover = await withCheckedContinuation { (c: CheckedContinuation<Int, Never>) in
            reminders.removeSelfTestReminders { c.resume(returning: $0) }
        }
        say("reminders.cleanedAtStart left=\(leftover)")
        check(leftover == 0, "self-test reminders cleaned up at the start")

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

            // (d) IndexedDB persists across launches (in the self-test store, which the
            // reset run deleted first).
            let idb = try await js("""
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

            // (d2) A stored CryptoKey survives a relaunch, wrapped with OUR master key.
            // Launch 1 makes a non-extractable AES-GCM key, seals a value with it and
            // stores both in IndexedDB (WebKit wraps the key on write); every launch
            // then reads them back through a fresh connection (WebKit unwraps) and
            // opens the sealed value. Launch 2 must find launch 1's key. The delegate
            // count proves WebKit asked us, not the keychain, for the master key.
            let wc = try await js("""
            const PLAIN = "esmeworld-selftest-sealed-v1";
            const open = () => new Promise((res, rej) => {
              const r = indexedDB.open("esmeworld-selftest", 1);
              r.onupgradeneeded = () => r.result.createObjectStore("kv");
              r.onsuccess = () => res(r.result);
              r.onerror = () => rej(r.error);
            });
            const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
            const done = (tx) => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
            let stored = "existing", storedOnLaunch = null;
            let db = await open();
            const before = await req(db.transaction("kv").objectStore("kv").get("sealed"));
            if (!before) {
              const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
              const iv = crypto.getRandomValues(new Uint8Array(12));
              const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(PLAIN));
              const tx = db.transaction("kv", "readwrite");
              tx.objectStore("kv").put({ key, iv, ct, launch: \(n) }, "sealed");
              await done(tx);
              stored = "new";
            }
            db.close();
            db = await open();
            const rec = await req(db.transaction("kv").objectStore("kv").get("sealed"));
            db.close();
            if (!rec) return JSON.stringify({ stored, error: "record unreadable after reopen" });
            storedOnLaunch = rec.launch;
            const isKey = rec.key instanceof CryptoKey;
            let plain = "", error = "";
            try {
              plain = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: rec.iv }, rec.key, rec.ct));
            } catch (e) { error = String(e && e.name) + ": " + String(e && e.message); }
            return JSON.stringify({
              stored, storedOnLaunch, isKey: String(isKey), extractable: isKey ? String(rec.key.extractable) : "n/a",
              decrypt: plain === PLAIN ? "ok" : "mismatch", error,
            });
            """)
            let storedOn = wc["storedOnLaunch"] as? Int ?? -1
            say("webcrypto.stored=\(wc["stored"] ?? "nil") storedOnLaunch=\(storedOn) thisLaunch=\(n)")
            say("webcrypto.cryptoKey=\(wc["isKey"] ?? "nil") extractable=\(wc["extractable"] ?? "nil")")
            let wcError = wc["error"] as? String ?? ""
            say("webcrypto.decrypt=\(wc["decrypt"] ?? "nil")\(wcError.isEmpty ? "" : " " + wcError)")
            check(wc["isKey"] as? String == "true", "stored CryptoKey read back")
            check(wc["extractable"] as? String == "false", "stored CryptoKey stays non-extractable")
            check(wc["decrypt"] as? String == "ok", "stored CryptoKey decrypts the sealed value")
            if n >= 2 { check(storedOn >= 1 && storedOn < n, "CryptoKey stored on an earlier launch survived the relaunch") }
            say("webcryptoDelegateCalled=\(masterKeyCallsSync + masterKeyCallsAsync) sync=\(masterKeyCallsSync) completionHandler=\(masterKeyCallsAsync)")
            check(masterKeyCallsSync + masterKeyCallsAsync > 0, "WebKit asked the app for the WebCrypto master key")

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
            // (f) Reminders: the page, the bridge, a schedule sent and held, a reminder's link.
            await runReminderSelfTest(check)
            // (g) A new version installed under the running app (bug #39).
            await runVersionSelfTest(check)
        } catch {
            check(false, "error \(error.localizedDescription)")
        }
        // Through the bridge's queue, so it runs after any schedule still in flight.
        let left = await withCheckedContinuation { (c: CheckedContinuation<Int, Never>) in
            reminders.removeSelfTestReminders { c.resume(returning: $0) }
        }
        let afterCleanup = await selfTestPending()
        say("reminders.selfTestCleanedUp left=\(left) getPendingNotificationRequests=\(afterCleanup.count)")
        check(left == 0 && afterCleanup.isEmpty, "self-test reminders all removed")

        say("consoleErrors=\(console.messages.count)")
        say(ok ? "PASS" : "FAILED")
        exit(ok ? 0 : 1)
    }
}

// MARK: - Entry point

if isSelfTest {
    // Never restore (or offer to restore) windows in a self-test run: after a crash,
    // AppKit would otherwise show a modal "reopen windows?" alert at launch, which
    // nobody can answer in a headless run. Volatile, so nothing is saved.
    UserDefaults.standard.setVolatileDomain(["ApplePersistenceIgnoreState": true],
                                            forName: UserDefaults.argumentDomain)
}
MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.regular)
    withExtendedLifetime(delegate) {
        app.run()
    }
}
