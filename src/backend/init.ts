// API layer for the Cloudflare Worker (replaces Firebase init)

// difference between the client clock and the server clock (ms): local = server + skew
export let skew = 0
export const syncClock = (serverTime: number) => {
    if (typeof serverTime === "number") skew = Date.now() - serverTime
}
export const serverToLocal = (t: number) => (t ? t + skew : 0)

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`/api/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
    })
    let data: any = null
    try {
        data = await res.json()
    } catch {}
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
    return data as T
}

export const placeObject = (d: { text: string }) => api("place", d)
export const placeObjects = (d: { texts: string[] }) => api("place-batch", d)
export const deleteObject = (d: { objId: string; chunkId: string }) =>
    api("delete", d)
