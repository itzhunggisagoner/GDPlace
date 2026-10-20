import { derived, writable, type Writable } from "svelte/store"
import { api, syncClock, serverToLocal } from "./init"

export type UserProperties = {
    username: string
    lastPlaced: number
    lastDeleted: number
    placeTimer: number | null
    deleteTimer: number | null
    admin?: boolean
    banned?: boolean
    displayColor?: string | null
}
export type UserData = {
    user: { uid: string }
    data: UserProperties | null // null = no data yet
}

export const currentUserData: Writable<UserData | null> = writable(null)
export const currentUserDisplayColor: Writable<string> = writable(null)

export const canEdit = derived(
    currentUserData,
    (value) =>
        value != null &&
        typeof value != "string" &&
        value.data != null &&
        typeof value.data != "string" &&
        !value.data.banned
)

// receive `me` from the server (timestamps converted to the client clock)
export function applyMe(me: any | null) {
    if (!me) {
        currentUserData.set(null)
        return
    }
    const data: UserProperties = {
        username: me.username,
        lastPlaced: serverToLocal(me.lastPlaced),
        lastDeleted: serverToLocal(me.lastDeleted),
        placeTimer: me.placeTimer,
        deleteTimer: me.deleteTimer,
        admin: me.admin,
        banned: me.banned,
        displayColor: me.displayColor,
    }
    // only emit when something changed (the Editor plays a sound every time the store changes)
    currentUserData.update((cur) => {
        if (
            cur?.data &&
            cur.user.uid === String(me.uid) &&
            JSON.stringify(cur.data) === JSON.stringify(data)
        )
            return cur
        return { user: { uid: String(me.uid) }, data }
    })
}

export const patchUser = (patch: Partial<UserProperties>) =>
    currentUserData.update((v) =>
        v && v.data ? { ...v, data: { ...v.data, ...patch } } : v
    )

export async function signIn(username: string, password: string) {
    const r = await api("login", { username, password })
    syncClock(r.serverTime)
    applyMe(r.me)
    return r.me
}

export async function signOut() {
    await api("logout", {})
    currentUserData.set(null)
}
