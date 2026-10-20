// Shared state fetched from /api/state (replaces Firebase's onValue listeners)
import { writable } from "svelte/store"
import { api, syncClock } from "./init"
import { applyMe } from "./auth"
import defaultColors from "../defaultColors.json"
import { toast } from "../ui/notify"

export type EditorState = {
    placeTimer: number
    deleteTimer: number
    canEdit: boolean
}

export const editorState = writable<EditorState | null>(null)
export const placeTimerMaxCommon = writable<number>(0)
export const deleteTimerMaxCommon = writable<number>(0)
export type GlobalMessage = { id: string; text: string }
export const globalMessage = writable<GlobalMessage | null>(null)
export const adminSettings = writable<{ chunkObjectLimit: number | null } | null>(null)
// build area size in grid cells (set by admins)
export const levelSize = writable<{ width: number; height: number } | null>(null)
export const streamLink = writable<string | null>(null)
export const userCount = writable<number | null>(null)
export const totals = writable({ placed: 0, deleted: 0 })
export const colorChanges = writable<{ BG_CHANGES: any[]; GROUND_CHANGES: any[] }>({
    BG_CHANGES: defaultColors.BG_CHANGES,
    GROUND_CHANGES: defaultColors.GROUND_CHANGES,
})

// Global message from an admin: shown as a normal notification (same popup as "Message sent"),
// once per message id on this browser.
const SEEN_KEY = "gdplace_seen_message"
function announce(m: GlobalMessage | null) {
    if (!m) return
    let seen = ""
    try {
        seen = localStorage.getItem(SEEN_KEY) || ""
    } catch {}
    if (m.id === seen) return
    try {
        localStorage.setItem(SEEN_KEY, m.id)
    } catch {}
    toast.push(m.text, { kind: "info" })
}

// "Reload everyone's page" (Admin). The editor registers a hook that saves the user's
// progress before the page reloads.
export const reloadHook: { fn: (() => void) | null } = { fn: null }
const RELOAD_SEEN_KEY = "gdplace_seen_reload"
function checkReload(id: string | null | undefined) {
    const cur = id ? String(id) : "0"
    let seen: string | null = null
    try {
        seen = localStorage.getItem(RELOAD_SEEN_KEY)
    } catch {}
    try {
        localStorage.setItem(RELOAD_SEEN_KEY, cur)
    } catch {}
    // first visit on this browser: only remember the current id
    if (seen === null || seen === cur) return
    if (reloadHook.fn) reloadHook.fn()
    else window.location.reload()
}

export let serverSeq = 0
let resolveReady: () => void
export const ready = new Promise<void>((r) => (resolveReady = r))

export async function refreshState() {
    try {
        const s = await api("state")
        syncClock(s.serverTime)
        if (!serverSeq) serverSeq = s.seq
        editorState.set(s.editorState)
        placeTimerMaxCommon.set(s.editorState.placeTimer)
        deleteTimerMaxCommon.set(s.editorState.deleteTimer)
        const rawStreamLink = String(s.streamLink || "").trim()
        let safeStreamLink: string | null = null
        if (rawStreamLink && rawStreamLink.length <= 300) {
            try {
                const parsed = new URL(rawStreamLink)
                if (
                    (parsed.protocol === "https:" || parsed.protocol === "http:") &&
                    parsed.hostname &&
                    !parsed.username &&
                    !parsed.password
                ) safeStreamLink = parsed.toString()
            } catch {}
        }
        streamLink.set(safeStreamLink)
        globalMessage.set(s.message ?? null)
        announce(s.message ?? null)
        checkReload(s.reloadId)
        adminSettings.set(s.adminSettings ?? null)
        if (s.level) levelSize.set({ width: +s.level.width, height: +s.level.height })
        userCount.set(s.userCount)
        totals.set({ placed: s.totalPlaced, deleted: s.totalDeleted })
        colorChanges.set(s.colors)
        applyMe(s.me)
    } catch (e) {
        console.error("state refresh failed", e)
    } finally {
        resolveReady()
    }
}

refreshState()
setInterval(() => {
    if (!document.hidden) refreshState()
}, 5000)
