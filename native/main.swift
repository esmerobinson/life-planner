// esme's day — native macOS menu bar app.
// Click the ✿ in the menu bar -> a floating dashboard window (never clipped):
// today's tasks (each opens its project in Obsidian), manifestation + reminder of
// the day with "see more", a one-tap "make a journal entry" that opens today's note,
// goal bars, habit streaks, stars. Reads the vault directly.
// Build: swiftc -swift-version 5 -O main.swift -o EsmeDay

import AppKit
import SwiftUI
import CoreImage
import CoreImage.CIFilterBuiltins

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
func heading(_ s: CGFloat) -> Font {
    .custom("Avatar Airbender", size: s)
}

// Silkscreen by The Silkscreen Project Authors, SIL Open Font License --
// native/Fonts/Silkscreen-Regular.ttf / Silkscreen-Bold.ttf. Regular and Bold ship as
// two files sharing one family name ("Silkscreen") but distinct PostScript names
// ("Silkscreen-Regular" / "Silkscreen-Bold") -- so unlike a normal system font, asking
// for the family name at a bold Font.Weight will NOT reliably pick the bold file
// (NSFont(name:) resolution for a shared family name is ambiguous/first-match, not
// weight-aware). Look up by the PostScript name directly instead, verified via
// `python3 -c "from fontTools.ttLib import TTFont; ..."` against the two .ttf files.
// Sized a couple points larger than mono() at the same call site -- pixel/LCD-style
// fonts read smaller than their point size for legibility at these small UI sizes.
func pixelBody(_ s: CGFloat, _ w: Font.Weight = .regular) -> Font {
    .custom(w == .bold ? "Silkscreen-Bold" : "Silkscreen-Regular", size: s)
}

// Papyrus (real macOS system font, installed on every Mac -- no download/licensing
// needed) rendered with a slight pixellate filter for section/category headings, per
// explicit request ("can you pixelate it slightly"). NOT used for the date header,
// which stays on heading()/Avatar Airbender per prior work.
func assetsBorderURL(_ name: String) -> URL {
    (Bundle.main.resourceURL ?? Bundle.main.bundleURL)
        .appendingPathComponent("Assets/Border/\(name).png")
}

// Renders `text` in Papyrus via SwiftUI's ImageRenderer (used elsewhere in this
// codebase for test/verification snapshots -- here in production), then applies a
// mild CIFilter.pixellate() pass so the heading reads as "slightly" pixelated rather
// than blocky/illegible. Rendered at a fixed high-quality base size (2x the requested
// display size) and then scaled down for display, so the pixellate scale stays
// proportionally small relative to the glyph size.
@MainActor
enum PixelatedHeadingCache {
    static var images: [String: NSImage] = [:]

    static func render(text: String, size: CGFloat, color: Color) -> NSImage? {
        let nsColor = NSColor(color)
        let colorComponents = nsColor.cgColor.components ?? []
        let colorKey = colorComponents.map { String(format: "%.3f", $0) }.joined(separator: ",")
        let key = "\(text)|\(size)|\(colorKey)"
        if let cached = images[key] { return cached }

        let renderSize = size * 2
        let label = Text(text)
            .font(.custom("Papyrus", size: renderSize))
            .foregroundColor(color)
        let renderer = ImageRenderer(content: label)
        renderer.scale = 2 // retina-quality source before we pixellate it down
        guard let nsImage = renderer.nsImage,
              let tiff = nsImage.tiffRepresentation,
              let ciImage = CIImage(data: tiff) else { return nil }

        let filter = CIFilter.pixellate()
        filter.inputImage = ciImage
        // "Slight" pixellation: a small scale relative to the rendered glyph size --
        // 3px at 2x render scale reads as a subtle textured/pixel look, not blocky.
        filter.scale = 3.0

        let context = CIContext()
        guard let output = filter.outputImage,
              let cgImage = context.createCGImage(output, from: ciImage.extent) else { return nil }

        let result = NSImage(cgImage: cgImage, size: nsImage.size)
        images[key] = result
        return result
    }
}

struct PixelatedHeading: View {
    let text: String
    var size: CGFloat = 14
    var color: Color = bright

    var body: some View {
        if let img = PixelatedHeadingCache.render(text: text, size: size, color: color) {
            Image(nsImage: img)
                .resizable()
                .interpolation(.medium)
                .aspectRatio(contentMode: .fit)
                .frame(height: size * 1.3)
        } else {
            // Papyrus missing or renderer failed -- fall back to plain text rather
            // than showing nothing.
            Text(text).font(.custom("Papyrus", size: size)).foregroundColor(color)
        }
    }
}

struct SectionHeader: View {
    let title: String; var more: String? = nil
    var body: some View {
        HStack {
            PixelatedHeading(text: title, size: 11, color: dim)
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
            .font(italic ? pixelBody(13).italic() : pixelBody(13))
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

// Ornate blue bordered-frame graphic (native/Assets/Border/frame.png, cropped from
// docs/superpowers/fontsavatar.png -- see native/tools/extract_border.py) used as a
// 9-slice-able background for the CTA button, replacing a plain RoundedRectangle
// fill/stroke. The source frame is 207x143px with a measured ~16px ornate border
// ring on every edge and a flat-colored interior -- capInsets below keep that
// border ring a fixed size while the interior stretches to fit the button, so it
// doesn't look smeared/distorted at the button's actual (much smaller) size.
struct BorderFrame: View {
    var body: some View {
        if let img = NSImage(contentsOf: assetsBorderURL("frame")) {
            Image(nsImage: img)
                .resizable(capInsets: EdgeInsets(top: 16, leading: 16, bottom: 16, trailing: 16),
                           resizingMode: .stretch)
                .interpolation(.none)
        } else {
            RoundedRectangle(cornerRadius: 8).fill(green.opacity(0.16))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(green.opacity(0.5), lineWidth: 1))
        }
    }
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
        ElementIcon(element: element, size: 24)
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
                        ElementIcon(element: "lotus", size: 22)
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
                    Text(task.display).font(pixelBody(13))
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
                    // Real scalable font (Avatar Airbender.ttf via heading()), reverted
                    // from the bitmap-letter PixelText experiment -- preferred look.
                    // Constrained to a width that clears the mascot's top-right corner
                    // (SpriteAnimator, ~100pt + padding) so long dates (e.g. "Wednesday 24
                    // September") shrink to fit that single line instead of running under him.
                    Text(headerDateString())
                        .font(heading(30))
                        .foregroundColor(bright)
                        .lineLimit(1)
                        .minimumScaleFactor(0.55)
                        .frame(maxWidth: 230, alignment: .leading)
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
                                PixelatedHeading(text: cat.lowercased(), size: 15, color: bright)
                                ElementIcon(element: element(for: cat), size: 20)
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
                        Text("✎  make a journal entry now?").font(pixelBody(13))
                        Spacer()
                        Text("→").font(mono(12))
                    }
                    .padding(.vertical, 9).padding(.horizontal, 16)
                    .background(BorderFrame())
                    .foregroundColor(bright)
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
            .padding(.bottom, 20)
        }
        .frame(width: 370, height: 660)
        .background(bg)
        // Mascot now lives in the top-trailing corner (see AppDelegate) instead of
        // sitting over scrolled content, so hover detection for the .standing state
        // can live on the whole dashboard without worrying about the old bottom band.
        .onHover { hovering in mascot.setHovering(hovering) }
    }
}

// MARK: - Aang mascot (body-sprite splash/idle)

enum MascotState { case idle, splash, reaction, standing }

final class MascotModel: ObservableObject {
    @Published var state: MascotState = .idle
    // Set while the mouse hovers the dashboard (see Dashboard's .onHover). Doesn't
    // interrupt a one-shot splash/reaction pass in progress -- it only decides which
    // resting state to settle into: once those passes finish, and whenever hovering
    // starts/stops while already at rest, we land on .standing instead of .idle.
    private var isHovering = false
    private var restState: MascotState { isHovering ? .standing : .idle }

    func playSplash() {
        state = .splash
        // splash is a 6-frame sequence at 6fps -> 1.0s, then settle to rest
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self else { return }
            self.state = self.restState
        }
    }

    func playReaction() {
        state = .reaction
        // reaction is a 7-frame sequence at 6fps -> ~1.17s, then settle to rest
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            guard let self else { return }
            self.state = self.restState
        }
    }

    func setHovering(_ hovering: Bool) {
        isHovering = hovering
        // Only switch immediately if currently settled at rest -- a splash/reaction
        // pass already in flight should finish and settle via the timers above,
        // which will pick up the new isHovering value at that point.
        if state == .idle || state == .standing {
            state = restState
        }
    }
}

struct SpriteAnimator: View {
    @ObservedObject var mascot: MascotModel
    @State private var frameIndex = 0
    @State private var direction = 1
    @State private var frames: [NSImage] = []
    @State private var timer: Timer?

    // Idle pacing: rather than continuously ping-ponging at 6fps forever, idle
    // mostly holds still on the resting frame (frame 0) and only occasionally
    // does one full bounce pass -- "sits and blinks", not a constant wiggle.
    @State private var idlePaused = true
    @State private var idlePauseTicksLeft = SpriteAnimator.idlePauseTicks

    static let tickHz = 6.0
    // Was 2.5s -- with an ~8-frame bounce pass at 6fps (~2.33s) that read as closer to
    // 50/50 active/still than the intended "mostly holds still, occasionally bounces"
    // feel (flagged in a prior review). Bumped to 7s so idle spends most of its time
    // resting, with only occasional movement.
    static let idlePauseSeconds = 7.0
    static let idlePauseTicks = Int(idlePauseSeconds * tickHz)

    var body: some View {
        Group {
            if frameIndex < frames.count {
                Image(nsImage: frames[frameIndex]).resizable().interpolation(.none)
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 100, height: 100)
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
        case .standing: return "standing"
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
        idlePaused = true
        idlePauseTicksLeft = Self.idlePauseTicks
    }

    private func start() {
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / Self.tickHz, repeats: true) { _ in
            guard !frames.isEmpty else { return }
            switch mascot.state {
            case .idle:
                if frames.count == 1 { frameIndex = 0; return }
                if idlePaused {
                    // holding on the resting frame between bounce passes
                    frameIndex = 0
                    idlePauseTicksLeft -= 1
                    if idlePauseTicksLeft <= 0 { idlePaused = false; direction = 1 }
                    return
                }
                // one full bounce pass: 0 -> last -> back to 0, then pause again
                let next = frameIndex + direction
                if next >= frames.count {
                    direction = -1
                    frameIndex = frames.count - 2
                } else if next < 0 {
                    frameIndex = 0
                    idlePaused = true
                    idlePauseTicksLeft = Self.idlePauseTicks
                } else {
                    frameIndex = next
                }
            case .standing:
                // loops continuously while hovering -- same ping-pong feel as the
                // old always-on idle oscillation, just under a different state
                if frames.count == 1 { frameIndex = 0; return }
                var next = frameIndex + direction
                if next >= frames.count { direction = -1; next = frames.count - 2 }
                else if next < 0 { direction = 1; next = 1 }
                frameIndex = next
            case .splash, .reaction:
                // one-shot states play forward-only; MascotModel reverts to a
                // resting state (.idle or .standing) on its own timeout
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
        // Silkscreen by The Silkscreen Project Authors, SIL Open Font License --
        // native/Fonts/Silkscreen-Regular.ttf / Silkscreen-Bold.ttf (Google Fonts family).
        // Used for primary body text (pixelBody()) -- a pixel/LCD-style Game Boy dialogue
        // look for task rows, manifestation/reminder text, and the journal CTA.
        for silkscreenName in ["Silkscreen-Regular.ttf", "Silkscreen-Bold.ttf"] {
            let url = (Bundle.main.resourceURL ?? Bundle.main.bundleURL).appendingPathComponent("Fonts/\(silkscreenName)")
            var err: Unmanaged<CFError>?
            if !CTFontManagerRegisterFontsForURL(url as CFURL, .process, &err) {
                print("Warning: failed to register font at \(url.path): \(String(describing: err?.takeUnretainedValue()))")
            }
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
            ZStack(alignment: .topTrailing) {
                Dashboard(model: model, mascot: mascot)
                SpriteAnimator(mascot: mascot)
                    // Top-right corner: clear of the window's close button (top-left)
                    // and the date header (top-left, width-capped to stay clear of him --
                    // see Dashboard). 14pt padding on trailing/top keeps him inset from
                    // both window edges at his new slightly-larger 100x100 size.
                    .padding(.top, 14)
                    .padding(.trailing, 14)
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
