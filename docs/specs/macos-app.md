# macOS app

Decided with the Human on 2026-11-27, choosing between a launcher, a menu-bar app and a window app. `Hermes Hub.app` is a native window around the Command Center. It shows the page and nothing else: starting, stopping and configuring the Hub stay with `bin/hermes-hub` (hub-operations spec).

## Build

`macos/build.sh` turns `macos/HermesHub.swift` (AppKit + WKWebView, one file) into `macos/build/Hermes Hub.app`, which is gitignored. It uses only the Xcode command line tools: `swiftc`, `iconutil` and an ad hoc `codesign`, so there's no Xcode project. `macos/make-icon.swift` draws the icon: a slate tile with a Hermes-orange ring and H. The bundle version follows `package.json`. The minimum system is macOS 13.

## Behaviour

| Area | Behaviour |
|---|---|
| Hub URL | **Hermes Hub → Hub URL… (⌘,)**. The default is `http://127.0.0.1:4747/`. It's stored in the app's user defaults (`com.adobe.jazhou.hermes-hub`, key `hubURL`) and must be `http(s)://host[:port]`. |
| Remote sign-in | A Hub on another Mac answers with Basic auth (security spec). The app shows one sign-in sheet per Hub (username, prefilled `hermes`; password; **Remember in Keychain**, on by default), however many page requests asked at once. A refused password shows the sheet again as "Wrong username or password" and drops a stale saved one. **Cancel** shows an in-app page with **Sign In** and **Change Hub URL…**. **Hermes Hub → Forget Saved Password** removes the saved password for the current Hub and reloads; WebKit keeps the session's sign-in until the app quits. Basic auth from any other site gets WebKit's default handling. |
| Hub unreachable | An in-app page names the URL and the error, with **Retry** and **Change Hub URL…**. |
| Navigation | Pages on the Hub's origin stay in the window. Any other link, `target=_blank` or `window.open` opens in the default browser. **View → Open in Browser (⇧⌘O)** opens the current page there. |
| Menus | The Edit menu is there so ⌘C/⌘V/⌘A reach the page. View has Reload (⌘R), Back/Forward (⌘[ / ⌘]), zoom (⌘0, ⌘+, ⌘−) and full screen. |
| Downloads | Saved to `~/Downloads` without overwriting an existing file, then shown in Finder. |
| Window | Size and position are remembered. Closing the window quits the app. |
| Notifications | WKWebView defines `Notification` (permission `default`), but the app has no permission prompt for it. A document-start script hides it, so Settings shows "Not supported" and the page reports `denied`. The Hub then posts its macOS notification fallback while the app is open. Mute, quiet hours and the In-page toasts switch apply as in a browser (command-center spec). |
| Storage | The page's local storage persists in the default WebKit data store. |

## Changes to other specs

None. The Command Center already handles a browser without notifications, through the hub-operations fallback.
