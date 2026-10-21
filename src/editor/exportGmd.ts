// Export the whole level as a Geometry Dash .gmd file (level name "gdplace",
// description = the website's address).
import { GDObject, GdColor } from "./object"
import { api } from "../backend/init"

const LEVEL_NAME = "gdplace"

const b64url = (bytes: Uint8Array) => {
    let bin = ""
    const step = 0x8000
    for (let i = 0; i < bytes.length; i += step)
        bin += String.fromCharCode(...bytes.subarray(i, i + step))
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_")
}

const gzip = async (text: string) => {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))
    return new Uint8Array(await new Response(stream).arrayBuffer())
}

const rgb = (hex: string) => {
    const n = parseInt(hex, 16) || 0
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// level header: BG + ground colours, then one custom colour channel per distinct colour used
function buildHeader(channelStrings: string[]) {
    const base = [
        "1_40_2_125_3_255_11_255_12_255_13_255_4_-1_6_1000_7_1_15_1_18_0_8_1",
        "1_0_2_102_3_255_11_255_12_255_13_255_4_-1_6_1001_7_1_15_1_18_0_8_1",
        "1_0_2_102_3_255_11_255_12_255_13_255_4_-1_6_1009_7_1_15_1_18_0_8_1",
        "1_255_2_255_3_255_11_255_12_255_13_255_4_-1_6_1002_5_1_7_1_15_1_18_0_8_1",
    ]
    const all = [...base, ...channelStrings].join("|") + "|"
    return (
        `kS38,${all},kA13,0,kA15,0,kA16,0,kA14,,kA6,0,kA7,0,kA25,0,kA17,0,kA18,0,kS39,0,` +
        `kA2,0,kA3,0,kA8,0,kA4,0,kA9,0,kA10,0,kA22,0,kA23,0,kA24,0,kA27,1,kA28,0,kA29,0,` +
        `kA31,1,kA32,1,kA36,0,kA43,0,kA44,0,kA45,1,kA46,0,kA33,1,kA34,1,kA35,0,kA37,1,` +
        `kA38,1,kA39,1,kA40,1,kA41,1,kA42,1,kA48,1,kA11,0;`
    )
}

export async function exportGmd() {
    // admin-only: the server checks the admin session
    const { objects } = (await api("admin", { action: "exportLevel" })) as { objects: string[] }

    const channels = new Map<string, number>()
    const channelStrings: string[] = []
    const channelOf = (c: GdColor) => {
        const key = `${c.hex}|${c.blending ? 1 : 0}|${c.opacity}`
        let id = channels.get(key)
        if (id === undefined) {
            id = Math.min(channels.size + 1, 999)
            channels.set(key, id)
            const [r, g, b] = rgb(c.hex)
            channelStrings.push(
                `1_${r}_2_${g}_3_${b}_11_255_12_255_13_255_4_-1` +
                    `${c.blending ? "_5_1" : ""}_6_${id}_7_${Number.isFinite(c.opacity) ? c.opacity : 1}_15_1_18_0_8_1`
            )
        }
        return id
    }

    const parts: string[] = []
    for (const s of objects) {
        let o: GDObject
        try {
            o = GDObject.fromDatabaseString(s)
        } catch {
            continue
        }
        if (!Number.isFinite(o.id) || !Number.isFinite(o.x) || !Number.isFinite(o.y)) continue
        let p = `1,${o.id},2,${o.x},3,${o.y}`
        if (o.flip) p += ",4,1"
        if (o.rotation) p += `,6,${o.rotation}`
        if (o.scale && o.scale !== 1) p += `,32,${o.scale}`
        if (o.zOrder) p += `,25,${o.zOrder}`
        p += `,21,${channelOf(o.mainColor)},22,${channelOf(o.detailColor)}`
        parts.push(p)
    }

    const levelData = buildHeader(channelStrings) + parts.join(";") + (parts.length ? ";" : "")
    const levelString = b64url(await gzip(levelData))
    const desc = b64url(new TextEncoder().encode(window.location.host))

    const gmd =
        `<?xml version="1.0"?><plist version="1.0" gjver="2.0"><dict>` +
        `<k>kCEK</k><i>4</i><k>k2</k><s>${LEVEL_NAME}</s><k>k3</k><s>${desc}</s>` +
        `<k>k4</k><s>${levelString}</s><k>k5</k><s>gdplace</s><k>k13</k><t /><k>k21</k><i>2</i>` +
        `<k>k16</k><i>1</i><k>k80</k><i>0</i><k>k50</k><i>45</i></dict></plist>`

    const url = URL.createObjectURL(new Blob([gmd], { type: "application/octet-stream" }))
    const a = document.createElement("a")
    a.href = url
    a.download = `${LEVEL_NAME}.gmd`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    return parts.length
}
