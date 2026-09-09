# Floccus Local: realtime local bookmark sync for Windows

## Scope

Floccus Local synchronizes one selected bookmark folder between Chrome and Edge on the same Windows computer. In the recommended setup both profiles select the bookmarks bar, including all descendants. Creates, deletes, renames, URL edits, moves, and ordering are synchronized. Tabs, other bookmark roots, cloud upload, and cross-device sync are outside version 1.

Data stays in both browsers and a loopback-only service on `127.0.0.1`. Its database defaults to `%LOCALAPPDATA%\FloccusLocal\floccus-local.sqlite3`.

## Install

After extracting the service bundle, double-click `Floccus Local.cmd` in its root to open the menu. It generates and copies pairing codes, starts the service, toggles per-user startup, and shows diagnostics. Closing the menu leaves synchronization running.

1. Build the service bundle with `local-server\scripts\package-windows.ps1` under Node.js 24 LTS, or extract the delivered `floccus-local-service-windows.zip`. Keep a fixed installation directory and update it in place.
2. Choose “Start service” in the menu, then use “Set/remove startup” to configure automatic startup. The individual scripts remain available for troubleshooting.
3. Extract `floccus-local-v5.10.3-chrome-edge.zip` to a fixed directory for each browser. Enable Developer mode and load the unpacked extension in Chrome and Edge.
4. Choose “Generate pairing code” in the menu before connecting each browser. Codes are single-use, expire after 15 minutes, and must be generated separately for Chrome and Edge.
5. Add a Local realtime profile at `http://127.0.0.1:32145`, enter the code, and select the bookmarks bar. Keep realtime two-way sync, startup reconciliation, and the one-minute fallback check enabled.

## Migration from regular Floccus

Before the first run against real bookmarks:

1. Export bookmark HTML from Chrome and Edge and export the original Floccus profiles. Treat the browser state at migration time as authoritative.
2. Disable every other source that writes the same bookmark bar, including the matching original Floccus profiles and browser-account bookmark sync.
3. Initialize Chrome first, verify service version 1, and pin a backup in History.
4. Initialize Edge second. The initial merge uses Floccus tree mappings. It does not globally deduplicate equal URLs in different folders or duplicates already present on one side.
5. Verify counts, hierarchy, and ordering before enabling automatic sync on both sides. Keep the original profiles and exports until isolated and manual acceptance tests pass.

If the first two trees differ substantially, rehearse with isolated browser profiles. This build does not yet provide a complete item-by-item initial-import matching wizard.

## Runtime semantics

- Bookmark events are debounced for 300 ms, with a one-second maximum. The other browser synchronizes as soon as WebSocket announces a newer version.
- WebSocket heartbeats run every 20 seconds and reconnect with exponential backoff. Startup, background wake, and a one-minute fallback also compare versions.
- Deletion is a first-class two-way change; no URL union is used.
- Transactions validate a renewable lease, base version, and transaction ID. Retries are idempotent and no-op commits do not create versions.
- Lost responses are queried by transaction ID. The pending transaction, expected tree, cache, and mappings are persisted before commit so a browser restart can finish local state recovery.

## Conflicts and history

Conflicting edits of the same field, delete-versus-edit, folder delete-versus-descendant edit, incompatible moves, and contradictory ordering pause the profile with `E058`. The service retains the local tree, shared tree, details, and a pinned shared snapshot.

The profile page can use the complete shared side once or the complete current-browser side once. Shared selection is version-checked before download. Current-browser selection reserves a lease and resolves the conflict atomically with its mapped commit. Mixed item-by-item choices inside one conflict are not implemented in this build.

Every effective commit records snapshots. Unpinned snapshots retain 30 days and at least 100 versions. Manual, migration, and pre-restore snapshots remain pinned. Restore requires a change preview, rejects a stale preview or active sync lease, and creates a new version.

## Rollback

Disable both Floccus Local profiles, remove the startup launcher, stop the service, restore the exported bookmark HTML, and re-enable regular Floccus. Removing startup does not delete the database; retain `%LOCALAPPDATA%\FloccusLocal` while history may still be needed.

## Development

Run `npm test` in `local-server`, then `npm run typecheck`, `npm run lint`, `npm run build-win`, and `npm run package-local` at the repository root. Automated browser tests must use isolated Chrome and Edge user-data directories.
