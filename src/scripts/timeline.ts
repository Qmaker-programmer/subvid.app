import { $, $$ } from "@/scripts/dom.ts"
import { formatClock } from "@/scripts/subtitles.ts"

type TimelineOptions = {
  ui: any
  currentSegments: () => any[]
  snapshotSegments: () => string
  pushHistory: (snapshotBefore: string) => void
  renderSegments: () => void
  enableExports: (on: boolean) => void
}

export function createTimelineController(options: TimelineOptions) {
  const { ui, currentSegments, snapshotSegments, pushHistory, renderSegments, enableExports } =
    options
  const TL_MIN_DUR = 0.3
  let tlPxPerSec = 90
  let tlDuration = 0
  let tlDrag: any = null
  let scrubbing = false
  let scrubRaf = 0
  let scrubTargetT = 0
  let playheadRaf = 0
  let phAnchorMedia = 0
  let phAnchorWall = 0

  function tlTotalDuration() {
    const segs = currentSegments()
    const segEnd = segs.length ? segs[segs.length - 1].end : 0
    return Math.max(tlDuration, segEnd, 1)
  }

  function renderTimeline() {
    if (!ui.timelineBlocks) return
    const segments = currentSegments()
    const dur = tlTotalDuration()
    ui.timelineTrack.style.width = `${dur * tlPxPerSec}px`

    let step = 1
    if (tlPxPerSec < 24) step = 15
    else if (tlPxPerSec < 45) step = 10
    else if (tlPxPerSec < 80) step = 5
    else if (tlPxPerSec < 140) step = 2
    else step = 1
    let ruler = ""
    for (let t = 0; t <= dur + 0.001; t += step) {
      const left = t * tlPxPerSec
      ruler += `<span class="tl-tick" style="left:${left}px"><i></i><b>${formatClock(t)}</b></span>`
    }
    ui.timelineRuler.innerHTML = ruler

    ui.timelineBlocks.innerHTML = ""
    segments.forEach((seg, index) => {
      const block = document.createElement("div")
      block.className = "tl-block"
      block.dataset.index = String(index)
      block.style.left = `${seg.start * tlPxPerSec}px`
      block.style.width = `${Math.max(TL_MIN_DUR, seg.end - seg.start) * tlPxPerSec}px`
      block.innerHTML = `
      <span class="tl-handle tl-handle-l" data-edge="start"></span>
      <span class="tl-block-label">${(seg.text || "—").replace(/</g, "&lt;")}</span>
      <span class="tl-handle tl-handle-r" data-edge="end"></span>
    `
      ui.timelineBlocks.appendChild(block)
    })
    updateTimelinePlayhead()
  }

  function updateTimelinePlayhead(timeOverride?: number) {
    if (!ui.timelinePlayhead) return
    const t = timeOverride ?? ui.video.currentTime ?? 0
    const x = t * tlPxPerSec
    ui.timelinePlayhead.style.transform = `translate3d(${x}px,0,0)`
    if (ui.tlClock)
      ui.tlClock.textContent = `${formatClock(t)} / ${formatClock(tlTotalDuration())}`
    if (!ui.video.paused && ui.timelineScroll) {
      const view = ui.timelineScroll
      if (
        x < view.scrollLeft + 60 ||
        x > view.scrollLeft + view.clientWidth - 60
      ) {
        view.scrollLeft = x - view.clientWidth * 0.4
      }
    }
  }

  function setTimelineActive(idx: number) {
    if (!ui.timelineBlocks) return
    $$(".tl-block.is-active", ui.timelineBlocks).forEach((el) =>
      el.classList.remove("is-active"),
    )
    if (idx >= 0) {
      $(`.tl-block[data-index="${idx}"]`, ui.timelineBlocks)?.classList.add(
        "is-active",
      )
    }
  }

  function scheduleScrubSeek() {
    if (scrubRaf) return
    scrubRaf = requestAnimationFrame(() => {
      scrubRaf = 0
      ui.video.currentTime = scrubTargetT
      updateCaption()
    })
  }

  function scrubToClientX(clientX: number) {
    const rect = ui.timelineTrack.getBoundingClientRect()
    const dur = tlTotalDuration()
    const t = Math.max(0, Math.min(dur, (clientX - rect.left) / tlPxPerSec))
    scrubTargetT = t
    if (ui.timelinePlayhead)
      ui.timelinePlayhead.style.transform = `translate3d(${t * tlPxPerSec}px,0,0)`
    if (ui.tlClock)
      ui.tlClock.textContent = `${formatClock(t)} / ${formatClock(dur)}`
    scheduleScrubSeek()
  }

  function endScrub() {
    if (!scrubbing) return
    scrubbing = false
    ui.timeline?.classList.remove("is-scrubbing")
  }

  function endTimelineDrag() {
    if (!tlDrag) return
    const { block, moved, seg, index, before } = tlDrag
    block.classList.remove("is-dragging")
    tlDrag = null
    if (moved) pushHistory(before)
    currentSegments().sort((a, b) => a.start - b.start)
    renderSegments()
    enableExports(true)
    if (!moved) {
      ui.video.currentTime = seg.start
      const newIndex = currentSegments().indexOf(seg)
      highlightSegment(newIndex >= 0 ? newIndex : index, { scrollSidebar: true })
    }
    updateCaption()
  }

  function togglePlay() {
    if (ui.video.paused) ui.video.play().catch(() => {})
    else ui.video.pause()
  }

  function reanchorPlayhead() {
    phAnchorMedia = ui.video.currentTime || 0
    phAnchorWall = performance.now()
  }

  function playheadLoop() {
    const real = ui.video.currentTime || 0
    const rate = ui.video.playbackRate || 1
    let predicted =
      phAnchorMedia + ((performance.now() - phAnchorWall) / 1000) * rate
    if (Math.abs(real - predicted) > 0.18 || real < predicted - 0.03) {
      reanchorPlayhead()
      predicted = real
    }
    updateTimelinePlayhead(Math.min(predicted, tlTotalDuration()))
    playheadRaf = requestAnimationFrame(playheadLoop)
  }

  function syncVolumeUi() {
    const muted = ui.video.muted || ui.video.volume === 0
    ui.timeline?.classList.toggle("is-muted", muted)
    if (ui.vpVolume) ui.vpVolume.value = String(muted ? 0 : ui.video.volume)
  }

  function isFullscreen() {
    const doc = document as any
    return (
      (doc.fullscreenElement || doc.webkitFullscreenElement) === ui.videoPreview
    )
  }

  function syncFullscreenUi() {
    ui.timeline?.classList.toggle("is-fullscreen", isFullscreen())
  }

  function scrollTimelineToBlock(index: number) {
    const view = ui.timelineScroll
    const seg = currentSegments()[index]
    if (!view || !seg) return
    const left = seg.start * tlPxPerSec
    const right = Math.max(left + TL_MIN_DUR * tlPxPerSec, seg.end * tlPxPerSec)
    if (
      left < view.scrollLeft + 8 ||
      right > view.scrollLeft + view.clientWidth - 8
    ) {
      view.scrollLeft = Math.max(0, left - view.clientWidth * 0.3)
    }
  }

  function highlightSegment(
    index: number,
    { scrollSidebar = false, scrollTimeline = false, touchSidebar = true } = {},
  ) {
    setTimelineActive(index)
    if (touchSidebar) {
      $$(".seg.is-active", ui.segList).forEach((el) =>
        el.classList.remove("is-active"),
      )
      if (index >= 0) {
        const li = $(`.seg[data-index="${index}"]`, ui.segList)
        if (li) {
          li.classList.add("is-active")
          if (scrollSidebar) li.scrollIntoView({ block: "nearest" })
        }
      }
    }
    if (scrollTimeline && index >= 0) scrollTimelineToBlock(index)
  }

  function updateCaption() {
    updateTimelinePlayhead()
    const segments = currentSegments()
    const editing = document.activeElement?.tagName === "TEXTAREA"
    if (!segments.length || !ui.video.duration) {
      ui.caption.textContent = ""
      highlightSegment(-1, { touchSidebar: !editing })
      return
    }
    const current = ui.video.currentTime
    const idx = segments.findIndex(
      (s) => current >= s.start && current <= s.end,
    )
    ui.caption.textContent = idx >= 0 ? segments[idx].text : ""
    highlightSegment(idx, { touchSidebar: !editing, scrollSidebar: !editing })
  }

  function wireTimeline() {
    ui.timelineTrack?.addEventListener("pointerdown", (event: any) => {
      if (event.target.closest(".tl-block")) return
      scrubbing = true
      ui.timeline?.classList.add("is-scrubbing")
      ui.timelineTrack.setPointerCapture?.(event.pointerId)
      event.preventDefault()
      scrubToClientX(event.clientX)
    })
    ui.timelineTrack?.addEventListener("pointermove", (event: any) => {
      if (scrubbing) scrubToClientX(event.clientX)
    })
    ui.timelineTrack?.addEventListener("pointerup", endScrub)
    ui.timelineTrack?.addEventListener("pointercancel", endScrub)

    ui.timelineBlocks?.addEventListener("pointerdown", (event: any) => {
      const block = event.target.closest(".tl-block")
      if (!block) return
      const handle = event.target.closest(".tl-handle")
      const index = Number(block.dataset.index)
      const seg = currentSegments()[index]
      if (!seg) return
      event.preventDefault()
      tlDrag = {
        index,
        seg,
        block,
        mode: handle ? handle.dataset.edge : "move",
        startX: event.clientX,
        origStart: seg.start,
        origEnd: seg.end,
        moved: false,
        before: snapshotSegments(),
      }
      block.setPointerCapture?.(event.pointerId)
      block.classList.add("is-dragging")
    })

    ui.timelineBlocks?.addEventListener("pointermove", (event: any) => {
      if (!tlDrag) return
      const dx = event.clientX - tlDrag.startX
      const dt = dx / tlPxPerSec
      if (Math.abs(dx) > 3) tlDrag.moved = true
      const dur0 = tlDrag.origEnd - tlDrag.origStart
      const { seg, mode } = tlDrag
      if (mode === "move") {
        const ns = Math.max(0, tlDrag.origStart + dt)
        seg.start = ns
        seg.end = ns + dur0
      } else if (mode === "start") {
        seg.start = Math.max(
          0,
          Math.min(tlDrag.origEnd - TL_MIN_DUR, tlDrag.origStart + dt),
        )
      } else {
        seg.end = Math.max(tlDrag.origStart + TL_MIN_DUR, tlDrag.origEnd + dt)
      }
      tlDrag.block.style.left = `${seg.start * tlPxPerSec}px`
      tlDrag.block.style.width = `${(seg.end - seg.start) * tlPxPerSec}px`
      const li = $(`.seg[data-index="${tlDrag.index}"]`, ui.segList)
      if (li) {
        const s = $<HTMLInputElement>(".t-start", li)
        const e = $<HTMLInputElement>(".t-end", li)
        if (s) s.value = formatClock(seg.start)
        if (e) e.value = formatClock(seg.end)
      }
      updateCaption()
    })

    ui.timelineBlocks?.addEventListener("pointerup", endTimelineDrag)
    ui.timelineBlocks?.addEventListener("pointercancel", endTimelineDrag)

    ui.tlPlay?.addEventListener("click", togglePlay)
    ui.video.addEventListener("click", togglePlay)
    ui.video.addEventListener("play", () => {
      ui.timeline?.classList.add("is-playing")
      cancelAnimationFrame(playheadRaf)
      reanchorPlayhead()
      playheadLoop()
    })
    ui.video.addEventListener("pause", () => {
      ui.timeline?.classList.remove("is-playing")
      cancelAnimationFrame(playheadRaf)
      playheadRaf = 0
      updateTimelinePlayhead()
    })
    ui.video.addEventListener("seeked", reanchorPlayhead)
    ui.video.addEventListener("ratechange", reanchorPlayhead)
    ui.video.addEventListener("timeupdate", updateCaption)
    ui.video.addEventListener("seeked", updateCaption)

    ui.vpMute?.addEventListener("click", () => {
      ui.video.muted = !ui.video.muted
      if (!ui.video.muted && ui.video.volume === 0) ui.video.volume = 1
    })
    ui.vpVolume?.addEventListener("input", () => {
      const v = Number(ui.vpVolume.value)
      ui.video.volume = v
      ui.video.muted = v === 0
    })
    ui.video.addEventListener("volumechange", syncVolumeUi)

    ui.vpFullscreen?.addEventListener("click", () => {
      const doc = document as any
      if (isFullscreen()) {
        ;(doc.exitFullscreen || doc.webkitExitFullscreen)?.call(document)
      } else {
        const el = ui.videoPreview as any
        ;(el?.requestFullscreen || el?.webkitRequestFullscreen)?.call(el)
      }
    })
    document.addEventListener("fullscreenchange", syncFullscreenUi)
    document.addEventListener("webkitfullscreenchange", syncFullscreenUi)
    syncVolumeUi()

    ui.tlZoomIn?.addEventListener("click", () => {
      tlPxPerSec = Math.min(400, tlPxPerSec * 1.4)
      renderTimeline()
    })
    ui.tlZoomOut?.addEventListener("click", () => {
      tlPxPerSec = Math.max(12, tlPxPerSec / 1.4)
      renderTimeline()
    })
    ui.video.addEventListener("loadedmetadata", () => {
      tlDuration = Number.isFinite(ui.video.duration) ? ui.video.duration : 0
      renderTimeline()
    })
  }

  wireTimeline()

  return {
    renderTimeline,
    highlightSegment,
    updateCaption,
    updateTimelinePlayhead,
  }
}
