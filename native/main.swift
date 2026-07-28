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

// Weekday + day + month string for the date header, e.g. "Tuesday 28 July" -- matches
// the components of the old `.dateTime.weekday(.wide).day().month(.wide)` format style,
// but as a plain String since PixelText renders letter-images, not a Font.
func headerDateString() -> String {
    let d = Date()
    let day = Calendar.current.component(.day, from: d)
    let f1 = DateFormatter(); f1.dateFormat = "EEEE"
    let f2 = DateFormatter(); f2.dateFormat = "MMMM"
    return "\(f1.string(from: d)) \(day) \(f2.string(from: d))"
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

// Avatar Airbender font (native/Fonts/Avatar Airbender.ttf) -- header/title text only;
// body text stays on mono() for small-size readability.
// Currently unused (date header now renders via PixelText, see below) -- kept in case
// a future spot wants a real scalable display font again.
func heading(_ s: CGFloat) -> Font {
    .custom("Avatar Airbender", size: s)
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
    (Bundle.main.resourceURL ?? Bundle.main.bundleURL)
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

// Bitmap "font" made of separate letter images extracted from a pixel-art reference
// sheet (see native/tools -- upper_A.png..upper_Z.png / lower_a.png..lower_z.png in
// Assets/Font/). SwiftUI has no built-in way to lay out text from per-glyph images, so
// PixelText does it manually: one Image per matched character, HStack'd left to right.
// Only A-Z/a-z have glyphs (the reference sheet has no digit glyphs at all); anything
// else (digits, punctuation, spaces) falls back to rendering inline via mono() in the
// app's regular font/color, since this is a display font for short strings like the
// date header, not a general-purpose typesetting system.
func fontLetterURL(_ ch: Character) -> URL? {
    let base = (Bundle.main.resourceURL ?? Bundle.main.bundleURL).appendingPathComponent("Assets/Font")
    if ch.isASCII, ("A"..."Z").contains(ch) {
        return base.appendingPathComponent("upper_\(ch).png")
    }
    if ch.isASCII, ("a"..."z").contains(ch) {
        return base.appendingPathComponent("lower_\(ch).png")
    }
    return nil
}

// Simple static cache so repeated PixelText renders (e.g. the date header redrawing)
// don't re-hit the filesystem every time -- same idea as SpriteAnimator's frame arrays,
// just keyed by character instead of reloaded per state change.
enum PixelFontCache {
    static var images: [Character: NSImage] = [:]
    static func image(for ch: Character) -> NSImage? {
        if let cached = images[ch] { return cached }
        guard let url = fontLetterURL(ch), let img = NSImage(contentsOf: url) else { return nil }
        images[ch] = img
        return img
    }
}

struct PixelText: View {
    let text: String
    var size: CGFloat = 20
    var fallbackColor: Color = bright
    // Optional width budget: long dates (e.g. "Wednesday 24 September") can otherwise
    // outgrow the fixed-width window at larger sizes, so when a maxWidth is given the
    // whole string scales itself down just enough to fit rather than clipping.
    var maxWidth: CGFloat? = nil

    // Natural (unshrunk) width of `text` rendered at `size`, matching the per-glyph
    // widths used below -- bitmap glyph aspect ratio, or measured fallback-font width
    // for characters (digits, spaces, punctuation) with no bitmap in the sheet.
    private static func naturalWidth(text: String, size: CGFloat) -> CGFloat {
        var total: CGFloat = 0
        var n = 0
        for ch in text {
            n += 1
            if let img = PixelFontCache.image(for: ch) {
                total += size * (img.size.width / max(img.size.height, 1))
            } else {
                let font = NSFont.monospacedSystemFont(ofSize: size * 0.7, weight: .regular)
                total += (String(ch) as NSString).size(withAttributes: [.font: font]).width
            }
        }
        if n > 1 { total += size * 0.08 * CGFloat(n - 1) }
        return total
    }

    private var effectiveSize: CGFloat {
        guard let maxWidth else { return size }
        let natural = Self.naturalWidth(text: text, size: size)
        guard natural > maxWidth, natural > 0 else { return size }
        return size * (maxWidth / natural)
    }

    var body: some View {
        let s = effectiveSize
        HStack(alignment: .bottom, spacing: s * 0.08) {
            ForEach(Array(text.enumerated()), id: \.offset) { _, ch in
                if let img = PixelFontCache.image(for: ch) {
                    let w = s * (img.size.width / max(img.size.height, 1))
                    Image(nsImage: img).resizable().interpolation(.none)
                        .frame(width: w, height: s)
                } else {
                    // No bitmap glyph for this character (digits, punctuation, etc. --
                    // the extracted reference sheet only has A-Z/a-z). Fall back to the
                    // app's regular font instead of a blank gap, so e.g. day numbers
                    // in the date header stay visible.
                    Text(String(ch)).font(mono(s * 0.7)).foregroundColor(fallbackColor)
                        .frame(height: s)
                }
            }
        }
    }
}

struct StarBurst: View {
    @Binding var trigger: Int
    let element: String   // "air" | "water" | "fire" | "earth" | "lotus"
    @State private var scale: CGFloat = 0
    @State private var opacity: Double = 0
    var body: some View {
        ElementIcon(element: element, size: 20)
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
                        ElementIcon(element: "lotus", size: 18)
                            .opacity(on ? 1.0 : (hover ? 0.85 : 0.45))
                    } else {
                        Text(on ? "●" : (hover ? "◉" : "○"))
                            .font(mono(13)).foregroundColor(on ? green : (hover ? green : dim))
                    }
                }
                .scaleEffect(hover ? 1.25 : 1)
                .frame(width: 20).contentShape(Rectangle())
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
    let mascot: MascotModel
    @State private var hover = false
    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            Tick(on: task.done, element: element(for: task.category)) {
                if !task.done { mascot.playReaction() }
                model.toggleTask(task)
            }
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
    let mascot: MascotModel
    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    // maxWidth accounts for the 20pt horizontal padding on each side of
                    // the window content -- long dates (e.g. "Wednesday 24 September")
                    // shrink themselves to fit rather than clipping against the window edge.
                    PixelText(text: headerDateString(), size: 28, maxWidth: 330)
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
                                ElementIcon(element: element(for: cat), size: 16)
                                Text("\(model.categoryStars(cat))").font(mono(11)).foregroundColor(green)
                                Spacer()
                            }.padding(.top, 4)
                            ForEach(items) { TaskRow(task: $0, model: model, mascot: mascot) }
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
            .padding(.horizontal, 20).padding(.top, 20)
            // Extra bottom breathing room: the mascot overlay is fixed to the window's
            // bottom-trailing corner (outside this ScrollView) at 90x90 + 12pt padding,
            // so it can cover the last ~102pt of content once scrolled all the way down.
            // Padding the footer row clear of that band keeps "quit" etc. legible instead
            // of getting sat on by Aang.
            .padding(.bottom, 110)
        }
        .frame(width: 370, height: 660)
        .background(bg)
    }
}

// MARK: - Aang mascot (body-sprite splash/idle)

enum MascotState { case idle, splash, reaction }

final class MascotModel: ObservableObject {
    @Published var state: MascotState = .idle

    func playSplash() {
        state = .splash
        // splash is a 6-frame sequence at 6fps -> 1.0s, then fall back to idle
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.state = .idle
        }
    }

    func playReaction() {
        state = .reaction
        // reaction is a 7-frame sequence at 6fps -> ~1.17s, then fall back to idle
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            self?.state = .idle
        }
    }
}

struct SpriteAnimator: View {
    @ObservedObject var mascot: MascotModel
    @State private var frameIndex = 0
    @State private var direction = 1
    @State private var frames: [NSImage] = []
    @State private var timer: Timer?

    var body: some View {
        Group {
            if frameIndex < frames.count {
                Image(nsImage: frames[frameIndex]).resizable().interpolation(.none)
                    .frame(width: 90, height: 90)
            }
        }
        .onAppear { load(for: mascot.state); start() }
        .onChange(of: mascot.state) { _, newState in load(for: newState) }
        .onDisappear { timer?.invalidate() }
    }

    private func folderName(_ s: MascotState) -> String {
        switch s {
        case .idle: return "idle"
        case .splash: return "splash"
        case .reaction: return "reaction"
        }
    }

    private func load(for state: MascotState) {
        let dir = (Bundle.main.resourceURL ?? Bundle.main.bundleURL)
            .appendingPathComponent("Assets/Sprites/\(folderName(state))")
        let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
        frames = files.sorted { $0.lastPathComponent < $1.lastPathComponent }
            .compactMap { NSImage(contentsOf: $0) }
        frameIndex = 0
        direction = 1
    }

    private func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 6.0, repeats: true) { _ in
            guard !frames.isEmpty else { return }
            if mascot.state == .idle {
                // ping-pong: bounce back and forth across the sequence instead
                // of hard-cutting back to frame 0, so the resting pose oscillates
                if frames.count == 1 { frameIndex = 0; return }
                var next = frameIndex + direction
                if next >= frames.count { direction = -1; next = frames.count - 2 }
                else if next < 0 { direction = 1; next = 1 }
                frameIndex = next
            } else {
                // one-shot states (splash, reaction) play forward-only;
                // MascotModel reverts to .idle on its own timeout
                frameIndex = (frameIndex + 1) % frames.count
            }
        }
    }
}

// MARK: - menu bar + floating window (a real window, so nothing gets clipped)

final class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var window: NSWindow!
    let model = Model()
    let mascot = MascotModel()

    func applicationDidFinishLaunching(_ n: Notification) {
        // Avatar Airbender font by FontGet.com (free for personal/commercial use, credit required) -- native/Fonts/
        let fontURL = (Bundle.main.resourceURL ?? Bundle.main.bundleURL).appendingPathComponent("Fonts/Avatar Airbender.ttf")
        var fontRegisterError: Unmanaged<CFError>?
        if !CTFontManagerRegisterFontsForURL(fontURL as CFURL, .process, &fontRegisterError) {
            print("Warning: failed to register font at \(fontURL.path): \(String(describing: fontRegisterError?.takeUnretainedValue()))")
        }
        model.load()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        updateTitle()
        statusItem.button?.action = #selector(toggle)
        statusItem.button?.target = self

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 370, height: 660),
                          styleMask: [.titled, .closable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.level = .floating
        window.backgroundColor = NSColor(red: 0.976, green: 0.937, blue: 0.890, alpha: 1)
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView:
            ZStack(alignment: .bottomTrailing) {
                Dashboard(model: model, mascot: mascot)
                SpriteAnimator(mascot: mascot)
                    .padding(12)
                    .allowsHitTesting(false)
            }
        )

        Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            self?.model.load(); self?.updateTitle()
        }
    }

    func updateTitle() {
        let done = model.tasks.filter { $0.done }.count
        if let icon = NSImage(contentsOf: assetsIconURL("lotus")) {
            icon.isTemplate = true
            icon.size = NSSize(width: 16, height: 16)
            statusItem.button?.image = icon
            statusItem.button?.imagePosition = .imageLeading
            statusItem.button?.title = " \(done)/\(model.tasks.count)"
        } else {
            statusItem.button?.image = nil
            statusItem.button?.title = "✿ \(done)/\(model.tasks.count)"
        }
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
