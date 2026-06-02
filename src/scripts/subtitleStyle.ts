import { $$ } from "@/scripts/dom.ts"

export const FONT_STACKS: Record<string, string> = {
  sans: '"Outfit", "Segoe UI", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  rounded: '"Quicksand", "Trebuchet MS", system-ui, sans-serif',
  condensed: '"Arial Narrow", "Roboto Condensed", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", monospace',
}

export const CAPTION_PRESETS = [
  {
    id: "default",
    name: "Default",
    s: {
      font: "sans",
      size: 1,
      color: "#ffffff",
      weight: 600,
      bgEnabled: true,
      bgColor: "#06080b",
      bgOpacity: 0.84,
      outline: false,
    },
  },
  {
    id: "clean",
    name: "Clean",
    s: {
      font: "sans",
      size: 1,
      color: "#ffffff",
      weight: 600,
      bgEnabled: false,
      bgColor: "#06080b",
      bgOpacity: 0.84,
      outline: true,
    },
  },
  {
    id: "bold",
    name: "Bold",
    s: {
      font: "sans",
      size: 1.12,
      color: "#ffffff",
      weight: 700,
      bgEnabled: true,
      bgColor: "#000000",
      bgOpacity: 1,
      outline: false,
    },
  },
  {
    id: "pop",
    name: "Pop",
    s: {
      font: "rounded",
      size: 1.06,
      color: "#fde047",
      weight: 700,
      bgEnabled: false,
      bgColor: "#000000",
      bgOpacity: 0.84,
      outline: true,
    },
  },
  {
    id: "neon",
    name: "Neon",
    s: {
      font: "sans",
      size: 1,
      color: "#b8f060",
      weight: 700,
      bgEnabled: true,
      bgColor: "#06080b",
      bgOpacity: 0.55,
      outline: false,
    },
  },
  {
    id: "classic",
    name: "Classic",
    s: {
      font: "serif",
      size: 1,
      color: "#ffffff",
      weight: 600,
      bgEnabled: false,
      bgColor: "#06080b",
      bgOpacity: 0.84,
      outline: true,
    },
  },
  {
    id: "terminal",
    name: "Terminal",
    s: {
      font: "mono",
      size: 0.92,
      color: "#ffffff",
      weight: 600,
      bgEnabled: true,
      bgColor: "#0a0d12",
      bgOpacity: 0.9,
      outline: false,
    },
  },
]

export const captionStyle: any = {
  font: "sans",
  size: 1,
  color: "#ffffff",
  weight: 600,
  bgEnabled: true,
  bgColor: "#06080b",
  bgOpacity: 0.84,
  outline: false,
  position: "bottom",
}

export function hexToRgba(hex: string, alpha = 1) {
  let h = String(hex || "#000000").replace("#", "")
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("")
  }
  const n = parseInt(h, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function applyVisualStyle(el: HTMLElement, s: any) {
  el.style.fontFamily = FONT_STACKS[s.font] || FONT_STACKS.sans
  el.style.fontWeight = String(s.weight || 600)
  el.style.color = s.color || "#ffffff"
  el.style.background = s.bgEnabled
    ? hexToRgba(s.bgColor, s.bgOpacity)
    : "transparent"
  el.style.textShadow = s.outline
    ? "0 1px 2px rgba(0,0,0,.95), 0 0 5px rgba(0,0,0,.85), 0 0 1px rgba(0,0,0,.9)"
    : s.bgEnabled
      ? "none"
      : "0 1px 3px rgba(0,0,0,.85)"
}

export function createSubtitleStyleController({ ui, I18N }: { ui: any; I18N: any }) {
  let activePresetId = "default"

  function applyCaptionStyle() {
    const c = captionStyle
    applyVisualStyle(ui.caption, c)
    ui.caption.style.fontSize = `clamp(${Math.round(13 * c.size)}px, ${(
      2.4 * c.size
    ).toFixed(2)}vw, ${Math.round(28 * c.size)}px)`
    ui.caption.style.padding = c.bgEnabled ? "0.22rem 0.6rem" : "0"
    ui.caption.style.top = "auto"
    ui.caption.style.bottom = "auto"
    if (c.position === "middle") {
      ui.caption.style.top = "50%"
      ui.caption.style.transform = "translate(-50%, -50%)"
    } else if (c.position === "top") {
      ui.caption.style.top = "8%"
      ui.caption.style.transform = "translateX(-50%)"
    } else {
      ui.caption.style.bottom = "8%"
      ui.caption.style.transform = "translateX(-50%)"
    }
  }

  function renderPresets() {
    ui.stylePresets.innerHTML = ""
    CAPTION_PRESETS.forEach((p) => {
      const on = p.id === activePresetId
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = "preset" + (on ? " is-on" : "")
      btn.setAttribute("role", "tab")
      btn.setAttribute("aria-selected", on ? "true" : "false")
      const presetName = I18N.presets?.[p.id] || p.name
      btn.title = presetName

      const prev = document.createElement("span")
      prev.className = "preset-prev"
      const inner = document.createElement("span")
      inner.textContent = "Aa"
      applyVisualStyle(inner, p.s)
      inner.style.padding = p.s.bgEnabled ? "1px 6px" : "0"
      inner.style.borderRadius = "4px"
      inner.style.fontSize = "13px"
      prev.appendChild(inner)

      const name = document.createElement("span")
      name.className = "preset-name"
      name.textContent = presetName

      btn.append(prev, name)
      btn.addEventListener("click", () => applyPreset(p))
      ui.stylePresets.appendChild(btn)
    })
  }

  function applyPreset(p: any) {
    Object.assign(captionStyle, p.s)
    activePresetId = p.id
    applyCaptionStyle()
    syncStyleControls()
    renderPresets()
  }

  function syncStyleControls() {
    const c = captionStyle
    ui.csFont.value = c.font
    ui.csSize.value = String(c.size)
    ui.csColor.value = c.color
    ui.csBold.checked = c.weight >= 700
    ui.csOutline.checked = !!c.outline
    ui.csBg.checked = !!c.bgEnabled
    ui.csBgColor.value = c.bgColor
    ui.csBgOpacity.value = String(c.bgOpacity)
    ui.csBgColor.disabled = !c.bgEnabled
    ui.csBgOpacity.disabled = !c.bgEnabled
    $$("button", ui.csPosition).forEach((b) => {
      b.classList.toggle("is-on", b.dataset.pos === c.position)
    })
  }

  function onManualStyleChange() {
    activePresetId = ""
    applyCaptionStyle()
    renderPresets()
  }

  function wireStyleControls() {
    ui.styleToggle.addEventListener("click", () => {
      const open = ui.styleControls.hidden
      ui.styleControls.hidden = !open
      ui.styleToggle.setAttribute("aria-expanded", String(open))
      ui.styleToggle.classList.toggle("is-open", open)
    })
    ui.csFont.addEventListener("change", () => {
      captionStyle.font = ui.csFont.value
      onManualStyleChange()
    })
    ui.csSize.addEventListener("input", () => {
      captionStyle.size = Number(ui.csSize.value)
      onManualStyleChange()
    })
    ui.csColor.addEventListener("input", () => {
      captionStyle.color = ui.csColor.value
      onManualStyleChange()
    })
    ui.csBold.addEventListener("change", () => {
      captionStyle.weight = ui.csBold.checked ? 700 : 600
      onManualStyleChange()
    })
    ui.csOutline.addEventListener("change", () => {
      captionStyle.outline = ui.csOutline.checked
      onManualStyleChange()
    })
    ui.csBg.addEventListener("change", () => {
      captionStyle.bgEnabled = ui.csBg.checked
      syncStyleControls()
      onManualStyleChange()
    })
    ui.csBgColor.addEventListener("input", () => {
      captionStyle.bgColor = ui.csBgColor.value
      onManualStyleChange()
    })
    ui.csBgOpacity.addEventListener("input", () => {
      captionStyle.bgOpacity = Number(ui.csBgOpacity.value)
      onManualStyleChange()
    })
    ui.csPosition.addEventListener("click", (e: Event) => {
      const b = (e.target as Element).closest("button[data-pos]") as HTMLElement
      if (!b) return
      captionStyle.position = b.dataset.pos
      syncStyleControls()
      applyCaptionStyle()
    })
  }

  return {
    applyCaptionStyle,
    renderPresets,
    syncStyleControls,
    wireStyleControls,
  }
}
