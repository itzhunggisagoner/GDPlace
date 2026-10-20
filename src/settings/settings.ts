import { pixiApp } from "../editor/app"
import { writable } from "svelte/store"

const DEAFULT_SETTINGS = {
    showDeletion: {
        enabled: true,
        label: "Show who deleted an object ",
    },
    showTooltips: {
        enabled: true,
        label: "Show who placed an object",
    },
    disableBG: {
        enabled: false,
        label: "Disable background colors",
    },
    showGrid: {
        enabled: true,
        label: "Show grid lines",
        cb: () => {
            pixiApp?.editorNode?.toggleGrid()
        },
    },
    hideGround: {
        enabled: false,
        label: "Hide ground",
        cb: () => {
            pixiApp?.editorNode?.toggleGround()
        },
    },
    showObjInfo: {
        enabled: false,
        label: "Show object info on select",
    },
    disableObjectOutline: {
        enabled: false,
        label: "Hide selection outline",
    },
    showBuildBox: {
        enabled: true,
        label: "Show build area box",
        cb: () => {
            pixiApp?.editorNode?.redrawAreaBox()
        },
    },
    hideDecoObjects: {
        enabled: false,
        label: "Hide decoration objects",
        cb: () => {
            pixiApp?.editorNode?.toggleDecoObjects()
        },
    },
    showDanger: {
        enabled: false,
        label: "Reveal dangerous objects",
        cb: () => {
            pixiApp?.editorNode?.toggleDangerObjects()
        },
    },
    hideMenu: {
        enabled: false,
        label: "Hide menu",
    },
}

export let settings_writable: any = writable(DEAFULT_SETTINGS)
export let settings: any = DEAFULT_SETTINGS

try {
    let savedSettings: any = localStorage.getItem("editorSettings")

    if (savedSettings) {
        savedSettings = JSON.parse(savedSettings)
        let new_settings = DEAFULT_SETTINGS
        Object.keys(savedSettings).forEach((k) => {
            new_settings[k].enabled = !!savedSettings[k]
        })
        settings_writable.set(new_settings)
    }
} catch (e) {
    console.error(e)
    localStorage.removeItem("editorSettings")
}

export const saveSettings = () => {
    let s = {}
    Object.keys(settings).forEach((k) => {
        s[k] = settings[k]?.enabled || false
    })

    localStorage.setItem("editorSettings", JSON.stringify(s))
}

// ---- music volume ----
// music volume 0..1 (applied on top of the global volume set in utils/audio.ts)
const loadVolume = () => {
    try {
        const v = parseFloat(localStorage.getItem("editorMusicVolume") ?? "")
        if (Number.isFinite(v)) return Math.min(1, Math.max(0, v))
    } catch {}
    return 1
}
export const musicVolume = writable<number>(loadVolume())
let _musicVolume = loadVolume()
musicVolume.subscribe((v) => {
    _musicVolume = v
    try {
        localStorage.setItem("editorMusicVolume", String(v))
    } catch {}
    try {
        pixiApp?.music?.volume(v)
    } catch {}
})
export const getMusicVolume = () => _musicVolume
