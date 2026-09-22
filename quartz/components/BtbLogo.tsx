import fs from "fs"
import path from "path"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
// @ts-ignore
import script from "./scripts/btblogo.inline"
import style from "./styles/btblogo.scss"

// Runs while the page is parsed, before the deferred scripts, so the animation can be armed
// (or not) before the first paint. Keep this in sync with shouldPlay() in btblogo.inline.ts.
const armScript = `(function(){try{var r=document.currentScript.closest(".btb-logo");if(!r)return;if(!matchMedia("(prefers-reduced-motion: reduce)").matches&&sessionStorage.getItem("btb-logo-played")===null){r.dataset.btbAnim="playing"}}catch(e){}})()`

const BtbLogo: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
  // quartz/static/logo.svg is the single source of the artwork. Quartz always runs from the
  // project root, so the path is resolved from the working directory.
  let svg: string
  try {
    svg = fs.readFileSync(path.join(process.cwd(), "quartz", "static", "logo.svg"), "utf8")
  } catch {
    return null
  }

  return (
    <div class={classNames(displayClass, "btb-logo")}>
      <p class="btb-meta-top">CHANIL PARK</p>
      <div
        class="btb-logo-art"
        role="img"
        aria-label="Before the Bottle"
        dangerouslySetInnerHTML={{ __html: `${svg}<script>${armScript}</script>` }}
      />
    </div>
  )
}

BtbLogo.afterDOMLoaded = script
BtbLogo.css = style

export default (() => BtbLogo) satisfies QuartzComponentConstructor
