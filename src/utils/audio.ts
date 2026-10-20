import { Howl, Howler, type HowlOptions } from "howler"

// Browsers block AudioContext until the user interacts with the page, and
// Howler creates one as soon as a Howl (or Howler.volume) is touched, which
// spams "The AudioContext was not allowed to start" in the console.
// So every sound is created lazily, after the first user gesture.

// only these events count as a "user activation" for Chrome/Safari autoplay rules
const EVENTS = ["click", "pointerup", "touchend", "keydown"]

let unlocked = false
const waiting: (() => void)[] = []

const unlock = () => {
    if (unlocked) return
    unlocked = true
    for (const ev of EVENTS) window.removeEventListener(ev, unlock, true)
    Howler.volume(0.25) // global volume
    waiting.splice(0).forEach((fn) => fn())
}

for (const ev of EVENTS) window.addEventListener(ev, unlock, true)

export class LazyHowl {
    private howl: Howl | null = null
    private vol: number | null = null

    constructor(private opts: HowlOptions) {
        if (unlocked) this.create()
        else waiting.push(() => this.create())
    }

    private create() {
        this.howl = new Howl(this.opts)
        if (this.vol != null) this.howl.volume(this.vol)
    }

    play() {
        return this.howl?.play()
    }

    stop() {
        this.howl?.stop()
    }

    seek(pos?: number): number {
        if (!this.howl) return 0
        if (pos === undefined) return Number(this.howl.seek()) || 0
        this.howl.seek(pos)
        return pos
    }

    volume(v: number) {
        this.vol = v
        this.howl?.volume(v)
    }
}
