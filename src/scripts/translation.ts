import {
  builtInBackendLabel,
  resolveTranslationBackend,
  translateCuesBuiltIn,
} from "@/scripts/builtInTranslate.ts"
import { LANGS, TRANSLATION_MODEL } from "@/scripts/languages.ts"

type TranslationServiceOptions = {
  downloads: any
  renderDownloads: () => void
  updateDownloadStatus: (key: string, state: string) => void
  transformersClient: {
    call: (
      type: string,
      payload?: unknown,
      transfer?: Transferable[],
    ) => Promise<unknown>
  }
  tt: (path: string, vars?: Record<string, unknown>) => string
  langName: (code: string) => string
  setStatus: (message: string, kind?: string) => void
}

export function createTranslationService(options: TranslationServiceOptions) {
  let translationReady = false
  let activeTranslationBackend: "prompt" | "nllb" | null = null

  function markTranslationBuiltIn() {
    activeTranslationBackend = "prompt"
    translationReady = true
    const item = options.downloads.translation
    item.readyNote = options.tt("downloads.translationBuiltin", {
      engine: builtInBackendLabel(),
    })
    item.total = 0
    item.loaded = 0
    options.updateDownloadStatus("translation", "ready")
  }

  async function ensureNllbTranslator() {
    if (translationReady && activeTranslationBackend === "nllb") return
    activeTranslationBackend = "nllb"
    options.updateDownloadStatus("translation", "downloading")
    options.downloads.translation.readyNote = ""
    await options.transformersClient.call("ensure-translation", {
      model: TRANSLATION_MODEL,
    })
    translationReady = true
    options.updateDownloadStatus("translation", "ready")
  }

  async function ensureTranslation(sourceLang: string, targetLang: string) {
    const backend = await resolveTranslationBackend(sourceLang, targetLang)
    if (backend !== "nllb") {
      options.updateDownloadStatus("translation", "downloading")
      options.downloads.translation.readyNote = ""
      return backend
    }
    await ensureNllbTranslator()
    return "nllb"
  }

  async function translateWithNllb(texts: string[], sourceLang: string, targetLang: string) {
    const translated: any = await options.transformersClient.call("translate", {
      texts,
      src: (LANGS as any)[sourceLang].nllb,
      tgt: (LANGS as any)[targetLang].nllb,
    })
    const normalized = Array.isArray(translated) ? translated : [translated]
    return texts.map((text, i) =>
      (
        normalized[i]?.translation_text ||
        normalized[i]?.generated_text ||
        text
      ).trim(),
    )
  }

  async function translateSegments(
    segments: any[],
    sourceLang: string,
    targetLang: string,
  ) {
    if (!segments.length || sourceLang === targetLang)
      return segments.map((s) => ({ ...s }))
    if (!(LANGS as any)[sourceLang] || !(LANGS as any)[targetLang])
      return segments.map((s) => ({ ...s }))

    options.setStatus(
      options.tt("steps.translatingTo", { lang: options.langName(targetLang) }),
      "busy",
    )

    const cues = segments.map((s) => ({
      text: s.text,
      start: s.start,
      end: s.end,
    }))
    const texts = segments.map((s) => s.text)
    const backend = await ensureTranslation(sourceLang, targetLang)

    let translatedTexts
    if (backend === "nllb") {
      translatedTexts = await translateWithNllb(texts, sourceLang, targetLang)
    } else {
      const onModelProgress = (ratio: number) => {
        options.downloads.translation.progress = Math.round(ratio * 100)
        options.renderDownloads()
      }
      try {
        translatedTexts = await translateCuesBuiltIn(cues, sourceLang, targetLang, {
          onProgress: onModelProgress,
          sourceLabel: (LANGS as any)[sourceLang].label,
          targetLabel: (LANGS as any)[targetLang].label,
        })
        markTranslationBuiltIn()
      } catch (err) {
        console.warn("[translate] built-in failed, falling back to NLLB", err)
        await ensureNllbTranslator()
        translatedTexts = await translateWithNllb(texts, sourceLang, targetLang)
      }
    }

    return segments.map((s, i) => ({
      ...s,
      text: (translatedTexts[i] || s.text).trim(),
    }))
  }

  return {
    ensureNllbTranslator,
    ensureTranslation,
    translateSegments,
  }
}
