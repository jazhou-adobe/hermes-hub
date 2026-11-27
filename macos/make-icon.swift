// Renders the app icon into an .iconset folder: `swift make-icon.swift <out.iconset>`, then `iconutil -c icns`.
// Slate tile (Flight Director primary) with a Hermes-orange ring and H.
import AppKit

let out = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func color(_ hex: UInt32) -> NSColor {
  NSColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1)
}

func render(_ px: Int) -> Data {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                             hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  let s = CGFloat(px) / 1024

  // macOS icon grid: an 824 pt tile centred on a 1024 canvas.
  let tile = NSRect(x: 100 * s, y: 100 * s, width: 824 * s, height: 824 * s)
  let shape = NSBezierPath(roundedRect: tile, xRadius: 185 * s, yRadius: 185 * s)
  NSGradient(starting: color(0x2c3843), ending: color(0x161c22))!.draw(in: shape, angle: -90)

  let orange = color(0xd9773a)
  let ring = NSBezierPath(ovalIn: tile.insetBy(dx: 132 * s, dy: 132 * s))
  ring.lineWidth = 34 * s
  orange.setStroke()
  ring.stroke()

  // The H: two posts and a crossbar, drawn as shapes so no font is needed.
  orange.setFill()
  let cx = 512 * s, cy = 512 * s, h = 300 * s, w = 66 * s, gap = 120 * s
  NSBezierPath(roundedRect: NSRect(x: cx - gap - w, y: cy - h / 2, width: w, height: h), xRadius: 12 * s, yRadius: 12 * s).fill()
  NSBezierPath(roundedRect: NSRect(x: cx + gap, y: cy - h / 2, width: w, height: h), xRadius: 12 * s, yRadius: 12 * s).fill()
  NSBezierPath(rect: NSRect(x: cx - gap - 1, y: cy - w / 2 + 8 * s, width: 2 * gap + 2, height: w - 16 * s)).fill()

  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:])!
}

for size in [16, 32, 128, 256, 512] {
  try render(size).write(to: out.appendingPathComponent("icon_\(size)x\(size).png"))
  try render(size * 2).write(to: out.appendingPathComponent("icon_\(size)x\(size)@2x.png"))
}
