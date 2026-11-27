#!/usr/bin/env bash
# Builds macos/build/Hermes Hub.app: a native window around the Command Center (docs/specs/macos-app.md).
# Needs only the Xcode command line tools (swiftc, iconutil, codesign). Drag the app anywhere afterwards.
set -euo pipefail
here=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)
root=$(dirname "$here")
version=$(sed -nE 's/^  "version": "([^"]+)".*/\1/p' "$root/package.json")
build="$here/build"
app="$build/Hermes Hub.app"
contents="$app/Contents"

rm -rf "$app" "$build/AppIcon.iconset"
mkdir -p "$contents/MacOS" "$contents/Resources"

swift "$here/make-icon.swift" "$build/AppIcon.iconset"
iconutil -c icns "$build/AppIcon.iconset" -o "$contents/Resources/AppIcon.icns"
rm -rf "$build/AppIcon.iconset"

swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework WebKit \
  "$here/HermesHub.swift" -o "$contents/MacOS/HermesHub"

cat >"$contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Hermes Hub</string>
  <key>CFBundleDisplayName</key><string>Hermes Hub</string>
  <key>CFBundleIdentifier</key><string>com.adobe.jazhou.hermes-hub</string>
  <key>CFBundleExecutable</key><string>HermesHub</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <!-- The Hub is plain HTTP on 127.0.0.1 (Phase 1); a Hub URL set in the app may use any host. -->
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSAllowsArbitraryLoadsInWebContent</key><true/>
  </dict>
</dict>
</plist>
PLIST

codesign --force --sign - "$app" # ad hoc: enough to run on this Mac
echo "built $app"
