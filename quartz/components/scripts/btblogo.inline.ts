import { createTimeline, stagger, svg, utils } from "animejs"

// NOTE: Quartz strips the first occurrences of a certain module keyword from inline scripts
// with a plain string replace, so do not use that word anywhere in this file, even in comments.

const PLAYED_KEY = "btb-logo-played"
const VIEW_FULL = "0 0 200 200"
const CLONE_Z = "50"

// wave geometry. The static artwork is a sine of period 40 and amplitude 2.25 around y=83,
// so ending on one full period of phase reproduces it.
const WAVE_PERIOD = 40
const WAVE_LEVEL_END = 83
const WAVE_LEVEL_START = 168
const WAVE_AMP_END = 2.25
const WAVE_AMP_START = 6

const shouldPlay = (): boolean => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false
  try {
    return sessionStorage.getItem(PLAYED_KEY) === null
  } catch {
    return true
  }
}

const markPlayed = () => {
  try {
    sessionStorage.setItem(PLAYED_KEY, "1")
  } catch {
    // storage can be blocked. Playing again on the next visit is fine.
  }
}

type Rect = { left: number; top: number; width: number; height: number }
type Point = { x: number; y: number }
type ViewBox = { x: number; y: number; w: number; h: number }

// Maps a rect in the SVG's own coordinate space to a screen rect, for a given target viewBox
// and a given on-screen box, using the same "xMidYMid meet" math the browser itself uses. This
// lets the finale compute where the label will land before the camera ever gets there (and
// where its pieces sit once it lands), so every step can be built as an ordinary, skippable
// timeline child up front instead of measured mid-flight.
function projectRect(box: Rect, view: ViewBox, local: Rect): Rect {
  const scale = Math.min(box.width / view.w, box.height / view.h)
  const offsetX = (box.width - view.w * scale) / 2
  const offsetY = (box.height - view.h * scale) / 2
  return {
    left: box.left + offsetX + (local.left - view.x) * scale,
    top: box.top + offsetY + (local.top - view.y) * scale,
    width: local.width * scale,
    height: local.height * scale,
  }
}

function quadraticBezier(p0: Point, p1: Point, p2: Point, t: number): Point {
  const mt = 1 - t
  return {
    x: mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    y: mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
  }
}

// A gentle arc between two points, bulging away from the straight line between them.
function arcControlPoint(from: Point, to: Point, bulge: number): Point {
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const perpX = -dy / len
  const perpY = dx / len
  const offset = len * bulge
  return { x: mid.x + perpX * offset, y: mid.y + perpY * offset }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function createPlayer(
  root: HTMLElement,
  art: HTMLElement,
  svgEl: SVGSVGElement,
  h1: HTMLElement,
  metaTop: HTMLElement,
  metaBottom: HTMLElement,
) {
  const $ = <T extends Element>(sel: string) => svgEl.querySelector(sel) as T
  const $$ = (sel: string) => Array.from(svgEl.querySelectorAll(sel))

  const ground = $<SVGPathElement>("#ground")
  const soilDots = $$("#soil circle")
  const bottle = $<SVGPathElement>("#bottle")
  const wine = $<SVGPathElement>("#wine")
  const rootsGroup = $<SVGGElement>("#roots")
  const sapGroup = $<SVGGElement>("#sap")
  const roots = [1, 2, 3, 4].map((i) => $<SVGPathElement>(`#root-${i}`))
  const sap = [1, 2, 3, 4].map((i) => $<SVGPathElement>(`#sap-${i}`))
  const cork = $<SVGPathElement>("#cork")
  const capsule = $<SVGGElement>("#capsule")
  const label = $<SVGGElement>("#label")
  const labelRect = $<SVGRectElement>(".btb-label-bg")
  const producerText = $<SVGTextElement>("#label-producer")
  const nameText = $<SVGTextElement>("#label-name")
  const originText = $<SVGTextElement>("#label-origin")
  const vintageText = $<SVGTextElement>("#label-vintage")
  const labelTexts = [producerText, nameText, originText, vintageText]

  const restWineD = wine.getAttribute("d") ?? ""

  // 1) hide everything that has to appear later. Drawables start fully undrawn.
  const [groundD, bottleD, labelRectD, ...lineD] = svg.createDrawable([
    ground,
    bottle,
    labelRect,
    ...roots,
    ...sap,
  ])
  const rootsD = lineD.slice(0, 4)
  const sapD = lineD.slice(4, 8)
  const drawn = [ground, bottle, labelRect, ...roots, ...sap]

  utils.set(soilDots, { opacity: 0 })
  utils.set(rootsGroup, { opacity: 0.35 })
  utils.set(sapGroup, { opacity: 1 })
  utils.set(cork, { opacity: 0, translateY: -24 })
  utils.set(capsule, { opacity: 0, translateY: -16 })
  utils.set(label, { opacity: 0 })
  utils.set(labelTexts, { opacity: 0 })
  utils.set(wine, { fillOpacity: 0.08 })

  const wave = { level: WAVE_LEVEL_START, amp: WAVE_AMP_START, phase: 0 }
  const renderWave = () => {
    let d = ""
    for (let x = 74; x <= 126; x += 2) {
      const y = wave.level - wave.amp * Math.sin((2 * Math.PI * x) / WAVE_PERIOD + wave.phase)
      d += `${d ? "L" : "M"}${x} ${y.toFixed(2)}`
    }
    wine.setAttribute("d", `${d}L126 200L74 200Z`)
  }
  renderWave()

  // 2) work out the label-detach finale now, while the SVG is still in its plain,
  // untransformed layout: nothing about the bottle <svg> or its container is ever scaled or
  // translated. A single free-floating SVG clone of the whole label is what flies to the
  // title instead - one rigid piece, one path, one speed.
  const lr = {
    x: +labelRect.getAttribute("x")!,
    y: +labelRect.getAttribute("y")!,
    w: +labelRect.getAttribute("width")!,
    h: +labelRect.getAttribute("height")!,
  }
  const view: ViewBox = { x: lr.x, y: lr.y, w: lr.w, h: lr.h }
  const viewLabel = `${lr.x} ${lr.y} ${lr.w} ${lr.h}`
  const svgBox = svgEl.getBoundingClientRect()

  // getBBox() on a <text> with textLength doesn't reliably report the textLength-adjusted
  // width in every browser - textLength/text-anchor/x already say exactly where the rendered
  // text sits horizontally, so use those directly for text and fall back to getBBox() for
  // anything else.
  const bboxOf = (el: SVGGraphicsElement): Rect => {
    const b = el.getBBox()
    if (el instanceof SVGTextElement) {
      const textLength = el.getAttribute("textLength")
      const anchor = el.getAttribute("text-anchor")
      if (textLength && anchor === "middle") {
        const width = +textLength
        const x = +(el.getAttribute("x") ?? "0")
        return { left: x - width / 2, top: b.y, width, height: b.height }
      }
    }
    return { left: b.x, top: b.y, width: b.width, height: b.height }
  }
  const outerLocal: Rect = { left: lr.x, top: lr.y, width: lr.w, height: lr.h }
  const outerAtZoom = projectRect(svgBox, view, outerLocal)
  const nameAtZoom = projectRect(svgBox, view, bboxOf(nameText))

  // real targets: h1 is already laid out (just invisible), so its rect already reflects the
  // current viewport/breakpoint. Collapsing the art box by its own height is what pulls h1
  // (and the lines around it) up into their resting place, so that is the target to aim for.
  // DOMRect's fields are prototype getters, not own properties - {...rect} silently copies
  // nothing, so pull left/top/width/height out explicitly.
  const toRect = (r: DOMRect): Rect => ({
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
  })
  const h1Rect = toRect(h1.getBoundingClientRect())
  const metaTopTarget = toRect(metaTop.getBoundingClientRect())
  const metaBottomRectNow = toRect(metaBottom.getBoundingClientRect())
  const artHeight = art.getBoundingClientRect().height
  const h1Target: Rect = { ...h1Rect, top: h1Rect.top - artHeight }
  const metaBottomTarget: Rect = { ...metaBottomRectNow, top: metaBottomRectNow.top - artHeight }

  // single calibration: the label's "Before the Bottle" line is matched to the real h1, once.
  // Everything else in the label rides along as part of the same rigid piece.
  const zoomScale = h1Target.height / nameAtZoom.height
  const nameOffsetX = nameAtZoom.left - outerAtZoom.left
  const nameOffsetY = nameAtZoom.top - outerAtZoom.top
  const liftedW = outerAtZoom.width * 1.03
  const liftedH = outerAtZoom.height * 1.03
  const finalW = outerAtZoom.width * zoomScale
  const finalH = outerAtZoom.height * zoomScale
  // where the label's own top-left corner needs to end up so that, once resized to finalW/H,
  // the name line (a fixed fraction of the way into the box) lands exactly on h1Target.
  const finalLeft = h1Target.left - nameOffsetX * zoomScale
  const finalTop = h1Target.top - nameOffsetY * zoomScale

  // 3) build the free-floating clone: a small standalone <svg> containing a direct copy of the
  // label group, so every glyph, textLength and stroke is pixel-for-pixel what the bottle drew.
  // Resizing is done by animating this svg's own width/height attributes (a real vector
  // re-render every frame, never blurry) - translate is the only transform used for position.
  const SVG_NS = "http://www.w3.org/2000/svg"
  const cloneSvg = document.createElementNS(SVG_NS, "svg") as unknown as SVGSVGElement
  cloneSvg.setAttribute("viewBox", viewLabel)
  cloneSvg.setAttribute("width", `${outerAtZoom.width}`)
  cloneSvg.setAttribute("height", `${outerAtZoom.height}`)
  cloneSvg.style.cssText = `position:fixed;left:${outerAtZoom.left}px;top:${outerAtZoom.top}px;transform-origin:0 0;pointer-events:none;overflow:visible;z-index:${CLONE_Z};color:${getComputedStyle(h1).color};`

  const cloneGroup = label.cloneNode(true) as SVGGElement
  // drop the opacity anime set on the original label and its four texts at setup time - the
  // clone has its own independent, always-visible lifecycle.
  cloneGroup.removeAttribute("style")
  cloneGroup.querySelectorAll("[style]").forEach((el) => el.removeAttribute("style"))
  cloneGroup.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id")) // avoid dupe ids
  const cloneRectBg = cloneGroup.querySelector<SVGRectElement>(".btb-label-bg")
  if (cloneRectBg) cloneRectBg.style.fill = "var(--light)" // that class's fill rule is scoped
  const cloneTexts = Array.from(cloneGroup.querySelectorAll<SVGTextElement>("text"))
  const [cloneProducer, , cloneOrigin, cloneVintage] = cloneTexts
  const grayColor = getComputedStyle(metaTop).color
  for (const t of [cloneProducer, cloneOrigin, cloneVintage]) t.style.fill = grayColor
  cloneSvg.appendChild(cloneGroup)
  document.body.appendChild(cloneSvg)

  // where producer/origin/vintage will actually be once the label lands - used to give them a
  // small corrective nudge onto the real small lines during the landing cross-fade, since the
  // single whole-label calibration above is only exact for the name line. A CSS transform on
  // an SVG child is read in the svg's own user-space units, not screen pixels, so the desired
  // on-screen nudge has to be divided by the landed scale before it's handed to anime.
  const landedBox: Rect = { left: finalLeft, top: finalTop, width: finalW, height: finalH }
  const landedScale = finalW / lr.w
  const producerLanded = projectRect(landedBox, view, bboxOf(producerText))
  const originLanded = projectRect(landedBox, view, bboxOf(originText))
  const vintageLanded = projectRect(landedBox, view, bboxOf(vintageText))
  const producerNudge = {
    x: (metaTopTarget.left - producerLanded.left) / landedScale,
    y: (metaTopTarget.top - producerLanded.top) / landedScale,
  }
  const originNudge = {
    x: (metaBottomTarget.left - originLanded.left) / landedScale,
    y: (metaBottomTarget.top - originLanded.top) / landedScale,
  }
  const vintageNudge = {
    x: (metaBottomTarget.left - vintageLanded.left) / landedScale,
    y: (metaBottomTarget.top - vintageLanded.top) / landedScale,
  }

  utils.set(cloneSvg, { opacity: 0 })

  const startPoint = { x: outerAtZoom.left, y: outerAtZoom.top }
  const endPoint = { x: finalLeft, y: finalTop }
  const control = arcControlPoint(startPoint, endPoint, 0.15)

  // lift: tilts to 1deg and grows 3% in place, about to detach from the bottle scene
  const applyLift = (t: number) => {
    cloneSvg.setAttribute("width", `${lerp(outerAtZoom.width, liftedW, t)}`)
    cloneSvg.setAttribute("height", `${lerp(outerAtZoom.height, liftedH, t)}`)
    cloneSvg.style.transform = `rotate(${lerp(0, 1, t)}deg)`
  }

  // flight: one hand-rolled progress driver moves the whole label as a rigid piece along a
  // gentle arc, easing to a smooth stop (no bounce) while the tilt relaxes back to 0.
  const applyFlight = (t: number) => {
    const pos = quadraticBezier(startPoint, control, endPoint, t)
    const tx = pos.x - outerAtZoom.left
    const ty = pos.y - outerAtZoom.top
    cloneSvg.style.transform = `translate(${tx}px, ${ty}px) rotate(${lerp(1, 0, t)}deg)`
    cloneSvg.setAttribute("width", `${lerp(liftedW, finalW, t)}`)
    cloneSvg.setAttribute("height", `${lerp(liftedH, finalH, t)}`)
  }

  // 4) put the DOM back to the plain artwork, which is also the finished state
  let finished = false
  const removeClone = () => cloneSvg.remove()
  const finalize = () => {
    if (finished) return
    finished = true
    svgEl.removeAttribute("style")
    svgEl.querySelectorAll("[style]").forEach((el) => el.removeAttribute("style"))
    for (const el of drawn) {
      el.removeAttribute("pathLength")
      el.removeAttribute("stroke-dasharray")
      el.removeAttribute("stroke-dashoffset")
    }
    wine.setAttribute("d", restWineD)
    svgEl.setAttribute("viewBox", VIEW_FULL)
    art.removeAttribute("style")
    h1.removeAttribute("style")
    metaTop.removeAttribute("style")
    metaBottom.removeAttribute("style")
    removeClone()
    root.dataset.btbAnim = "done"
  }

  // 5) timeline. Times are in ms.
  const tl = createTimeline({
    autoplay: false,
    defaults: { ease: "inOutQuad" },
    onComplete: finalize,
  })

  // ground line, soil dots, then the empty bottle
  tl.add(groundD, { draw: ["0 0", "0 1"], duration: 500 }, 0)
  tl.add(soilDots, { opacity: [0, 1], duration: 400, delay: stagger(40) }, 100)
  tl.add(bottleD, { draw: ["0 0", "0 1"], duration: 650, ease: "inOutSine" }, 500)

  // roots grow from the bottle bottom into the ground, faint
  tl.add(rootsD, { draw: ["0 0", "0 1"], duration: 600, delay: stagger(70) }, 1050)

  // sap is drawn over the roots, from the root tips up to the bottle bottom
  tl.add(sapD, { draw: ["0 0", "0 1"], duration: 550, delay: stagger(70) }, 1500)

  // wine rises from below the bottle: fast first, then slowing. The wave flows sideways and
  // its height dies down so it ends calm. Colour goes from pale to the final opacity.
  tl.add(
    wave,
    {
      level: { to: WAVE_LEVEL_END, ease: "outQuart" },
      amp: { to: WAVE_AMP_END, ease: "outQuad" },
      phase: { to: Math.PI * 2, ease: "outSine" },
      duration: 1400,
      onUpdate: renderWave,
    },
    2100,
  )
  tl.add(wine, { fillOpacity: [0.08, 0.28], duration: 1400, ease: "outQuad" }, 2100)

  // cork drops into the neck with a small bounce, then the capsule slides over it
  tl.add(cork, { opacity: [0, 1], duration: 120, ease: "linear" }, 3300)
  tl.add(cork, { translateY: [-24, 0], duration: 400, ease: "outBack(2.4)" }, 3300)
  tl.add(capsule, { opacity: [0, 1], duration: 150, ease: "linear" }, 3600)
  tl.add(capsule, { translateY: [-16, 0], duration: 400, ease: "outCubic" }, 3600)

  // label: border is drawn, then the text fades in line by line
  tl.add(label, { opacity: [0, 1], duration: 120, ease: "linear" }, 3900)
  tl.add(labelRectD, { draw: ["0 0", "0 1"], duration: 350 }, 3900)
  tl.add(labelTexts, { opacity: [0, 1], duration: 250, delay: stagger(50) }, 4150)

  // roots and sap drop a little and fade out, as if cut off from the ground
  tl.add(
    [rootsGroup, sapGroup],
    { translateY: [0, 10], opacity: 0, duration: 500, ease: "inQuad" },
    4500,
  )

  // finale: zoom onto the label (viewBox only), detach it as a floating clone, fly it to the
  // title on a gentle arc while the bottle scene fades and its box collapses, then land.
  const ZOOM_START = 5000
  const ZOOM_DUR = 700
  const LIFT_DUR = 150
  const FLIGHT_DUR = 900
  const LAND_DUR = 300
  const zoomEnd = ZOOM_START + ZOOM_DUR
  const liftEnd = zoomEnd + LIFT_DUR
  const flightEnd = liftEnd + FLIGHT_DUR

  tl.add(
    svgEl,
    { viewBox: [VIEW_FULL, viewLabel], duration: ZOOM_DUR, ease: "inOutQuart" },
    ZOOM_START,
  )

  // hand-off: the clone appears and the in-svg label disappears in the same instant
  tl.set(cloneSvg, { opacity: 1 }, zoomEnd)
  tl.set(label, { opacity: 0 }, zoomEnd)

  // lift: the label floats up slightly - bigger, tilted 1deg, with a soft shadow - about to
  // detach as one piece. Width/height (not transform:scale) do the resizing, so it stays crisp.
  const liftProgress = { t: 0 }
  tl.add(
    liftProgress,
    { t: 1, duration: LIFT_DUR, ease: "outQuad", onUpdate: () => applyLift(liftProgress.t) },
    zoomEnd,
  )
  tl.set(cloneSvg, { filter: "drop-shadow(0 6px 10px rgba(0,0,0,.18))" }, zoomEnd)

  // flight: one hand-rolled progress driver moves the whole label together - same path, same
  // speed - easing to a smooth stop (no bounce), tilt relaxing to 0 as it goes.
  const flightProgress = { t: 0 }
  tl.add(
    flightProgress,
    {
      t: 1,
      duration: FLIGHT_DUR,
      ease: "outQuart",
      onUpdate: () => applyFlight(flightProgress.t),
    },
    liftEnd,
  )
  tl.add(
    [ground, bottle, wine, cork, capsule],
    { opacity: 0, duration: FLIGHT_DUR, ease: "linear" },
    liftEnd,
  )
  tl.add(
    art,
    { height: [`${artHeight}px`, "0px"], duration: FLIGHT_DUR, ease: "inOutQuart" },
    liftEnd,
  )

  // landing: the clone (background, borders, divider and all) melts away as one fade, while
  // the real title cross-fades in. Producer/origin/vintage get a last small nudge onto the
  // real small lines' exact positions as they go, since only the name line was calibrated.
  tl.add(cloneSvg, { opacity: 0, duration: LAND_DUR, ease: "linear" }, flightEnd)
  tl.add(
    cloneProducer,
    {
      translateX: [0, producerNudge.x],
      translateY: [0, producerNudge.y],
      duration: LAND_DUR,
      ease: "outQuad",
    },
    flightEnd,
  )
  tl.add(
    cloneOrigin,
    {
      translateX: [0, originNudge.x],
      translateY: [0, originNudge.y],
      duration: LAND_DUR,
      ease: "outQuad",
    },
    flightEnd,
  )
  tl.add(
    cloneVintage,
    {
      translateX: [0, vintageNudge.x],
      translateY: [0, vintageNudge.y],
      duration: LAND_DUR,
      ease: "outQuad",
    },
    flightEnd,
  )
  tl.add(
    [h1, metaTop, metaBottom],
    { opacity: [0, 1], duration: LAND_DUR, ease: "linear" },
    flightEnd,
  )

  const skip = () => {
    tl.complete()
    finalize()
  }
  const dispose = () => {
    tl.cancel()
    removeClone()
    root.removeEventListener("click", skip)
  }

  root.addEventListener("click", skip)
  root.dataset.btbAnim = "playing"
  tl.play()

  return { dispose, skip }
}

document.addEventListener("nav", () => {
  const root = document.querySelector<HTMLElement>(".btb-logo")
  // the component is only rendered on the index page, the slug check is a second guard
  if (!root || document.body.dataset.slug !== "index") return

  const art = root.querySelector<HTMLElement>(".btb-logo-art")
  const svgEl = art?.querySelector<SVGSVGElement>("svg")
  const metaTop = root.querySelector<HTMLElement>(".btb-meta-top")
  const h1 = document.querySelector<HTMLElement>("h1.article-title")
  const metaBottom = document.querySelector<HTMLElement>(".btb-meta-bottom")

  if (!shouldPlay() || !art || !svgEl || !metaTop || !h1 || !metaBottom) {
    root.dataset.btbAnim = "static"
    return
  }

  markPlayed()

  let cancelled = false
  window.addCleanup(() => {
    cancelled = true
  })

  // the finale measures h1/metaTop/metaBottom's real on-screen rects once, up front - wait
  // for web fonts first so those rects reflect their final metrics, not a fallback font's.
  Promise.resolve(document.fonts?.ready)
    .catch(() => {})
    .then(() => {
      if (cancelled || !document.contains(root)) return
      const player = createPlayer(root, art, svgEl, h1, metaTop, metaBottom)
      window.addCleanup(() => player.dispose())
    })
})
