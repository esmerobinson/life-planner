// esme's day — native macOS menu bar app.
// Click the ✿ in the menu bar -> a floating dashboard window (never clipped):
// today's tasks (each opens its project in Obsidian), manifestation + reminder of
// the day with "see more", a one-tap "make a journal entry" that opens today's note,
// goal bars, habit streaks, stars. Reads the vault directly.
// Build: swiftc -swift-version 5 -O main.swift -o EsmeDay

import AppKit
import SwiftUI

// MARK: - vault access

let VAULT = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Desktop/Esme's Brain")

func read(_ rel: String) -> String {
    (try? String(contentsOf: VAULT.appendingPathComponent(rel), encoding: .utf8)) ?? ""
}

func writeVault(_ rel: String, _ content: String) {
    try? content.write(to: VAULT.appendingPathComponent(rel), atomically: true, encoding: .utf8)
}

func obsidianURL(_ file: String) -> URL {
    var cs = CharacterSet.alphanumerics; cs.insert(charactersIn: "-._~/")
    let v = "Esme's Brain".addingPercentEncoding(withAllowedCharacters: cs)!
    let f = file.addingPercentEncoding(withAllowedCharacters: cs)!
    return URL(string: "obsidian://open?vault=\(v)&file=\(f)")!
}

func openInObsidian(_ file: String) { NSWorkspace.shared.open(obsidianURL(file)) }

func section(_ text: String, _ name: String) -> [String] {
    var out: [String] = []; var grab = false
    for line in text.components(separatedBy: "\n") {
        if line.hasPrefix("## ") { grab = line.lowercased().contains(name.lowercased()); continue }
        let t = line.trimmingCharacters(in: .whitespaces)
        if grab && t.hasPrefix("- ") { out.append(String(t.dropFirst(2))) }
    }
    return out
}

func jsonDict(_ rel: String) -> [String: Any] {
    guard let d = read(rel).data(using: .utf8),
          let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return [:] }
    return o
}

func isoDay(_ offset: Int = 0) -> String {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
    return f.string(from: Calendar.current.date(byAdding: .day, value: offset, to: Date())!)
}

func todayNoteFile() -> String {
    let d = Date()
    let day = Calendar.current.component(.day, from: d)
    let suf: String
    switch day % 100 {
    case 11, 12, 13: suf = "th"
    default:
        switch day % 10 {
        case 1: suf = "st"; case 2: suf = "nd"; case 3: suf = "rd"; default: suf = "th"
        }
    }
    let f1 = DateFormatter(); f1.dateFormat = "EEEE"
    let f2 = DateFormatter(); f2.dateFormat = "MMMM"
    return "Daily/Daily Notes/\(isoDay()) \(f1.string(from: d)) \(day)\(suf) \(f2.string(from: d))"
}

// MARK: - model

struct TaskItem: Identifiable { let id = UUID(); let display: String; let target: String; let done: Bool; let raw: String; let category: String }

func categorize(_ text: String, _ target: String) -> String {
    let s = (text + " " + target).lowercased()
    if ["walk", "run", "calisthenic", "nutritious", "overeat", "gym", "movement"].contains(where: s.contains) { return "Health" }
    if ["jeff", "biography", "substack", "book", "essay", "chapter", "write", "story of our relationship", "journal"].contains(where: s.contains) { return "Writing" }
    if ["reel", "carousel", "content", "post", "video", "instagram", "ai project", "build", "vibecoding", "capcut", "footage"].contains(where: s.contains) { return "Content" }
    if ["paint", "art", "touchdesigner", "drawing"].contains(where: s.contains) { return "Art" }
    if ["lucas", "eti", "varvara", "production", "venue", "pr ", "fundrais"].contains(where: s.contains) { return "Production" }
    return "Admin"
}

let CATEGORY_ORDER = ["Writing", "Content", "Art", "Production", "Admin", "Health"]
struct Goal: Identifiable { let id = UUID(); let name: String; let cur: Int; let tgt: Int }
struct Habit: Identifiable { let id = UUID(); let name: String; let done: Bool; let streak: Int }

final class Model: ObservableObject {
    @Published var tasks: [TaskItem] = []
    @Published var manifestation = ""
    @Published var reminder = ""
    @Published var goals: [Goal] = []
    @Published var habits: [Habit] = []
    @Published var starsToday = 0
    @Published var starsWeek = 0

    func load() {
        let noteFile = todayNoteFile()
        let note = read(noteFile + ".md")

        // tasks: every checkbox line; [[Hub|alias]] shows as alias, first Hub = click target
        tasks = note.components(separatedBy: "\n").compactMap { line in
            let t = line.trimmingCharacters(in: .whitespaces)
            guard t.hasPrefix("- [ ]") || t.hasPrefix("- [x]") else { return nil }
            let done = t.hasPrefix("- [x]")
            var text = String(t.dropFirst(5)).trimmingCharacters(in: .whitespaces)
            var target = noteFile
            if let r = text.range(of: #"\[\[([^\]|]+)\|"#, options: .regularExpression) {
                target = String(text[r].dropFirst(2).dropLast(1))
            }
            while let r = text.range(of: #"\[\[([^\]]+)\]\]"#, options: .regularExpression) {
                let inner = text[r].dropFirst(2).dropLast(2).components(separatedBy: "|")
                text.replaceSubrange(r, with: inner.last ?? "")
            }
            return TaskItem(display: text, target: target, done: done, raw: t, category: categorize(text, target))
        }

        // manifestation of the day: HER list first (Manifestations & Vision Board), then the Kit set
        var manis: [String] = []
        for line in section(read("Mind & Wellbeing/Manifestations & Vision Board.md"), "My manifestations") {
            let c = line.replacingOccurrences(of: "*", with: "").trimmingCharacters(in: .whitespaces)
            if c.count > 10 { manis.append(c) }
        }
        var inSet = false
        for line in read("Mind & Wellbeing/Motivation & Manifestation Kit.md").components(separatedBy: "\n") {
            if line.hasPrefix("## ") { inSet = line.lowercased().contains("manifestation set"); continue }
            let t = line.trimmingCharacters(in: .whitespaces)
            if inSet && t.hasPrefix("- *") {
                let body = t.dropFirst(2).components(separatedBy: "→").first ?? ""
                manis.append(body.replacingOccurrences(of: "*", with: "").trimmingCharacters(in: .whitespaces))
            }
        }
        let seed = Calendar.current.ordinality(of: .day, in: .year, for: Date()) ?? 1
        manifestation = manis.isEmpty
            ? "I am building the life I want, one honest day at a time."
            : manis[seed % manis.count]

        // reminder of the day from Daily reminders (numbered lines)
        let rem = read("Daily/Daily reminders.md").components(separatedBy: "\n")
            .filter { $0.range(of: #"^\d+\."#, options: .regularExpression) != nil }
            .map { $0.replacingOccurrences(of: #"^\d+\.\s*"#, with: "", options: .regularExpression) }
        reminder = rem.isEmpty ? "" : rem[(seed * 7) % rem.count]

        let cfg = read("Goals & Direction/Goals & Habits.md")
        goals = section(cfg, section(cfg, "2026").isEmpty ? "big goals" : "2026").compactMap { line in
            let parts = line.components(separatedBy: ":")
            guard parts.count >= 2 else { return nil }
            let nums = parts[1].components(separatedBy: "/").map {
                Int($0.replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespaces)) ?? 0
            }
            guard nums.count == 2, nums[1] > 0 else { return nil }
            return Goal(name: parts[0].trimmingCharacters(in: .whitespaces), cur: nums[0], tgt: nums[1])
        }
        let log = jsonDict("Daily/habits.json")
        let today = (log[isoDay()] as? [String]) ?? []
        habits = section(cfg, "Daily habits").map { h in
            var streak = 0
            while ((log[isoDay(-streak)] as? [String]) ?? []).contains(h) { streak += 1 }
            return Habit(name: h, done: today.contains(h), streak: streak)
        }
        let stars = jsonDict("Daily/stars.json")
        starsToday = stars[isoDay()] as? Int ?? 0
        starsWeek = (0..<7).reduce(0) { $0 + (stars[isoDay(-$1)] as? Int ?? 0) }
    }

    // MARK: writes (ticks feed streaks; Drive syncs them up to the cloud)

    private func saveJSON(_ rel: String, _ obj: [String: Any]) {
        if let d = try? JSONSerialization.data(withJSONObject: obj),
           let s = String(data: d, encoding: .utf8) { writeVault(rel, s) }
    }

    func awardStar() {
        var stars = jsonDict("Daily/stars.json")
        stars[isoDay()] = (stars[isoDay()] as? Int ?? 0) + 1
        saveJSON("Daily/stars.json", stars)
    }

    func toggleTask(_ t: TaskItem) {
        let file = todayNoteFile() + ".md"
        let note = read(file)
        let flipped = t.done ? t.raw.replacingOccurrences(of: "- [x]", with: "- [ ]")
                             : t.raw.replacingOccurrences(of: "- [ ]", with: "- [x]")
        guard note.contains(t.raw) else { return }
        writeVault(file, note.replacingOccurrences(of: t.raw, with: flipped))
        if !t.done {
            awardStar()
            var cs = jsonDict("Daily/category-stars.json")
            cs[t.category] = (cs[t.category] as? Int ?? 0) + 1
            saveJSON("Daily/category-stars.json", cs)
            if t.category == "Health" && !habitDone("Movement") { toggleHabit("Movement") }
        }
        load()
    }

    func categoryStars(_ cat: String) -> Int {
        jsonDict("Daily/category-stars.json")[cat] as? Int ?? 0
    }

    func toggleHabit(_ name: String) {
        var log = jsonDict("Daily/habits.json")
        var today = (log[isoDay()] as? [String]) ?? []
        if let i = today.firstIndex(of: name) { today.remove(at: i) }
        else { today.append(name); awardStar() }
        log[isoDay()] = today
        saveJSON("Daily/habits.json", log)
        load()
    }

    func habitDone(_ name: String) -> Bool { habits.first { $0.name == name }?.done ?? false }
    func streak(_ name: String) -> Int { habits.first { $0.name == name }?.streak ?? 0 }
}

// MARK: - styling

let bg = Color(red: 0.106, green: 0.106, blue: 0.106)
let fg = Color(red: 0.604, green: 0.604, blue: 0.510)
let bright = Color(red: 0.788, green: 0.788, blue: 0.678)
let green = Color(red: 0.561, green: 0.682, blue: 0.529)
let dim = Color(red: 0.396, green: 0.396, blue: 0.353)

func mono(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font {
    .system(size: s, weight: w, design: .monospaced)
}

struct SectionHeader: View {
    let title: String; var more: String? = nil
    var body: some View {
        HStack {
            Text("// " + title).font(mono(10)).foregroundColor(dim)
            Spacer()
            if let m = more {
                Button("see more →") { openInObsidian(m) }
                    .buttonStyle(.plain).font(mono(10)).foregroundColor(green.opacity(0.85))
            }
        }
    }
}

struct Bar: View {
    let pct: Double
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 3).fill(Color.white.opacity(0.07))
                RoundedRectangle(cornerRadius: 3).fill(green)
                    .frame(width: max(4, geo.size.width * min(pct, 1)))
            }
        }.frame(height: 6)
    }
}

struct Tick: View {
    let on: Bool
    let action: () -> Void
    @State private var hover = false
    var body: some View {
        Button(action: action) {
            Text(on ? "●" : (hover ? "◉" : "○"))
                .font(mono(13)).foregroundColor(on ? green : (hover ? green : dim))
                .scaleEffect(hover ? 1.25 : 1)
                .frame(width: 16).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .animation(.easeOut(duration: 0.12), value: hover)
        .help(on ? "untick" : "tick, it counts")
    }
}

struct StreakBadge: View {
    let n: Int
    var body: some View {
        Text(n > 0 ? "🔥\(n)" : "·").font(mono(11)).foregroundColor(green)
    }
}

struct TaskRow: View {
    let task: TaskItem
    let model: Model
    @State private var hover = false
    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            Tick(on: task.done) { model.toggleTask(task) }
            Button(action: { openInObsidian(task.target) }) {
                HStack(alignment: .top, spacing: 4) {
                    Text(task.display).font(mono(12))
                        .foregroundColor(task.done ? dim : (hover ? bright : fg))
                        .strikethrough(task.done, color: dim)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    if hover { Text("→").font(mono(11)).foregroundColor(green) }
                }.contentShape(Rectangle())
            }.buttonStyle(.plain).onHover { hover = $0 }
        }
        .padding(.vertical, 2).padding(.horizontal, 4)
        .background(RoundedRectangle(cornerRadius: 5).fill(hover ? Color.white.opacity(0.05) : .clear))
    }
}

struct Dashboard: View {
    @ObservedObject var model: Model
    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Date(), format: .dateTime.weekday(.wide).day().month(.wide))
                        .font(mono(15, .semibold)).foregroundColor(bright)
                    Text("// one honest day at a time").font(mono(11)).foregroundColor(dim)
                }

                // affirm rows: manifestation / reminder / journal, tick + streak inline
                VStack(alignment: .leading, spacing: 8) {
                    SectionHeader(title: "click to affirm",
                                  more: "Mind & Wellbeing/Manifestations & Vision Board")
                    HStack(alignment: .top, spacing: 7) {
                        Tick(on: model.habitDone("Morning manifestations")) {
                            model.toggleHabit("Morning manifestations")
                        }
                        Text(model.manifestation).font(mono(12).italic()).foregroundColor(bright)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        StreakBadge(n: model.streak("Morning manifestations"))
                    }
                    HStack(alignment: .top, spacing: 7) {
                        Tick(on: model.habitDone("Read reminders")) {
                            model.toggleHabit("Read reminders")
                        }
                        Text(model.reminder).font(mono(12)).foregroundColor(fg)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 4)
                        StreakBadge(n: model.streak("Read reminders"))
                    }
                    HStack(alignment: .top, spacing: 7) {
                        Tick(on: model.habitDone("Journal feelings")) {
                            model.toggleHabit("Journal feelings")
                        }
                        Text("journal").font(mono(12)).foregroundColor(fg)
                        Spacer(minLength: 4)
                        StreakBadge(n: model.streak("Journal feelings"))
                    }
                }

                // to do today, grouped by category, stars per category
                VStack(alignment: .leading, spacing: 6) {
                    SectionHeader(title: "to do today, tick or tap for context", more: todayNoteFile())
                    if model.tasks.isEmpty {
                        Text("no plan yet, the 8:30 message builds it").font(mono(12)).foregroundColor(dim)
                    }
                    ForEach(CATEGORY_ORDER, id: \.self) { cat in
                        let items = model.tasks.filter { $0.category == cat }
                        if !items.isEmpty {
                            HStack(spacing: 6) {
                                Text(cat.lowercased()).font(mono(11, .semibold)).foregroundColor(bright)
                                Text("★ \(model.categoryStars(cat))").font(mono(11)).foregroundColor(green)
                                Spacer()
                            }.padding(.top, 4)
                            ForEach(items) { TaskRow(task: $0, model: model) }
                        }
                    }
                }

                Button(action: {
                    openInObsidian(todayNoteFile())
                    if !model.habitDone("Journal feelings") { model.toggleHabit("Journal feelings") }
                }) {
                    HStack {
                        Text("✎  make a journal entry now?").font(mono(12, .medium))
                        Spacer()
                        Text("→").font(mono(12))
                    }
                    .padding(.vertical, 9).padding(.horizontal, 12)
                    .background(RoundedRectangle(cornerRadius: 8).fill(green.opacity(0.16)))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(green.opacity(0.5), lineWidth: 1))
                    .foregroundColor(green)
                    .contentShape(Rectangle())
                }.buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 8) {
                    SectionHeader(title: "2026 goals", more: "Goals & Direction/Goals")
                    ForEach(model.goals) { g in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack {
                                Text(g.name).font(mono(12)).foregroundColor(fg)
                                Spacer()
                                Text("\(g.cur.formatted()) / \(g.tgt.formatted())")
                                    .font(mono(11)).foregroundColor(dim)
                            }
                            Bar(pct: Double(g.cur) / Double(g.tgt))
                        }
                    }
                }

                Divider().overlay(dim.opacity(0.4))
                HStack(spacing: 14) {
                    Link("web dashboard", destination: URL(string: "https://esmerobinson.github.io/life-planner/")!)
                    Button("vault") { openInObsidian("START HERE") }.buttonStyle(.plain)
                    Spacer()
                    Button("quit") { NSApp.terminate(nil) }.buttonStyle(.plain).foregroundColor(dim)
                }.font(mono(11)).foregroundColor(green)
            }
            .padding(20)
        }
        .frame(width: 340, height: 640)
        .background(bg)
    }
}

// MARK: - menu bar + floating window (a real window, so nothing gets clipped)

final class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var window: NSWindow!
    let model = Model()

    func applicationDidFinishLaunching(_ n: Notification) {
        model.load()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        updateTitle()
        statusItem.button?.action = #selector(toggle)
        statusItem.button?.target = self

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 340, height: 640),
                          styleMask: [.titled, .closable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.level = .floating
        window.backgroundColor = NSColor(red: 0.106, green: 0.106, blue: 0.106, alpha: 1)
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: Dashboard(model: model))

        Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            self?.model.load(); self?.updateTitle()
        }
    }

    func updateTitle() {
        let done = model.tasks.filter { $0.done }.count
        statusItem.button?.title = "✿ \(done)/\(model.tasks.count)"
        statusItem.button?.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .medium)
    }

    @objc func toggle() {
        if window.isVisible { window.orderOut(nil); return }
        model.load(); updateTitle()
        if let btnWin = statusItem.button?.window, let screen = btnWin.screen {
            let btn = btnWin.frame
            var x = btn.midX - window.frame.width + 40
            x = min(max(x, screen.visibleFrame.minX + 8),
                    screen.visibleFrame.maxX - window.frame.width - 8)
            let y = screen.visibleFrame.maxY - window.frame.height - 6
            window.setFrameOrigin(NSPoint(x: x, y: y))
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
