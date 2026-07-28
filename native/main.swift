// esme's day — native macOS menu bar app.
// Click the ✿ in the menu bar -> a floating window (never clipped, freely resizable),
// with three tabs: Today (tasks, manifestation + reminder, goal bars, habit streaks,
// stars), Schedule (today's suggested timed plan, editable), Calendar (deadlines only).
// Reads the vault directly, watches it for instant live-updates via FSEvents.
// Build: swiftc -swift-version 5 -O main.swift -o EsmeDay -framework CoreServices

import AppKit
import CoreServices
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
    if ["reel", "carousel", "content", "post", "video", "instagram", "ai project", "build", "vibecoding", "capcut", "footage",
        "paint", "art", "touchdesigner", "drawing",
        "lucas", "eti", "varvara", "production", "venue", "pr ", "fundrais"].contains(where: s.contains) { return "Content" }
    return "Admin"
}

let CATEGORY_ORDER = ["Writing", "Content", "Admin", "Health"]

func element(for category: String) -> String {
    switch category {
    case "Writing": return "air"
    case "Content": return "water"
    case "Health": return "fire"
    default: return "earth"   // Admin
    }
}
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
        var cs = jsonDict("Daily/category-stars.json")
        if cs["Art"] != nil || cs["Production"] != nil {
            let merged = (cs["Content"] as? Int ?? 0) + (cs["Art"] as? Int ?? 0) + (cs["Production"] as? Int ?? 0)
            cs["Content"] = merged
            cs.removeValue(forKey: "Art")
            cs.removeValue(forKey: "Production")
            saveJSON("Daily/category-stars.json", cs)
        }
        return cs[cat] as? Int ?? 0
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

// MARK: - schedule tab (today's suggested, editable timed plan)

func addMinutes(_ hhmm: String, _ mins: Int) -> String {
    let parts = hhmm.split(separator: ":").compactMap { Int($0) }
    guard parts.count == 2 else { return hhmm }
    let total = ((parts[0] * 60 + parts[1] + mins) % (24 * 60) + 24 * 60) % (24 * 60)
    return String(format: "%02d:%02d", total / 60, total % 60)
}

struct ScheduleBlock: Identifiable, Codable, Equatable {
    var id: String
    var task_ref: String?
    var label: String
    var start: String
    var duration_min: Int
    var is_open: Bool?
    var isOpen: Bool { is_open == true }
}

enum DeleteMode { case notToday, moveTo(Date) }

final class ScheduleModel: ObservableObject {
    @Published var blocks: [ScheduleBlock] = []
    @Published var newlyAdded: Set<String> = []

    func load(currentTasks: [TaskItem]) {
        var loaded = decode()
        reconcile(&loaded, currentTasks: currentTasks)
        blocks = loaded
        persist()
    }

    private func decode() -> [ScheduleBlock] {
        guard let d = read("Daily/schedule.json").data(using: .utf8),
              let arr = try? JSONDecoder().decode([ScheduleBlock].self, from: d) else { return [] }
        return arr
    }

    private func reconcile(_ blocks: inout [ScheduleBlock], currentTasks: [TaskItem]) {
        let openTexts = Set(currentTasks.filter { !$0.done }.map { $0.display })
        for i in blocks.indices {
            if let ref = blocks[i].task_ref, !openTexts.contains(ref) {
                blocks[i].task_ref = nil
                blocks[i].label = "open"
                blocks[i].is_open = true
            }
        }
        let referenced = Set(blocks.compactMap { $0.task_ref })
        for t in currentTasks where !t.done && !referenced.contains(t.display) {
            if let idx = blocks.firstIndex(where: { $0.isOpen }) {
                blocks[idx].task_ref = t.display
                blocks[idx].label = t.display
                blocks[idx].is_open = false
                newlyAdded.insert(blocks[idx].id)
            } else {
                let start = blocks.last.map { addMinutes($0.start, $0.duration_min) } ?? "09:00"
                let blk = ScheduleBlock(id: UUID().uuidString, task_ref: t.display, label: t.display,
                                        start: start, duration_min: 30, is_open: false)
                blocks.append(blk)
                newlyAdded.insert(blk.id)
            }
        }
        recomputeStarts(&blocks)
    }

    private func recomputeStarts(_ blocks: inout [ScheduleBlock]) {
        guard var cursor = blocks.first?.start else { return }
        for i in blocks.indices {
            blocks[i].start = cursor
            cursor = addMinutes(cursor, blocks[i].duration_min)
        }
    }

    private func persist() {
        guard let d = try? JSONEncoder().encode(blocks), let s = String(data: d, encoding: .utf8) else { return }
        writeVault("Daily/schedule.json", s)
    }

    func move(from: IndexSet, to: Int) {
        blocks.move(fromOffsets: from, toOffset: to)
        recomputeStarts(&blocks)
        persist()
    }

    func resize(_ id: String, deltaMinutes: Int) {
        guard let i = blocks.firstIndex(where: { $0.id == id }) else { return }
        blocks[i].duration_min = max(5, blocks[i].duration_min + deltaMinutes)
        recomputeStarts(&blocks)
        persist()
    }

    func delete(_ id: String, mode: DeleteMode) {
        guard let i = blocks.firstIndex(where: { $0.id == id }) else { return }
        let task = blocks[i].task_ref
        blocks[i].task_ref = nil
        blocks[i].label = "open"
        blocks[i].is_open = true
        recomputeStarts(&blocks)
        persist()
        if case .moveTo(let date) = mode, let task = task { moveTaskDue(task, to: date) }
    }

    private func moveTaskDue(_ text: String, to date: Date) {
        let path = "Goals & Direction/Backlog.md"
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        let tag = "[due \(f.string(from: date))]"
        let note = read(path)
        let lines = note.components(separatedBy: "\n").map { line -> String in
            guard line.contains("- [ ] "), line.contains(text) else { return line }
            var l = line
            if let r = l.range(of: #"\[due \d{4}-\d{2}-\d{2}\]"#, options: .regularExpression) {
                l.replaceSubrange(r, with: tag)
            } else {
                l += " " + tag
            }
            return l
        }
        writeVault(path, lines.joined(separator: "\n"))
    }
}

// MARK: - calendar tab (due-dated tasks + deadlines only, no recurring)

struct DueItem: Identifiable {
    let id = UUID()
    let text: String
    let due: Date
}

final class CalendarModel: ObservableObject {
    @Published var items: [DueItem] = []

    func load() {
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd"
        var out: [DueItem] = []
        var section = ""
        for raw in read("Goals & Direction/Backlog.md").components(separatedBy: "\n") {
            if raw.hasPrefix("## ") { section = raw.dropFirst(3).lowercased(); continue }
            if section.contains("parked") || section.contains("moved elsewhere") { continue }
            let t = raw.trimmingCharacters(in: .whitespaces)
            guard t.hasPrefix("- [ ] "),
                  let r = t.range(of: #"\[due (\d{4}-\d{2}-\d{2})\]"#, options: .regularExpression),
                  let dm = t.range(of: #"\d{4}-\d{2}-\d{2}"#, options: .regularExpression, range: r),
                  let date = df.date(from: String(t[dm])) else { continue }
            var text = String(t.dropFirst(6))
            for pat in [#"\s*!p[123]\b"#, #"\s*\[due \d{4}-\d{2}-\d{2}\]"#, #"\s*\[recur: [a-z,]+\]"#, #"\s*#[\w-]+"#] {
                text = text.replacingOccurrences(of: pat, with: "", options: .regularExpression)
            }
            out.append(DueItem(text: text.trimmingCharacters(in: .whitespaces), due: date))
        }
        items = out.sorted { $0.due < $1.due }
    }
}

// MARK: - vault watcher (instant live-update, local FSEvents, no network/cost)

final class VaultWatcher {
    private var stream: FSEventStreamRef?
    var onChange: (() -> Void)?

    init(path: String) {
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(self).toOpaque(),
                                            retain: nil, release: nil, copyDescription: nil)
        let callback: FSEventStreamCallback = { _, clientInfo, _, _, _, _ in
            guard let clientInfo = clientInfo else { return }
            let watcher = Unmanaged<VaultWatcher>.fromOpaque(clientInfo).takeUnretainedValue()
            DispatchQueue.main.async { watcher.onChange?() }
        }
        stream = FSEventStreamCreate(nil, callback, &context, [path] as CFArray,
                                      FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
                                      0.5,
                                      FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents |
                                                                kFSEventStreamCreateFlagNoDefer))
        if let stream = stream {
            FSEventStreamSetDispatchQueue(stream, DispatchQueue.main)
            FSEventStreamStart(stream)
        }
    }

    deinit {
        if let stream = stream {
            FSEventStreamStop(stream)
            FSEventStreamInvalidate(stream)
        }
    }
}

// MARK: - styling
// Avatar: The Last Airbender cozy-game palette (Aang color scheme).
let bg = Color(red: 0.976, green: 0.937, blue: 0.890)      // #F9EFE3 cream
let fg = Color(red: 0.443, green: 0.329, blue: 0.278)      // #715447 brown
let bright = Color(red: 0.431, green: 0.090, blue: 0.0)    // #6E1700 dark red-brown
let green = Color(red: 0.957, green: 0.757, blue: 0.208)   // #F4C135 gold (kept as `green` -- primary accent, see below)
let dim = Color(red: 0.443, green: 0.329, blue: 0.278).opacity(0.55) // muted brown
let hoverAccent = Color(red: 0.933, green: 0.447, blue: 0.137) // #EE7223 orange, hover/pressed states

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

// Undertale-style reveal: text types itself in, character by character.
// A few seconds total, not a loop — plays once when the view appears.
struct TypewriterText: View {
    let text: String
    var speed: Double = 0.018   // seconds per character
    var italic: Bool = false
    var color: Color = fg
    @State private var shown = ""

    var body: some View {
        Text(shown)
            .font(italic ? mono(12).italic() : mono(12))
            .foregroundColor(color)
            .fixedSize(horizontal: false, vertical: true)
            .onAppear {
                shown = ""
                for (i, ch) in text.enumerated() {
                    DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * speed) {
                        shown.append(ch)
                    }
                }
            }
            .onChange(of: text) { _, newValue in
                shown = ""
                for (i, ch) in newValue.enumerated() {
                    DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * speed) {
                        shown.append(ch)
                    }
                }
            }
    }
}

// A chunky, few-frame "burst": scale punches up then settles. No smooth easing,
// on purpose — that blocky, discrete-frame quality is the Undertale feel.
// Loads a pre-extracted element/Lotus icon from native/Assets/Icons/ (see native/tools/extract_icons.py).
// Resolved relative to the running binary's directory, same approach as the vault paths above.
func assetsIconURL(_ name: String) -> URL {
    Bundle.main.bundleURL.deletingLastPathComponent()
        .appendingPathComponent("Assets/Icons/\(name).png")
}

struct ElementIcon: View {
    let element: String   // "air" | "water" | "fire" | "earth" | "lotus"
    var size: CGFloat = 14
    var body: some View {
        if let img = NSImage(contentsOf: assetsIconURL(element)) {
            Image(nsImage: img).resizable().interpolation(.none)
                .frame(width: size, height: size)
        } else {
            Text("?").font(mono(size)).foregroundColor(dim)
        }
    }
}

struct StarBurst: View {
    @Binding var trigger: Int
    let element: String   // "air" | "water" | "fire" | "earth" | "lotus"
    @State private var scale: CGFloat = 0
    @State private var opacity: Double = 0
    var body: some View {
        ElementIcon(element: element, size: 16)
            .scaleEffect(scale).opacity(opacity)
            .onChange(of: trigger) { _, _ in
                scale = 1.6; opacity = 1
                withAnimation(.linear(duration: 0.06)) { scale = 0.9 }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.06) {
                    withAnimation(.linear(duration: 0.05)) { scale = 1.3 }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    withAnimation(.easeIn(duration: 0.3)) { opacity = 0; scale = 0.6 }
                }
            }
    }
}

let gold = Color(red: 0.827, green: 0.639, blue: 0.255)

struct Tick: View {
    let on: Bool
    let element: String
    var wellbeing: Bool = false
    let action: () -> Void
    @State private var hover = false
    @State private var burstTrigger = 0
    var body: some View {
        ZStack {
            Button(action: {
                if !on { burstTrigger += 1 }
                action()
            }) {
                Group {
                    if wellbeing {
                        ElementIcon(element: "lotus", size: 14)
                            .opacity(on ? 1.0 : (hover ? 0.85 : 0.45))
                    } else {
                        Text(on ? "●" : (hover ? "◉" : "○"))
                            .font(mono(13)).foregroundColor(on ? green : (hover ? green : dim))
                    }
                }
                .scaleEffect(hover ? 1.25 : 1)
                .frame(width: 16).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { hover = $0 }
            .animation(.easeOut(duration: 0.12), value: hover)
            .help(on ? (wellbeing ? "wisdom absorbed" : "untick") : (wellbeing ? "tap to absorb it" : "tick, it counts"))

            StarBurst(trigger: $burstTrigger, element: element).offset(x: 14, y: -10)
        }
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
            Tick(on: task.done, element: element(for: task.category)) { model.toggleTask(task) }
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
                        Tick(on: model.habitDone("Morning manifestations"), element: "lotus", wellbeing: true) {
                            model.toggleHabit("Morning manifestations")
                        }
                        TypewriterText(text: model.manifestation, italic: true, color: bright)
                        Spacer(minLength: 4)
                        StreakBadge(n: model.streak("Morning manifestations"))
                    }
                    HStack(alignment: .top, spacing: 7) {
                        Tick(on: model.habitDone("Read reminders"), element: "lotus", wellbeing: true) {
                            model.toggleHabit("Read reminders")
                        }
                        TypewriterText(text: model.reminder, speed: 0.012, color: fg)
                        Spacer(minLength: 4)
                        StreakBadge(n: model.streak("Read reminders"))
                    }
                    HStack(alignment: .top, spacing: 7) {
                        Tick(on: model.habitDone("Journal feelings"), element: "lotus", wellbeing: true) {
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
                                ElementIcon(element: element(for: cat), size: 12)
                                Text("\(model.categoryStars(cat))").font(mono(11)).foregroundColor(green)
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
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(bg)
    }
}

// MARK: - schedule view

// pixels-per-minute used for both block height and drag-to-resize conversion
let PT_PER_MIN: CGFloat = 0.5

// A thin grip at the bottom edge of a block: drag down to lengthen, up to shorten.
// Live-previews the height during the drag, snaps to 5-min steps, commits (one write)
// only on release -- so dragging doesn't spam the vault file with every pixel of motion.
struct ResizeHandle: View {
    let onCommit: (Int) -> Void
    @State private var dragMinutes: Int = 0
    @State private var hovering = false
    @Binding var livePreview: Int

    var body: some View {
        Rectangle()
            .fill(hovering ? green.opacity(0.35) : dim.opacity(0.25))
            .frame(height: 5)
            .overlay(
                RoundedRectangle(cornerRadius: 1).fill(hovering ? green : dim).frame(width: 28, height: 2)
            )
            .contentShape(Rectangle().inset(by: -4))
            .onHover { h in
                hovering = h
                if h { NSCursor.resizeUpDown.set() } else { NSCursor.arrow.set() }
            }
            .gesture(
                DragGesture(minimumDistance: 1)
                    .onChanged { v in
                        let raw = Int((v.translation.height / PT_PER_MIN / 5).rounded()) * 5
                        dragMinutes = raw
                        livePreview = raw
                    }
                    .onEnded { _ in
                        if dragMinutes != 0 { onCommit(dragMinutes) }
                        dragMinutes = 0
                        livePreview = 0
                    }
            )
    }
}

struct ScheduleRow: View {
    let block: ScheduleBlock
    let isNew: Bool
    let model: ScheduleModel
    @State private var showMoveTo = false
    @State private var moveDate = Date()
    @State private var liveDelta = 0

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(block.start)–\(addMinutes(block.start, block.duration_min + liveDelta))")
                        .font(mono(10)).foregroundColor(dim)
                    HStack(spacing: 4) {
                        Text(block.isOpen ? "open" : block.label)
                            .font(mono(12)).foregroundColor(block.isOpen ? dim : fg)
                            .italic(block.isOpen)
                        if isNew {
                            Text("new").font(mono(9, .semibold)).foregroundColor(bright)
                                .padding(.horizontal, 4).padding(.vertical, 1)
                                .background(RoundedRectangle(cornerRadius: 3).fill(green.opacity(0.3)))
                        }
                    }
                }
                Spacer()
                if !block.isOpen {
                    Button(action: { showMoveTo = true }) {
                        Text("📅").font(mono(11))
                    }.buttonStyle(.plain)
                    .popover(isPresented: $showMoveTo) {
                        VStack(spacing: 8) {
                            DatePicker("move to", selection: $moveDate, displayedComponents: .date)
                                .datePickerStyle(.graphical).labelsHidden()
                            Button("move") { model.delete(block.id, mode: .moveTo(moveDate)); showMoveTo = false }
                        }.padding(12)
                    }
                    Button(action: { model.delete(block.id, mode: .notToday) }) {
                        Text("✕").font(mono(11))
                    }.buttonStyle(.plain).foregroundColor(dim)
                }
            }
            .padding(.vertical, 4).padding(.horizontal, 6)
            .frame(minHeight: max(28, CGFloat(block.duration_min + liveDelta) * PT_PER_MIN), alignment: .top)

            if !block.isOpen {
                ResizeHandle(onCommit: { model.resize(block.id, deltaMinutes: $0) }, livePreview: $liveDelta)
                    .padding(.horizontal, 6)
            }
        }
        .background(RoundedRectangle(cornerRadius: 5)
            .fill(block.isOpen ? Color.clear : Color.white.opacity(0.04)))
        .overlay(RoundedRectangle(cornerRadius: 5)
            .stroke(block.isOpen ? dim.opacity(0.3) : Color.clear, style: StrokeStyle(lineWidth: 1, dash: [3])))
    }
}

struct ScheduleView: View {
    @ObservedObject var model: ScheduleModel
    var body: some View {
        List {
            ForEach(model.blocks) { b in
                ScheduleRow(block: b, isNew: model.newlyAdded.contains(b.id), model: model)
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            }
            .onMove(perform: model.move)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(bg)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - calendar view

struct CalendarView: View {
    @ObservedObject var model: CalendarModel
    @State private var showGrid = true
    @State private var monthAnchor = Date()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("", selection: $showGrid) {
                Text("month").tag(true)
                Text("list").tag(false)
            }.pickerStyle(.segmented).labelsHidden()

            if showGrid {
                monthGrid
            } else {
                listView
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(bg)
    }

    private var itemsByDay: [Date: [DueItem]] {
        let cal = Calendar.current
        return Dictionary(grouping: model.items) { cal.startOfDay(for: $0.due) }
    }

    private var monthGrid: some View {
        let cal = Calendar.current
        let start = cal.date(from: cal.dateComponents([.year, .month], from: monthAnchor))!
        let range = cal.range(of: .day, in: .month, for: start)!
        let firstWeekday = cal.component(.weekday, from: start) - 1
        let days = (0..<firstWeekday).map { _ in nil as Date? } +
                   range.map { cal.date(byAdding: .day, value: $0 - 1, to: start) }
        let byDay = itemsByDay

        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Button("←") { monthAnchor = cal.date(byAdding: .month, value: -1, to: monthAnchor)! }
                    .buttonStyle(.plain)
                Text(start, format: .dateTime.month(.wide).year()).font(mono(12, .semibold)).foregroundColor(bright)
                Button("→") { monthAnchor = cal.date(byAdding: .month, value: 1, to: monthAnchor)! }
                    .buttonStyle(.plain)
            }.foregroundColor(fg)

            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 7), spacing: 6) {
                ForEach(days.indices, id: \.self) { i in
                    if let day = days[i] {
                        let items = byDay[cal.startOfDay(for: day)] ?? []
                        VStack(spacing: 2) {
                            Text("\(cal.component(.day, from: day))").font(mono(11))
                                .foregroundColor(cal.isDateInToday(day) ? bright : fg)
                            if !items.isEmpty {
                                Circle().fill(green).frame(width: 5, height: 5)
                            }
                        }.frame(maxWidth: .infinity, minHeight: 28)
                    } else {
                        Color.clear.frame(minHeight: 28)
                    }
                }
            }
        }
    }

    private var listView: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 8) {
                if model.items.isEmpty {
                    Text("no deadlines set").font(mono(12)).foregroundColor(dim)
                }
                ForEach(model.items) { item in
                    HStack {
                        Text(item.due, format: .dateTime.day().month(.abbreviated))
                            .font(mono(11)).foregroundColor(dim).frame(width: 50, alignment: .leading)
                        Text(item.text).font(mono(12)).foregroundColor(fg)
                        Spacer()
                    }
                }
            }
        }
    }
}

// MARK: - root (tab switcher)

enum PlannerTab: String, CaseIterable { case today = "today", schedule = "schedule", calendar = "calendar" }

struct RootView: View {
    @ObservedObject var model: Model
    @ObservedObject var scheduleModel: ScheduleModel
    @ObservedObject var calendarModel: CalendarModel
    @State private var tab: PlannerTab = .today

    var body: some View {
        VStack(spacing: 0) {
            Picker("", selection: $tab) {
                ForEach(PlannerTab.allCases, id: \.self) { Text($0.rawValue) }
            }.pickerStyle(.segmented).labelsHidden().padding(12)

            switch tab {
            case .today: Dashboard(model: model)
            case .schedule: ScheduleView(model: scheduleModel)
            case .calendar: CalendarView(model: calendarModel)
            }
        }
        .background(bg)
    }
}

// MARK: - Aang mascot (body-sprite splash/idle)

enum MascotState { case idle, splash }

final class MascotModel: ObservableObject {
    @Published var state: MascotState = .idle

    func playSplash() {
        state = .splash
        // splash is a 4-frame sequence at 6fps (see SpriteAnimator) -> ~0.67s, then fall back to idle
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [weak self] in
            self?.state = .idle
        }
    }
}

struct SpriteAnimator: View {
    @ObservedObject var mascot: MascotModel
    @State private var frameIndex = 0
    @State private var frames: [NSImage] = []
    @State private var timer: Timer?

    var body: some View {
        Group {
            if frameIndex < frames.count {
                Image(nsImage: frames[frameIndex]).resizable().interpolation(.none)
                    .frame(width: 72, height: 72)
            }
        }
        .onAppear { load(for: mascot.state); start() }
        .onChange(of: mascot.state) { _, newState in load(for: newState) }
        .onDisappear { timer?.invalidate() }
    }

    private func folderName(_ s: MascotState) -> String { s == .idle ? "idle" : "splash" }

    private func load(for state: MascotState) {
        let dir = Bundle.main.bundleURL.deletingLastPathComponent()
            .appendingPathComponent("Assets/Sprites/\(folderName(state))")
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        frames = files.sorted { $0.lastPathComponent < $1.lastPathComponent }
            .compactMap { NSImage(contentsOf: $0) }
        frameIndex = 0
    }

    private func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 6.0, repeats: true) { _ in
            guard !frames.isEmpty else { return }
            frameIndex = (frameIndex + 1) % frames.count
        }
    }
}

// MARK: - menu bar + floating window (a real window, so nothing gets clipped)

final class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var window: NSWindow!
    let model = Model()
    let mascot = MascotModel()
    let scheduleModel = ScheduleModel()
    let calendarModel = CalendarModel()
    var watcher: VaultWatcher?

    func applicationDidFinishLaunching(_ n: Notification) {
        reloadAll()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        updateTitle()
        statusItem.button?.action = #selector(toggle)
        statusItem.button?.target = self

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 380, height: 640),
                          styleMask: [.titled, .closable, .fullSizeContentView, .resizable],
                          backing: .buffered, defer: false)
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.level = .floating
        window.backgroundColor = NSColor(red: 0.106, green: 0.106, blue: 0.106, alpha: 1)
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 420, height: 560)
        window.setFrameAutosaveName("EsmeDayWindow")
        window.contentView = NSHostingView(rootView:
            ZStack(alignment: .bottomTrailing) {
                RootView(model: model, scheduleModel: scheduleModel, calendarModel: calendarModel)
                SpriteAnimator(mascot: mascot)
                    .padding(12)
            }
        )

        // instant live-update: watch the vault for any change (Obsidian edits, WhatsApp
        // replies writing to the vault, this app's own writes), free local OS API, no cost.
        watcher = VaultWatcher(path: VAULT.path)
        watcher?.onChange = { [weak self] in self?.reloadAll(); self?.updateTitle() }

        // slow fallback in case an FSEvents notification is ever missed
        Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            self?.reloadAll(); self?.updateTitle()
        }
    }

    func reloadAll() {
        model.load()
        scheduleModel.load(currentTasks: model.tasks)
        calendarModel.load()
    }

    func updateTitle() {
        let done = model.tasks.filter { $0.done }.count
        if let icon = NSImage(contentsOf: assetsIconURL("lotus")) {
            icon.size = NSSize(width: 16, height: 16)
            statusItem.button?.image = icon
            statusItem.button?.imagePosition = .imageLeading
        }
        statusItem.button?.title = " \(done)/\(model.tasks.count)"
        statusItem.button?.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .medium)
    }

    @objc func toggle() {
        if window.isVisible { window.orderOut(nil); return }
        reloadAll(); updateTitle()
        if let btnWin = statusItem.button?.window, let screen = btnWin.screen {
            let btn = btnWin.frame
            var x = btn.midX - window.frame.width + 40
            x = min(max(x, screen.visibleFrame.minX + 8),
                    screen.visibleFrame.maxX - window.frame.width - 8)
            let y = screen.visibleFrame.maxY - window.frame.height - 6
            window.setFrameOrigin(NSPoint(x: x, y: y))
        }
        mascot.playSplash()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
