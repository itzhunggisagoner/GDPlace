import { writable } from "svelte/store"

// GD-style notifications: shown one at a time in the middle of the screen
// (gold title, chat-font text, OK button). See NotificationHost.svelte.
export type Notice = {
    id: number
    kind: "success" | "error" | "info"
    title: string
    msg: string
}

const TITLES = { success: "Success", error: "Error", info: "Notice" }

export const notices = writable<Notice[]>([])
let nextId = 1

export const toast = {
    push(msg: any, opts: any = {}) {
        const kind: Notice["kind"] = opts.kind ?? "info"
        const text = typeof msg === "string" ? msg : String(msg?.message ?? msg)
        const id = nextId++
        notices.update((list) =>
            // don't stack identical notifications
            list.some((n) => n.kind === kind && n.msg === text)
                ? list
                : [...list, { id, kind, title: TITLES[kind], msg: text }]
        )
        return id
    },
    // pop(id) closes one notification, pop() closes all of them
    pop(id?: number) {
        notices.update((list) =>
            id === undefined ? [] : list.filter((n) => n.id !== id)
        )
    },
}
