// swift-tools-version:5.9
// Wraps the existing main.swift (built normally via the swiftc command in its header
// comment, unaffected by this file) so Xcode can open this folder directly and give
// SwiftUI Previews + a real debugger, without changing how the CLI build works.
import PackageDescription

let package = Package(
    name: "EsmeDay",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "EsmeDay",
            path: ".",
            // "Assets" only exists where the real (gitignored) sprite/icon/font assets have
            // been extracted -- e.g. the main checkout, not necessarily every worktree.
            // Harmless if missing (SPM just warns), needed where it's present.
            exclude: ["tools", "EsmeDay", "Fonts", "Assets"],
            sources: ["main.swift"],
            linkerSettings: [.linkedFramework("CoreServices")]
        )
    ]
)
