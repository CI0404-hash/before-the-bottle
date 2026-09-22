import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { classNames } from "../util/lang"
import style from "./styles/btblogo.scss"

// The small line under the title. Sits right after ArticleTitle so it shares its layout box
// with no extra JS: see the "no leftover space" note in btblogo.inline.ts.
const BtbSubtitle: QuartzComponent = ({ displayClass }: QuartzComponentProps) => {
  return <p class={classNames(displayClass, "btb-meta-bottom")}>Soil · Vine · Cellar · 2026</p>
}

BtbSubtitle.css = style

export default (() => BtbSubtitle) satisfies QuartzComponentConstructor
