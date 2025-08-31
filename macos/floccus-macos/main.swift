//
//  main.swift
//  bookmarkd
//
//  Stand-alone XPC service that reads/writes Safari’s Bookmarks.plist
//

import Foundation

// MARK: - JSON-RPC bridge

enum Command: String, CaseIterable {
    case ping
    case getBookmarksTree, createBookmark, updateBookmark, removeBookmark
    case createFolder, updateFolder, removeFolder, orderFolder
}

// MARK: - Codable Any wrapper
struct AnyCodable: Codable {
    let value: Any
    init(_ value: Any) { self.value = value }
    init(from decoder: Decoder) throws { value = try decoder.singleValueContainer().decode(String.self) }
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(String(describing: value))
    }
}

struct Request: Codable {
    let cmd: String
    let payload: [String: AnyCodable]?
}

struct Response<T: Codable>: Codable {
    let success: Bool
    let data: T?
    let error: String?
}

// MARK: - Plist helpers

private let bookmarksURL: URL = {
    FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Safari/Bookmarks.plist")
}()

private func readSafariPlist() throws -> [String: Any] {
    guard let data = try? Data(contentsOf: bookmarksURL) else { return [:] }
    return try PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any] ?? [:]
}

private func writeSafariPlist(_ dict: [String: Any]) throws {
    let plistData = try PropertyListSerialization.data(fromPropertyList: dict, format: .xml, options: 0)
    try plistData.write(to: bookmarksURL, options: .atomic)
}

// MARK: - Command implementations
private enum HandleError: Error { case badRequest }

private func handle(request: Request) throws -> Any {
    switch Command(rawValue: request.cmd) {
    case .ping:
        return true

    case .getBookmarksTree:
        let dict = try readSafariPlist()
        return dict["Children"] as? [[String: Any]] ?? []

    case .createBookmark:
        guard let payload = request.payload,
              let title = payload["title"]?.value as? String,
              let url   = payload["url"]?.value as? String else { throw HandleError.badRequest }
        let id = UUID().uuidString
        var dict = try readSafariPlist()
        var bar = dict["BookmarksBar"] as? [String: Any] ?? [:]
        var children = bar["Children"] as? [[String: Any]] ?? []
        children.append([
            "Title": title,
            "URLString": url,
            "WebBookmarkType": "WebBookmarkTypeLeaf",
            "WebBookmarkUUID": id
        ])
        bar["Children"] = children
        dict["BookmarksBar"] = bar
        try writeSafariPlist(dict)
        return id

    case .updateBookmark:
        guard let payload = request.payload,
              let id    = payload["id"]?.value as? String,
              let title = payload["title"]?.value as? String,
              let url   = payload["url"]?.value as? String else { throw HandleError.badRequest }
        var dict = try readSafariPlist()
        guard var bar = dict["BookmarksBar"] as? [String: Any],
              var children = bar["Children"] as? [[String: Any]] else { return false }
        for (idx, child) in children.enumerated() {
            if child["WebBookmarkUUID"] as? String == id {
                var new = child
                new["Title"] = title
                new["URLString"] = url
                children[idx] = new
                break
            }
        }
        bar["Children"] = children
        dict["BookmarksBar"] = bar
        try writeSafariPlist(dict)
        return true

    case .removeBookmark:
        guard let id = request.payload?["id"]?.value as? String else { throw HandleError.badRequest }
        var dict = try readSafariPlist()
        guard var bar = dict["BookmarksBar"] as? [String: Any],
              var children = bar["Children"] as? [[String: Any]] else { return false }
        children.removeAll { $0["WebBookmarkUUID"] as? String == id }
        bar["Children"] = children
        dict["BookmarksBar"] = bar
        try writeSafariPlist(dict)
        return true

    case .createFolder:
        guard let title = request.payload?["title"]?.value as? String else { throw HandleError.badRequest }
        let id = UUID().uuidString
        var dict = try readSafariPlist()
        var bar = dict["BookmarksBar"] as? [String: Any] ?? [:]
        var children = bar["Children"] as? [[String: Any]] ?? []
        children.append([
            "Title": title,
            "WebBookmarkType": "WebBookmarkTypeList",
            "WebBookmarkUUID": id,
            "Children": []
        ])
        bar["Children"] = children
        dict["BookmarksBar"] = bar
        try writeSafariPlist(dict)
        return id

    case .updateFolder:
        guard let id = request.payload?["id"]?.value as? String,
              let title = request.payload?["title"]?.value as? String else { throw HandleError.badRequest }
        var dict = try readSafariPlist()
        guard var bar = dict["BookmarksBar"] as? [String: Any],
              var children = bar["Children"] as? [[String: Any]] else { return false }
        for (idx, child) in children.enumerated() {
            if child["WebBookmarkUUID"] as? String == id {
                var new = child
                new["Title"] = title
                children[idx] = new
                break
            }
        }
        bar["Children"] = children
        dict["BookmarksBar"] = bar
        try writeSafariPlist(dict)
        return true

    case .removeFolder:
        guard let id = request.payload?["id"]?.value as? String else { throw HandleError.badRequest }
        var dict = try readSafariPlist()
        guard var bar = dict["BookmarksBar"] as? [String: Any],
              var children = bar["Children"] as? [[String: Any]] else { return false }
        children.removeAll { $0["WebBookmarkUUID"] as? String == id }
        bar["Children"] = children
        dict["BookmarksBar"] = bar
        try writeSafariPlist(dict)
        return true

    case .orderFolder:
        guard let id = request.payload?["id"]?.value as? String,
              let orderedIds = request.payload?["orderedIds"]?.value as? [String] else { throw HandleError.badRequest }
        var dict = try readSafariPlist()
        guard var bar = dict["BookmarksBar"] as? [String: Any],
              var children = bar["Children"] as? [[String: Any]] else { return false }
        for (idx, child) in children.enumerated() {
            if child["WebBookmarkUUID"] as? String == id,
               var kids = child["Children"] as? [[String: Any]] {
                kids.sort { a, b in
                    let aID = a["WebBookmarkUUID"] as? String ?? ""
                    let bID = b["WebBookmarkUUID"] as? String ?? ""
                    let aIndex = orderedIds.firstIndex(of: aID) ?? Int.max
                    let bIndex = orderedIds.firstIndex(of: bID) ?? Int.max
                    return aIndex < bIndex
                }
                var new = child
                new["Children"] = kids
                children[idx] = new
                break
            }
        }
        bar["Children"] = children
        dict["BookmarksBar"] = bar
        try writeSafariPlist(dict)
        return true

    default:
        throw HandleError.badRequest
    }
}

// MARK: - XPC listener

@objc protocol BookmarkServiceProtocol {
    func handle(request: NSDictionary, with reply: @escaping (NSDictionary) -> Void)
}

final class ServiceImpl: NSObject, BookmarkServiceProtocol {
    func handle(request: NSDictionary, with reply: @escaping (NSDictionary) -> Void) {
        do {
            let data = try JSONSerialization.data(withJSONObject: request, options: [])
            let req = try JSONDecoder().decode(Request.self, from: data)
            let result: Any = try floccus_macos.handle(request: req)
            let resp: Response<AnyCodable> = Response(success: true, data: AnyCodable(result), error: nil)
            let json = try JSONEncoder().encode(resp)
            reply(try JSONSerialization.jsonObject(with: json, options: []) as! NSDictionary)
        } catch {
            let resp = Response<Bool>(success: false, data: nil, error: error.localizedDescription)
            let json = try! JSONEncoder().encode(resp)
            reply(try! JSONSerialization.jsonObject(with: json, options: []) as! NSDictionary)
        }
    }
}

final class ServiceDelegate: NSObject, NSXPCListenerDelegate {
    func listener(_ listener: NSXPCListener,
                  shouldAcceptNewConnection newConnection: NSXPCConnection) -> Bool {
        newConnection.exportedInterface = NSXPCInterface(with: BookmarkServiceProtocol.self)
        newConnection.exportedObject = ServiceImpl()
        newConnection.resume()
        return true
    }
}

// MARK: - Launch

let delegate = ServiceDelegate()
let listener = NSXPCListener(machServiceName: "org.handmadeideas.floccus-macos")
listener.delegate = delegate
listener.resume()
RunLoop.current.run()
