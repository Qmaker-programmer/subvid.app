import { captionStyle, FONT_STACKS, hexToRgba } from "@/scripts/subtitleStyle.ts"

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/)
  const lines = []
  let line = ""
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

export function drawSubtitlesAt(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  time: number,
  w: number,
  h: number,
  segments: any[],
) {
  const seg = segments.find((s) => time >= s.start && time <= s.end)
  if (!seg || !seg.text.trim()) return

  const c = captionStyle
  const fontSize = Math.round(h * 0.052 * c.size)
  ctx.font = `${c.weight} ${fontSize}px ${FONT_STACKS[c.font] || FONT_STACKS.sans}`
  ctx.textAlign = "center"
  ctx.textBaseline = "alphabetic"

  const lines = wrapText(ctx as CanvasRenderingContext2D, seg.text.trim(), w * 0.82)
  const lineHeight = fontSize * 1.28
  const padX = fontSize * 0.5
  const padY = fontSize * 0.3
  const blockH = lines.length * lineHeight
  let y
  if (c.position === "top") {
    y = h * 0.08 + fontSize
  } else if (c.position === "middle") {
    y = (h - blockH) / 2 + fontSize
  } else {
    y = h - h * 0.06 - (lines.length - 1) * lineHeight
  }

  lines.forEach((line) => {
    const metrics = ctx.measureText(line)
    if (c.bgEnabled) {
      const boxW = metrics.width + padX * 2
      const boxH = lineHeight + padY
      ctx.fillStyle = hexToRgba(c.bgColor, c.bgOpacity)
      const boxX = (w - boxW) / 2
      const boxY = y - fontSize - padY / 2
      const r = fontSize * 0.18
      ctx.beginPath()
      ctx.moveTo(boxX + r, boxY)
      ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, r)
      ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, r)
      ctx.arcTo(boxX, boxY + boxH, boxX, boxY, r)
      ctx.arcTo(boxX, boxY, boxX + boxW, boxY, r)
      ctx.closePath()
      ctx.fill()
    }

    if (!c.bgEnabled && c.outline) {
      ctx.lineWidth = Math.max(2, fontSize * 0.14)
      ctx.strokeStyle = "rgba(0, 0, 0, 0.85)"
      ctx.lineJoin = "round"
      ctx.miterLimit = 2
      ctx.strokeText(line, w / 2, y)
    } else if (!c.bgEnabled) {
      ctx.shadowColor = "rgba(0, 0, 0, 0.8)"
      ctx.shadowBlur = fontSize * 0.25
      ctx.shadowOffsetY = fontSize * 0.04
    }

    ctx.fillStyle = c.color
    ctx.fillText(line, w / 2, y)
    ctx.shadowColor = "transparent"
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
    y += lineHeight
  })
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  w: number,
  h: number,
  segments: any[],
) {
  ctx.drawImage(video, 0, 0, w, h)
  drawSubtitlesAt(ctx, video.currentTime, w, h, segments)
}
