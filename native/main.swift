// esme's day — native macOS menu bar app (the "Usage for Claude" pattern).
// Lives in the menu bar; click for a popover card: today's focus, goal progress,
// habit streaks, stars. Reads the vault directly; no network, no dock icon.
// Build: swiftc -swift-version 5 -O main.swift -o EsmeDay

import AppKit
import SwiftUI

// MARK: - vault reading

let VAULT = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Desktop/Esme's Brain")

func read(_ rel: String) -> String {
    (try? String(contentsOf: VAULT.appendingPathComponent(rel), encoding: .utf8)) ?? ""
}

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

struct Goal: Identifiable { let id = UUID(); let name: String; let cur: Int; let tgt: Int }
struct Habit: Identifiable { let id = UUID(); let name: String; let done: Bool; let streak: Int }

final class Model: ObservableObject {
    @Published var goals: [Goal] = []
    @Published var habits: [Habit] = []
    @Published var focus: [String] = []
    @Published var starsToday = 0
    @Published var starsWeek = 0

    func load() {
        let cfg = read("Goals & Direction/Goals & Habits.md")
        goals = section(cfg, "Big goals").compactMap { line in
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
        focus = section(read("Daily/Focus.md"), "").isEmpty
            ? read("Daily/Focus.md").components(separatedBy: "\n")
                .filter { $0.hasPrefix("- ") }.map { String($0.dropFirst(2)) }
            : section(read("Daily/Focus.md"), "")
        let stars = jsonDict("Daily/stars.json")
        starsToday = stars[isoDay()] as? Int ?? 0
        starsWeek = (0..<7).reduce(0) { $0 + (stars[isoDay(-$1)] as? Int ?? 0) }
    }
}

// MARK: - the popover card

let bg = Color(red: 0.106, green: 0.106, blue: 0.106)
let fg = Color(red: 0.604, green: 0.604, blue: 0.510)
let bright = Color(red: 0.788, green: 0.788, blue: 0.678)
let green = Color(red: 0.561, green: 0.682, blue: 0.529)
let dim = Color(red: 0.396, green: 0.396, blue: 0.353)

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

struct Card: View {
    @ObservedObject var model: Model
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(Date(), format: .dateTime.weekday(.wide).day().month(.wide))
                    .font(.system(size: 14, weight: .semibold, design: .monospaced))
                    .foregroundColor(bright)
                Text("// one honest day at a time")
                    .font(.system(size: 11, design: .monospaced)).foregroundColor(dim)
            }
            if !model.focus.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("focus").font(.system(size: 10, design: .monospaced)).foregroundColor(dim)
                    ForEach(model.focus.prefix(3), id: \.self) { f in
                        Text("· " + f).font(.system(size: 12, design: .monospaced))
                            .foregroundColor(fg).lineLimit(1)
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("goals").font(.system(size: 10, design: .monospaced)).foregroundColor(dim)
                ForEach(model.goals) { g in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(g.name).font(.system(size: 12, design: .monospaced)).foregroundColor(fg)
                            Spacer()
                            Text("\(g.cur.formatted()) / \(g.tgt.formatted())")
                                .font(.system(size: 11, design: .monospaced)).foregroundColor(dim)
                        }
                        Bar(pct: Double(g.cur) / Double(g.tgt))
                    }
                }
            }
            VStack(alignment: .leading, spacing: 5) {
                Text("habits").font(.system(size: 10, design: .monospaced)).foregroundColor(dim)
                ForEach(model.habits) { h in
                    HStack(spacing: 6) {
                        Text(h.done ? "●" : "○").foregroundColor(h.done ? green : dim)
                        Text(h.name).font(.system(size: 12, design: .monospaced)).foregroundColor(fg)
                        Spacer()
                        Text(h.streak > 0 ? "🔥 \(h.streak)" : "·")
                            .font(.system(size: 11, design: .monospaced)).foregroundColor(green)
                    }
                }
            }
            HStack {
                Text(String(repeating: "★", count: min(model.starsToday, 10)) + (model.starsToday == 0 ? "·" : ""))
                    .foregroundColor(green)
                Text("today  ·  \(model.starsWeek) this week")
                    .font(.system(size: 11, design: .monospaced)).foregroundColor(dim)
            }
            Divider().overlay(dim.opacity(0.4))
            HStack(spacing: 14) {
                Link("dashboard", destination: URL(string: "https://esmerobinson.github.io/life-planner/")!)
                Link("vault", destination: URL(string: "obsidian://open?vault=Esme%27s%20Brain")!)
                Spacer()
                Button("quit") { NSApp.terminate(nil) }.buttonStyle(.plain).foregroundColor(dim)
            }
            .font(.system(size: 11, design: .monospaced)).foregroundColor(green)
        }
        .padding(18)
        .frame(width: 300)
        .background(bg)
    }
}

// MARK: - menu bar plumbing

final class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    let popover = NSPopover()
    let model = Model()

    func applicationDidFinishLaunching(_ n: Notification) {
        model.load()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        updateTitle()
        statusItem.button?.action = #selector(toggle)
        statusItem.button?.target = self
        popover.contentViewController = NSHostingController(rootView: Card(model: model))
        popover.behavior = .transient
        Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            self?.model.load(); self?.updateTitle()
        }
    }

    func updateTitle() {
        let done = model.habits.filter { $0.done }.count
        statusItem.button?.title = "✿ \(done)/\(model.habits.count)"
        statusItem.button?.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .medium)
    }

    @objc func toggle() {
        if popover.isShown { popover.performClose(nil); return }
        model.load(); updateTitle()
        if let btn = statusItem.button {
            popover.show(relativeTo: btn.bounds, of: btn, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKey()
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)   // menu bar only, no dock icon
app.run()
