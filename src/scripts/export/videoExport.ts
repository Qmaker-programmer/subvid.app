import { drawFrame, drawSubtitlesAt } from "@/scripts/export/subtitleRenderer.ts"

type VideoExportOptions = {
  ui: any
  tt: (path: string, vars?: Record<string, unknown>) => string
  currentSegments: () => any[]
  selectedVideoFile: () => File | null
  activeLang: () => string
  baseFileName: () => string
  isExporting: () => boolean
  setExporting: (value: boolean) => void
  enableExports: (on: boolean) => void
  setStatus: (message: string, kind?: string) => void
  modal: any
}

export function createVideoExporter(options: VideoExportOptions) {
  const {
    ui,
    tt,
    currentSegments,
    selectedVideoFile,
    activeLang,
    baseFileName,
    isExporting,
    setExporting,
    enableExports,
    setStatus,
    modal,
  } = options

  function canUseWebCodecs() {
    return (
      typeof VideoEncoder !== "undefined" &&
      typeof VideoDecoder !== "undefined" &&
      typeof OffscreenCanvas !== "undefined"
    )
  }

  async function downloadVideo() {
    const segments = currentSegments()
    if (!segments.length || isExporting()) return

    setExporting(true)
    ui.downloadVideoBtn.disabled = true
    ui.downloadSrtBtn.disabled = true
    ui.transcribeBtn.disabled = true
    ui.backBtn.disabled = true

    try {
      if (canUseWebCodecs() && selectedVideoFile()) {
        const handled = await exportWithWebCodecs(segments)
        if (handled) return
      }
      await exportWithRecorder(segments)
    } finally {
      setExporting(false)
      ui.backBtn.disabled = false
      ui.transcribeBtn.disabled = false
      enableExports(true)
    }
  }

  async function exportWithWebCodecs(segments: any[]) {
    let mediabunny: any
    try {
      mediabunny = await import("mediabunny")
    } catch (e) {
      console.warn("[export] mediabunny failed to load, falling back", e)
      return false
    }

    const {
      Input,
      Output,
      Conversion,
      BlobSource,
      ALL_FORMATS,
      Mp4OutputFormat,
      BufferTarget,
    } = mediabunny

    modal.openExportModal()
    modal.setExportStep("prepare", "active")
    modal.setExportStage(tt("exportStages.preparingEncoder"), "busy")
    ui.exportHint.textContent = tt("exportStages.renderingLocally")

    const input = new Input({
      source: new BlobSource(selectedVideoFile()),
      formats: ALL_FORMATS,
    })
    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget(),
    })

    let canvas: any = null
    let ctx: any = null

    let conversion: any
    try {
      conversion = await Conversion.init({
        input,
        output,
        video: {
          codec: "avc",
          process: (sample: any) => {
            if (!ctx) {
              canvas = new OffscreenCanvas(
                sample.displayWidth,
                sample.displayHeight,
              )
              ctx = canvas.getContext("2d")
            }
            sample.draw(ctx, 0, 0)
            drawSubtitlesAt(
              ctx,
              sample.timestamp,
              canvas.width,
              canvas.height,
              segments,
            )
            return canvas
          },
        },
      })
    } catch (e) {
      console.warn("[export] WebCodecs init failed, falling back", e)
      return false
    }

    if (!conversion.isValid) {
      console.warn(
        "[export] WebCodecs conversion invalid, falling back",
        conversion.discardedTracks,
      )
      return false
    }

    conversion.onProgress = (p: number) => {
      modal.setExportProgress(Math.min(95, p * 95))
    }

    modal.setExportStep("prepare", "done")
    modal.setExportStep("render", "active")
    modal.setExportStage(tt("exportStages.renderingVideo"), "busy")

    try {
      await conversion.execute()
    } catch (e: any) {
      console.error(e)
      modal.failExport(
        tt("exportErrors.webcodecsFailed", {
          error: e?.message || "unknown error",
        }),
      )
      return true
    }

    modal.setExportStep("render", "done")
    modal.setExportStep("encode", "done")
    modal.setExportStep("done", "active")
    modal.setExportStage(tt("exportStages.saving"), "busy")

    const blob = new Blob([output.target.buffer], { type: "video/mp4" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${baseFileName()}.${activeLang()}.mp4`
    link.click()
    URL.revokeObjectURL(url)

    modal.setExportStep("done", "done")
    modal.setExportProgress(100)
    modal.setExportStage(tt("exportStages.exported"), "ok")
    ui.exportTitle.textContent = tt("exportStages.complete")
    ui.exportHint.hidden = true
    ui.exportClose.hidden = false
    setStatus(tt("videoExported"), "ok")
    return true
  }

  async function exportWithRecorder(segments: any[]) {
    const video = ui.video

    modal.openExportModal()

    const capture = video.captureStream
      ? video.captureStream.bind(video)
      : video.mozCaptureStream
        ? video.mozCaptureStream.bind(video)
        : null
    if (!capture || typeof MediaRecorder === "undefined") {
      modal.failExport(tt("exportErrors.noSupport"))
      return
    }

    const w = video.videoWidth || 1280
    const h = video.videoHeight || 720
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")

    const canvasStream = canvas.captureStream(30)
    let hasAudio = false
    try {
      const elementStream = capture()
      elementStream.getAudioTracks().forEach((track: MediaStreamTrack) => {
        canvasStream.addTrack(track)
        hasAudio = true
      })
    } catch (e) {
      console.warn("No audio track for the export", e)
    }

    const mimeType =
      [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ].find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm"
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(canvasStream, {
        mimeType,
        videoBitsPerSecond: 8_000_000,
      })
    } catch (e) {
      console.error(e)
      modal.failExport(tt("exportErrors.recordStart"))
      return
    }

    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }

    const finished = new Promise<void>((resolve) => {
      recorder.onstop = () => {
        modal.setExportStep("render", "done")
        modal.setExportStep("encode", "active")
        modal.setExportStage(tt("exportStages.generatingFile"), "busy")
        const blob = new Blob(chunks, { type: "video/webm" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = `${baseFileName()}.${activeLang()}.webm`
        link.click()
        URL.revokeObjectURL(url)
        resolve()
      }
    })

    const previousVolume = video.volume
    const wasMuted = video.muted
    video.muted = true
    video.volume = 0

    modal.setExportStage(tt("exportStages.preparingVideo"), "busy")
    video.pause()
    try {
      video.currentTime = 0
    } catch {}
    await new Promise((r) => setTimeout(r, 150))

    modal.setExportStep("prepare", "done")
    modal.setExportStep("render", "active")
    modal.setExportStage(
      hasAudio
        ? tt("exportStages.recordingAudio")
        : tt("exportStages.recordingNoAudio"),
      "busy",
    )
    ui.exportHint.textContent = tt("exportStages.keepTabActive")

    let raf = 0
    let stopped = false
    const stopRecording = () => {
      if (stopped) return
      stopped = true
      cancelAnimationFrame(raf)
      video.removeEventListener("ended", onEnded)
      if (recorder.state !== "inactive") recorder.stop()
    }
    const onEnded = () => stopRecording()

    const tick = () => {
      if (ctx) drawFrame(ctx, video, w, h, segments)
      const dur = video.duration
      if (dur && isFinite(dur)) {
        modal.setExportProgress(Math.min(94, (video.currentTime / dur) * 94))
        if (video.currentTime >= dur - 0.05) {
          stopRecording()
          return
        }
      }
      raf = requestAnimationFrame(tick)
    }

    video.addEventListener("ended", onEnded)
    recorder.start(100)
    tick()

    try {
      await video.play()
    } catch (e) {
      console.error(e)
      stopRecording()
      recorder.onstop = null
      if (recorder.state !== "inactive") recorder.stop()
      video.muted = wasMuted
      video.volume = previousVolume
      modal.failExport(tt("exportErrors.playbackBlocked"))
      return
    }

    await finished

    video.muted = wasMuted
    video.volume = previousVolume

    modal.setExportStep("encode", "done")
    modal.setExportStep("done", "done")
    modal.setExportProgress(100)
    modal.setExportStage(tt("exportStages.exported"), "ok")
    ui.exportTitle.textContent = tt("exportStages.complete")
    ui.exportHint.hidden = true
    ui.exportClose.hidden = false
    setStatus(tt("videoExported"), "ok")
  }

  return {
    downloadVideo,
  }
}
