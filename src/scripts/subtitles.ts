import { LANGS } from "@/scripts/languages.ts"

export type SubtitleSegment = {
  start: number
  end: number
  text: string
}

export function formatSrtTime(seconds: number): string {
  const c = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const h = Math.floor(c / 3600)
  const m = Math.floor((c % 3600) / 60)
  const s = Math.floor(c % 60)
  const ms = Math.floor((c - Math.floor(c)) * 1000)
  const p = (n: number, l = 2) => String(n).padStart(l, "0")
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`
}

export function formatClock(seconds: number): string {
  const c = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const m = Math.floor(c / 60)
  const s = Math.floor(c % 60)
  const cs = Math.round((c - Math.floor(c)) * 100)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${m}:${p(s)}.${p(cs)}`
}

export function parseClock(value: string): number | null {
  const match = String(value)
    .trim()
    .match(/^(\d+):(\d{1,2})(?:[.,](\d{1,3}))?$/)
  if (!match) return null
  const m = Number(match[1])
  const s = Number(match[2])
  const frac = match[3] ? Number(`0.${match[3]}`) : 0
  return m * 60 + s + frac
}

export function normalizeSegments(output: any): SubtitleSegment[] {
  if (!output || !Array.isArray(output.chunks)) {
    const text = output?.text?.trim()
    return text ? [{ start: 0, end: 6, text }] : []
  }
  return output.chunks
    .map((chunk: any, index: number) => {
      const range = Array.isArray(chunk.timestamp)
        ? chunk.timestamp
        : [index * 2, index * 2 + 2]
      const start = Number.isFinite(range[0]) ? range[0] : index * 2
      const end = Number.isFinite(range[1]) ? range[1] : start + 2
      return {
        start,
        end: Math.max(start + 0.35, end),
        text: (chunk.text || "").trim(),
      }
    })
    .filter((s: SubtitleSegment) => s.text.length > 0)
}

export function buildSrt(segments: SubtitleSegment[]): string {
  return segments
    .map(
      (s, i) =>
        `${i + 1}\n${formatSrtTime(s.start)} --> ${formatSrtTime(s.end)}\n${s.text}`,
    )
    .join("\n\n")
}

export function normalizeLanguageCode(code: string): string {
  if (!code) return ""
  const short = String(code).toLowerCase().slice(0, 2)
  return short in LANGS ? short : ""
}
