import {
  hasBuiltInTranslationSupport,
} from "@/scripts/builtInTranslate.ts"
import { createDownloadsController } from "@/scripts/downloads.ts"
import { createEditorSegmentsController } from "@/scripts/editorSegments.ts"
import { createExportModal } from "@/scripts/export/exportModal.ts"
import { createVideoExporter } from "@/scripts/export/videoExport.ts"
import { createAudioService } from "@/scripts/media/audio.ts"
import { I18N, langName, tt } from "@/scripts/i18n.ts"
import { ASR_MODEL, LANGS } from "@/scripts/languages.ts"
import {
  buildSrt,
  normalizeLanguageCode,
  normalizeSegments,
} from "@/scripts/subtitles.ts"
import { createSubtitleStyleController } from "@/scripts/subtitleStyle.ts"
import { createTimelineController } from "@/scripts/timeline.ts"
import { createTransformersClient } from "@/scripts/transformersClient.ts"
import { createTranslationService } from "@/scripts/translation.ts"
import { ui } from "@/scripts/ui.ts"

type Segment = { start: number; end: number; text: string }
type SegmentsByLang = Record<string, Segment[]>
type Stage = "upload" | "config" | "editor"

const {
  downloads,
  renderDownloads,
  updateDownloadStatus,
  makeTransformersTracker,
  fetchWithProgress,
  refreshClearModelsUI,
  clearLocalModels,
} = createDownloadsController({
  ui,
  tt,
  prettifyBytes,
  hasBuiltInTranslationSupport,
})

// ── State ──
let selectedVideoFile: File | null = null
let videoObjectUrl = ""
let detectedLang = ""
let baseSegments: Segment[] = []
let segmentsByLang: SegmentsByLang = {}
let orderedLangs: string[] = []
let activeLang = ""

let asrReady = false
let dragDepth = 0
let exporting = false
let progressRaf = 0

const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator

const asrTracker = makeTransformersTracker("asr")
const translationTracker = makeTransformersTracker("translation")
const transformersClient = createTransformersClient({
  onProgress(key, payload) {
    if (key === "asr") asrTracker(payload)
    else if (key === "translation") translationTracker(payload)
  },
})
const { ensureFfmpeg, extractAudioBuffer } = createAudioService({
  tt,
  fetchWithProgress,
  updateDownloadStatus,
  setStatus,
  setProgress,
  applyProgress,
  setIndeterminate,
  startProgressCreep,
  stopProgressCreep,
})
const { translateSegments } = createTranslationService({
  downloads,
  renderDownloads,
  updateDownloadStatus,
  transformersClient,
  tt,
  langName,
  setStatus,
})
let editorSegmentsController: any
const { renderTimeline, highlightSegment, updateCaption } = createTimelineController({
  ui,
  currentSegments,
  snapshotSegments,
  pushHistory,
  renderSegments: () => editorSegmentsController.renderSegments(),
  enableExports,
})
editorSegmentsController = createEditorSegmentsController({
  ui,
  tt,
  langName,
  getState: () => ({
    detectedLang,
    baseSegments,
    segmentsByLang,
    orderedLangs,
    activeLang,
  }),
  setActiveLang: (lang) => {
    activeLang = lang
  },
  setOrderedLangs: (langs) => {
    orderedLangs = langs
  },
  setSegmentsForLang: (lang, segments) => {
    segmentsByLang[lang] = segments
  },
  currentSegments,
  translateSegments,
  snapshotSegments,
  pushHistory,
  renderTimeline,
  highlightSegment,
  updateCaption,
  enableExports,
})
const {
  addLanguage,
  buildLangSelects,
  populateAddLang,
  renderSegments,
  renderTabs,
  setLangAddStatus,
  wireSegmentEditor,
} = editorSegmentsController
const {
  applyCaptionStyle,
  renderPresets,
  syncStyleControls,
  wireStyleControls,
} = createSubtitleStyleController({ ui, I18N })
const exportModal = createExportModal({ ui, tt, isExporting: () => exporting })
const { closeExportModal } = exportModal
const { downloadVideo } = createVideoExporter({
  ui,
  tt,
  currentSegments,
  selectedVideoFile: () => selectedVideoFile,
  activeLang: () => activeLang,
  baseFileName,
  isExporting: () => exporting,
  setExporting: (value) => {
    exporting = value
  },
  enableExports,
  setStatus,
  modal: exportModal,
})

function currentSegments(): Segment[] {
  return segmentsByLang[activeLang] || []
}

// ── Undo / redo history ──
// Snapshots of the whole per-language segment map. Any edit (text, timings,
// add/delete, timeline drag) records the pre-change state so it can be undone
// and redone.
const HISTORY_LIMIT = 100
let undoStack: string[] = []
let redoStack: string[] = []

function snapshotSegments() {
  // Capture the full editable state: per-language segments plus the language
  // list/selection, so adding or removing a language is undoable too.
  return JSON.stringify({ segmentsByLang, orderedLangs, activeLang })
}

function refreshHistoryButtons() {
  if (ui.undoBtn) ui.undoBtn.disabled = undoStack.length === 0
  if (ui.redoBtn) ui.redoBtn.disabled = redoStack.length === 0
}

function resetHistory() {
  undoStack = []
  redoStack = []
  refreshHistoryButtons()
}

// Record the state *before* a mutation. Call this right before changing
// segments; a new edit clears the redo branch.
function pushHistory(snapshotBefore: string) {
  undoStack.push(snapshotBefore)
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  redoStack = []
  refreshHistoryButtons()
}

function restoreSnapshot(json: string) {
  const snap = JSON.parse(json)
  segmentsByLang = snap.segmentsByLang || {}
  orderedLangs = snap.orderedLangs || Object.keys(segmentsByLang)
  activeLang = snap.activeLang || orderedLangs[0] || ""
  if (!segmentsByLang[activeLang])
    activeLang = orderedLangs[0] || Object.keys(segmentsByLang)[0] || ""
  renderTabs() // rebuilds tabs + the "add language" select
  renderSegments() // also re-renders the timeline
  enableExports(true)
  updateCaption()
}

function undo() {
  if (!undoStack.length) return
  redoStack.push(snapshotSegments())
  restoreSnapshot(undoStack.pop()!)
  refreshHistoryButtons()
}

function redo() {
  if (!redoStack.length) return
  undoStack.push(snapshotSegments())
  restoreSnapshot(redoStack.pop()!)
  refreshHistoryButtons()
}

// ── Helpers ──
function setStatus(message: string, kind = "ok") {
  // Shown on the config stage while generating (the editor has no status line).
  ui.configStatus.textContent = message
  ui.configStatus.dataset.kind = kind
}

function setProgress(percent: number) {
  setIndeterminate(false)
  applyProgress(percent)
}

// Switch the bar to/from an indeterminate CSS animation. Used for opaque steps
// of unknown duration (audio extraction) so the bar keeps moving on the
// compositor thread instead of freezing when there's no real progress to show.
let progressIndeterminate = false
function setIndeterminate(on: boolean) {
  if (on) stopProgressCreep()
  progressIndeterminate = on
  ui.configProgressFill.classList.toggle("is-indeterminate", on)
  // The moving stripe is the cue; a numeric % would just sit there frozen.
  if (on) ui.configProgressPct.textContent = ""
}

// Directly paint a progress value without touching any running animation.
function applyProgress(percent: number) {
  if (progressIndeterminate) return
  const clamped = Math.max(0, Math.min(100, percent))
  ui.configProgressFill.style.width = `${clamped}%`
  ui.configProgressPct.textContent = `${Math.round(clamped)}%`
}

function stopProgressCreep() {
  if (progressRaf) {
    cancelAnimationFrame(progressRaf)
    progressRaf = 0
  }
}

// Smoothly creep from `from` toward `ceiling` (asymptotically, never quite
// reaching it) so an opaque step still shows continuous movement. `expected`
// is the rough duration in ms the step is expected to take.
function startProgressCreep(from: number, ceiling: number, expected: number) {
  stopProgressCreep()
  const start = performance.now()
  const span = ceiling - from
  const tick = (now: number) => {
    const t = (now - start) / Math.max(1, expected)
    const eased = 1 - Math.exp(-1.6 * t)
    applyProgress(from + span * eased)
    progressRaf = requestAnimationFrame(tick)
  }
  progressRaf = requestAnimationFrame(tick)
}

function prettifyBytes(bytes: number) {
  if (!bytes && bytes !== 0) return "-"
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function outputTarget(sourceLang: string) {
  const value = ui.outputLang.value
  if (!value || value === "same") return sourceLang
  return value in LANGS ? value : sourceLang
}

function baseFileName() {
  return (
    (selectedVideoFile?.name || "subtitles")
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .toLowerCase() || "subtitles"
  )
}

// ── Stage switching ──
function setStage(stage: Stage) {
  ui.stageUpload.hidden = stage !== "upload"
  ui.stageConfig.hidden = stage !== "config"
  ui.stageEditor.hidden = stage !== "editor"
  if (ui.statusDock) ui.statusDock.hidden = stage === "editor"
  if (stage === "editor") ui.downloadsPanel.hidden = true
}

// ── Lazy model loaders ──
async function ensureRecognizer() {
  if (asrReady) return
  updateDownloadStatus("asr", "downloading")
  await transformersClient.call("ensure-asr", {
    model: ASR_MODEL,
    webgpu: hasWebGPU,
  })
  asrReady = true
  updateDownloadStatus("asr", "ready")
}

async function preloadAssetsInBackground() {
  await Promise.allSettled([
    ensureFfmpeg().catch((e) => {
      console.error(e)
      updateDownloadStatus("ffmpeg", "error")
    }),
    ensureRecognizer().catch((e) => {
      console.error(e)
      updateDownloadStatus("asr", "error")
    }),
  ])
}

// ── Generate flow ──
async function generate() {
  if (!selectedVideoFile || exporting) return
  ui.transcribeBtn.disabled = true
  ui.downloadVideoBtn.disabled = true
  ui.downloadSrtBtn.disabled = true
  ui.configError.hidden = true
  ui.configError.textContent = ""
  ui.configProgress.hidden = false
  setStatus(tt("steps.preparing"), "busy")
  setProgress(2)
  try {
    const audio = await extractAudioBuffer(selectedVideoFile)
    setStatus(tt("steps.loadingSpeech"), "busy")
    // On the first run the Whisper model is downloaded; mirror that real
    // byte progress onto 38%→48%. When it's already cached the download is
    // instant, so fall back to a gentle creep for the (opaque) warm-up.
    startProgressCreep(38, 48, 8000)
    const asrMonitor = setInterval(() => {
      const d = downloads.asr
      if (d.state === "downloading" && d.total) {
        stopProgressCreep()
        const ratio = Math.min(1, d.progress / 100)
        applyProgress(38 + ratio * 10)
        const meta = prettifyBytes(d.loaded) + " / " + prettifyBytes(d.total)
        setStatus(`Step 4/5 · Downloading speech model… ${meta}`, "busy")
      }
    }, 200)
    try {
      await ensureRecognizer()
    } finally {
      clearInterval(asrMonitor)
      stopProgressCreep()
    }
    setProgress(48)

    // Whisper processes the audio in ~20s chunks (chunk_length 30s minus the
    // two 5s overlaps). We know the total up front, so `chunk_callback` lets
    // us advance the bar one real chunk at a time instead of one opaque jump.
    const TR_START = 48
    const TR_END = 90
    const audioSeconds = audio.length / 16000
    const chunkSeconds = 30 - 2 * 5
    const totalChunks = Math.max(1, Math.ceil(audioSeconds / chunkSeconds))
    const chunkSpan = (TR_END - TR_START) / totalChunks
    let chunksDone = 0
    let lastChunkAt = performance.now()
    // Rough first estimate; refined with the real timing of each finished chunk.
    let perChunkMs = Math.max(2000, (audioSeconds / totalChunks) * 900)

    const transcribeStatus = () => {
      setStatus(tt("steps.transcribing"), "busy")
    }

    transcribeStatus()
    applyProgress(TR_START)
    // Creep across the first chunk until its callback lands.
    startProgressCreep(TR_START, TR_START + chunkSpan, perChunkMs)

    // The worker streams a "chunk" message after each ~20s window it finishes.
    transformersClient.setChunkHandler(() => {
      const now = performance.now()
      perChunkMs = Math.max(500, now - lastChunkAt)
      lastChunkAt = now
      chunksDone = Math.min(totalChunks, chunksDone + 1)
      const floor = Math.min(TR_END, TR_START + chunksDone * chunkSpan)
      const ceiling = Math.min(TR_END, floor + chunkSpan)
      transcribeStatus()
      stopProgressCreep()
      applyProgress(floor)
      if (chunksDone < totalChunks)
        startProgressCreep(floor, ceiling, perChunkMs)
    })

    let output: any
    try {
      // Transfer the audio buffer so it's moved (not copied) to the worker.
      output = await transformersClient.call(
        "transcribe",
        { audio, language: ui.inputLang.value || null },
        [audio.buffer],
      )
    } finally {
      transformersClient.setChunkHandler(null)
    }
    stopProgressCreep()
    setProgress(TR_END)

    setStatus(tt("steps.buildingLines"), "busy")
    applyProgress(92)
    detectedLang =
      normalizeLanguageCode(output?.language) ||
      normalizeLanguageCode(ui.inputLang.value) ||
      "en"

    baseSegments = normalizeSegments(output)
    if (!baseSegments.length)
      throw new Error(tt("noSpeech"))

    const target = outputTarget(detectedLang)
    const targets = [detectedLang]
    if (target !== detectedLang && !targets.includes(target))
      targets.push(target)

    // Translation (if any) gets the final 92%→100% stretch, split per language.
    const TX_START = 92
    const TX_SPAN = 100 - TX_START
    segmentsByLang = {}
    let done = 0
    for (const lang of targets) {
      if (lang === detectedLang) {
        segmentsByLang[lang] = baseSegments.map((s) => ({ ...s }))
      } else {
        startProgressCreep(
          TX_START + (done / targets.length) * TX_SPAN,
          TX_START + ((done + 1) / targets.length) * TX_SPAN,
          6000,
        )
        segmentsByLang[lang] = await translateSegments(
          baseSegments,
          detectedLang,
          lang,
        )
        stopProgressCreep()
      }
      done += 1
      setProgress(TX_START + (done / targets.length) * TX_SPAN)
    }

    orderedLangs = targets
    activeLang = target
    renderTabs()
    renderSegments()
    enableExports(true)
    ui.addSegBtn.disabled = false
    // The freshly generated transcription is the baseline; nothing to undo to.
    resetHistory()
    setProgress(100)
    setStatus(
      tt("ready", { n: baseSegments.length, count: targets.length }),
      "ok",
    )
    setStage("editor")
    updateCaption()
    ui.configProgress.hidden = true
  } catch (error: any) {
    console.error(error)
    const message = error?.message || tt("genError")
    setStatus(message, "error")
    setProgress(0)
    ui.configError.textContent = message
    ui.configError.hidden = false
    ui.configProgress.hidden = true
  } finally {
    ui.transcribeBtn.disabled = false
  }
}

function enableExports(on: boolean) {
  const ready = on && currentSegments().length > 0
  ui.downloadSrtBtn.disabled = !ready
  ui.downloadVideoBtn.disabled = !ready
}

// ── File handling ──
function handleSelectedFile(file?: File) {
  if (!file) return
  const isVideo =
    file.type.startsWith("video/") ||
    file.type === "" ||
    /\.(mp4|mov|webm|mkv|avi|m4v|ogv|wmv)$/i.test(file.name)
  if (!isVideo) return

  if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl)
  selectedVideoFile = file
  videoObjectUrl = URL.createObjectURL(file)
  ui.video.src = videoObjectUrl
  ui.video.load()
  ui.configVideo.src = videoObjectUrl
  ui.configVideo.load()

  baseSegments = []
  segmentsByLang = {}
  orderedLangs = []
  activeLang = ""
  ui.langTabs.innerHTML = ""
  setLangAddStatus("")
  populateAddLang()
  renderSegments()
  ui.addSegBtn.disabled = true
  enableExports(false)
  resetHistory()

  ui.outputLang.value = "same"
  ui.inputLang.value = ""

  const metaText = `${file.name} · ${prettifyBytes(file.size)}`
  ui.meta.textContent = metaText
  ui.configMeta.textContent = metaText
  setStatus(tt("videoLoaded"), "ok")
  setProgress(0)
  ui.configProgress.hidden = true
  ui.configError.hidden = true
  ui.configError.textContent = ""
  setStage("config")
}

function resetFlow() {
  if (exporting) return
  if (videoObjectUrl) {
    URL.revokeObjectURL(videoObjectUrl)
    videoObjectUrl = ""
  }
  selectedVideoFile = null
  baseSegments = []
  segmentsByLang = {}
  orderedLangs = []
  activeLang = ""
  ui.langTabs.innerHTML = ""
  setLangAddStatus("")
  populateAddLang()
  ui.caption.textContent = ""
  ui.video.removeAttribute("src")
  ui.video.load()
  ui.configVideo.removeAttribute("src")
  ui.configVideo.load()
  enableExports(false)
  resetHistory()
  setStage("upload")
}

// Back from editor to the configuration step.
function backToConfig() {
  if (exporting) return
  ui.video.pause()
  setStage("config")
}

// ── Download .srt ──
function downloadSrt() {
  const segments = currentSegments()
  if (!segments.length) return
  const blob = new Blob([buildSrt(segments)], {
    type: "text/plain;charset=utf-8",
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${baseFileName()}.${activeLang}.srt`
  link.click()
  URL.revokeObjectURL(url)
}

// ── Global drag & drop ──
function attachGlobalDrop() {
  const hasFiles = (e: DragEvent) =>
    Array.from(e.dataTransfer?.types || []).includes("Files")
  const setDragging = (active: boolean) => {
    ui.dropzone.classList.toggle("over", active)
    ui.app.classList.toggle("is-dragging", active)
  }
  document.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth += 1
    setDragging(true)
  })
  document.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
  })
  document.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) setDragging(false)
  })
  document.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth = 0
    setDragging(false)
    handleSelectedFile(e.dataTransfer?.files?.[0])
  })
}

// ── Init ──
buildLangSelects()
renderDownloads()
renderPresets()
syncStyleControls()
applyCaptionStyle()
wireStyleControls()
wireSegmentEditor()
preloadAssetsInBackground()
setStage("upload")
attachGlobalDrop()

ui.dropzone.addEventListener("click", () => ui.input.click())
ui.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault()
    ui.input.click()
  }
})
ui.input.addEventListener("change", (e) => {
  const target = e.target as HTMLInputElement | null
  handleSelectedFile(target?.files?.[0])
})
ui.transcribeBtn.addEventListener("click", generate)
ui.backBtn.addEventListener("click", backToConfig)
ui.undoBtn?.addEventListener("click", undo)
ui.redoBtn?.addEventListener("click", redo)
ui.langAddSelect?.addEventListener("change", () => {
  const target = ui.langAddSelect.value
  if (target) addLanguage(target)
})
ui.configBackBtn.addEventListener("click", resetFlow)
ui.downloadSrtBtn.addEventListener("click", downloadSrt)
ui.downloadVideoBtn.addEventListener("click", downloadVideo)
ui.exportClose.addEventListener("click", closeExportModal)
ui.exportBackdrop.addEventListener("click", closeExportModal)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !ui.exportModal.hidden) closeExportModal()

  // Undo / redo. Only when the editor is open and the export modal is closed.
  // Inside text fields we defer to the browser's native text undo.
  if (
    (e.metaKey || e.ctrlKey) &&
    !ui.stageEditor.hidden &&
    ui.exportModal.hidden
  ) {
    const target = e.target
    const inField =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    const key = e.key.toLowerCase()
    if (!inField && (key === "z" || key === "y")) {
      const wantsRedo = key === "y" || (key === "z" && e.shiftKey)
      e.preventDefault()
      if (wantsRedo) redo()
      else undo()
      return
    }
  }

  if (e.key === " " && !ui.stageEditor.hidden && ui.exportModal.hidden) {
    const target = e.target
    const isTyping =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    if (!isTyping) {
      e.preventDefault()
      if (ui.video.paused) ui.video.play().catch(() => {})
      else ui.video.pause()
    }
  }
})
ui.downloadsToggle.addEventListener("click", () => {
  const opening = ui.downloadsPanel.hidden
  ui.downloadsPanel.hidden = !opening
  // The panel header already shows the status, so drop the dock label while open.
  ui.statusDock?.classList.toggle("panel-open", opening)
  if (opening) refreshClearModelsUI()
})
ui.clearModelsBtn?.addEventListener("click", clearLocalModels)
