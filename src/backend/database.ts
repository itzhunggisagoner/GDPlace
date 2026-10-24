import * as PIXI from "pixi.js"
import type * as PIXI_LAYERS from "@pixi/layers"
import { writable } from "svelte/store"
import { GDObject, getObjSettings } from "../editor/object"
import {
    DeleteObjectLabel,
    EditorNode,
    LEVEL_BOUNDS,
    ObjectNode,
    resetObjectColors,
} from "../editor/nodes"
import { api, deleteObject, placeObject, placeObjects, serverToLocal } from "./init"
import { vec } from "../utils/vector"
import { canEdit, patchUser } from "./auth"
import { pixiApp, selectedObject, TIMELAPSE_MODE } from "../editor/app"
import { settings } from "../settings/settings"
import {
    placeTimerMaxCommon,
    deleteTimerMaxCommon,
    streamLink,
    userCount,
    serverSeq,
} from "./state"

export { placeTimerMaxCommon, deleteTimerMaxCommon, streamLink, userCount }

export const CHUNK_SIZE = vec(20 * 30, 20 * 30)

let canEditValue = false
canEdit.subscribe((value) => {
    canEditValue = value
})

export async function getHistory() {
    // only used by timelapse mode (currently disabled)
    return {}
}

let userColorCache: Record<string, number[]> = {}
export async function getUsernameColors(username: string): Promise<number[]> {
    if (!username) return [0xffffff]
    if (userColorCache[username]) {
        return [...userColorCache[username]]
    }

    let color: number[]
    try {
        const r = await api<{ color: string | null }>(
            `color?u=${encodeURIComponent(username)}`
        )
        color = r.color
            ? r.color.split(" ").map((a) => parseInt(a, 16))
            : [0xffffff]
    } catch {
        color = [0xffffff]
    }

    userColorCache[username] = [...color]

    return [...color]
}

// ---------------------------------------------------------------------------
// Chunk sync: load a snapshot once + poll /api/changes periodically
// (replaces Firebase's onChildAdded / onChildRemoved)
// ---------------------------------------------------------------------------
type ChunkHandlers = {
    sync: (objects: Record<string, string>) => void
    add: (key: string, data: string) => void
    remove: (key: string, by: string) => void
}
const chunkSubs = new Map<string, ChunkHandlers>()

async function fetchChunk(name: string, h: ChunkHandlers) {
    try {
        const r = await api<{ seq: number; objects: Record<string, string> }>(
            `chunk?c=${name}`
        )
        if (chunkSubs.get(name) === h) h.sync(r.objects)
    } catch (e) {
        console.error("chunk load failed", name, e)
    }
}

export function refreshChunk(name: string) {
    const h = chunkSubs.get(name)
    if (h) return fetchChunk(name, h)
}

export function subscribeChunk(name: string, h: ChunkHandlers) {
    chunkSubs.set(name, h)
    fetchChunk(name, h)
    return () => {
        if (chunkSubs.get(name) === h) chunkSubs.delete(name)
    }
}

let lastSeq = -1
let polling = false
let pollAgain = false
export async function pollChangesNow() {
    // a call made while a poll is running used to be dropped, so an object placed right then only
    // showed up on the next 2.5 s tick (swipe places many): remember it and poll once more
    if (polling) {
        pollAgain = true
        return
    }
    polling = true
    try {
        if (lastSeq < 0) {
            lastSeq = serverSeq
            if (!lastSeq) {
                const s = await api("state")
                lastSeq = s.seq
            }
        }
        for (let n = 0; n < 20; n++) {
            const r = await api<{
                seq: number
                more: boolean
                reset: boolean
                changes: {
                    seq: number
                    chunk: string
                    key: string
                    kind: "add" | "del"
                    data: string
                    by: string
                }[]
            }>(`changes?since=${lastSeq}`)
            if (r.reset) {
                chunkSubs.forEach((h, name) => fetchChunk(name, h))
            }
            for (const c of r.changes) {
                const h = chunkSubs.get(c.chunk)
                if (!h) continue
                if (c.kind === "add") h.add(c.key, c.data)
                else h.remove(c.key, c.by)
            }
            lastSeq = r.seq
            if (!r.more) break
        }
    } catch (e) {
        console.error("changes poll failed", e)
    } finally {
        polling = false
        if (pollAgain) {
            pollAgain = false
            pollChangesNow()
        }
    }
}
setInterval(() => {
    if (!document.hidden && chunkSubs.size > 0) pollChangesNow()
}, 2500)

export const initChunkBehavior = (
    editorNode: EditorNode,
    worldNode: PIXI.Container,
    selectableWorldNode: PIXI.Container,
    layerGroup: PIXI_LAYERS.Group,
    selectableLayerGroup: PIXI_LAYERS.Group
) => {
    for (
        let x = LEVEL_BOUNDS.start.x;
        x <= LEVEL_BOUNDS.end.x;
        x += CHUNK_SIZE.x
    ) {
        for (
            let y = LEVEL_BOUNDS.start.y;
            y <= LEVEL_BOUNDS.end.y;
            y += CHUNK_SIZE.y
        ) {
            const chunk = new ChunkNode(
                x,
                y,
                editorNode,
                selectableWorldNode,
                layerGroup,
                selectableLayerGroup
            )

            worldNode.addChild(chunk)
        }
    }
}

export const addObjectToLevel = async (obj: GDObject) => {
    const data = obj.toDatabaseString()
    const r = await placeObject({ text: data })
    patchUser({ lastPlaced: serverToLocal(r.lastPlaced) })
    pollChangesNow()
    return r
}

// Commit a staged set in one request. The server checks cooldown and permissions once
// for the entire batch, while each object remains individually validated and recorded.
export const addObjectsToLevel = async (objects: GDObject[]) => {
    if (!objects.length) throw new Error("No objects to place")
    if (objects.length > 100) throw new Error("You can place at most 100 objects at once")

    const texts = objects.map((obj) => obj.toDatabaseString())
    const r = await placeObjects({ texts })
    patchUser({ lastPlaced: serverToLocal(r.lastPlaced) })

    // Display committed objects immediately on this client rather than waiting for polling.
    for (const item of r.objects ?? []) {
        const h = chunkSubs.get(item.chunk)
        if (h) h.add(String(item.key), item.text)
    }
    pollChangesNow()
    return r
}

export const deleteObjectFromLevel = async (
    objName: string,
    chunkName: string
) => {
    const r = await deleteObject({ objId: objName, chunkId: chunkName })
    patchUser({ lastDeleted: serverToLocal(r.lastDeleted) })
    pollChangesNow()
    return r
}

// Kept for compatibility. Category filtering is done by Editor.svelte (reactive),
// and hiding the buttons here left re-used DOM nodes permanently hidden.
export function updateObjectCategory(_newtab?: string) {}

export class ChunkNode extends PIXI.Container {
    public load = null
    unsub1 = null
    unsub2 = null

    public addObject: (key: string, obj: GDObject) => void = null
    public removeObject: (key: string) => void = null
    public sync: (objects: Record<string, string>) => void = null

    public lastTimeVisible: number = 0
    public loaded: boolean = false
    //marker: PIXI.Graphics = null
    public selectableChunk: PIXI.Container = null

    constructor(
        x: number,
        y: number,
        editorNode: EditorNode,
        selectableWorldNode: PIXI.Container,
        layerGroup: PIXI_LAYERS.Group,
        selectableLayerGroup: PIXI_LAYERS.Group
    ) {
        super()

        let i = x / 20 / 30
        let j = y / 20 / 30
        let chunkName = `${i},${j}`
        this.name = chunkName
        this.visible = false

        // draw box
        // this.marker = new PIXI.Graphics()
        // this.marker.lineStyle(1, 0xffffff, 1)
        // this.marker.drawRect(x, y, CHUNK_SIZE.x, CHUNK_SIZE.y)

        // this.addChild(this.marker)

        this.selectableChunk = new PIXI.Container()
        this.selectableChunk.name = chunkName
        selectableWorldNode.addChild(this.selectableChunk)

        this.addObject = (key: string, obj: GDObject) => {
            let objectNode = new ObjectNode(obj, layerGroup, editorNode.tooltip)

            resetObjectColors(objectNode)

            objectNode.name = key

            objectNode.interactive = true

            const objsettings = getObjSettings(obj.id)
            if (
                !(objsettings.nondeco || objsettings.solid) &&
                settings.hideDecoObjects.enabled
            ) {
                objectNode.visible = false
            }

            // objectNode.on("pointerdown", (e) => {
            //     // middle click
            //     if (e.data.button === 1) {
            //         editorNode.selectedObjectId = obj.id

            //         // find object tab
            //         editorNode.currentObjectTab = getObjSettings(obj.id).tab
            //     }
            // })

            this.addChild(objectNode)

            let selectableSprite = new PIXI.Sprite(PIXI.Texture.EMPTY)
            selectableSprite.name = key
            selectableSprite.anchor.set(0.5)
            selectableSprite.alpha = 0.1
            selectableSprite.renderable = false

            selectableSprite.position = objectNode.position
            selectableSprite.rotation = objectNode.rotation
            selectableSprite.width = 40 * objectNode.scale.x
            selectableSprite.height = 40 * objectNode.scale.y
            selectableSprite.parentGroup = selectableLayerGroup

            selectableSprite.visible = objectNode.visible

            if (
                !(objsettings.danger || objsettings.solid) &&
                settings.showDanger.enabled
            ) {
                selectableSprite.visible = false
            }

            this.selectableChunk.addChild(selectableSprite)

            selectableSprite.interactive = true

            selectableSprite.on("pointerup", () => {
                if (canEditValue) {
                    editorNode.deselectObject()
                    objectNode.mainSprite().tint = 0x00ff00
                    objectNode.detailSprite().tint = 0x00ff00
                    objectNode.mainSprite().alpha = 1.0
                    objectNode.detailSprite().alpha = 1.0

                    selectedObject.set(objectNode.getObjInfo())

                    const select_box = new PIXI.Graphics()
                    select_box.name = "select_box"
                    select_box.visible = !settings.disableObjectOutline.enabled
                    let [width, height] = [
                        objectNode.mainSprite().width,
                        objectNode.mainSprite().height,
                    ]
                    select_box.clear()
                    select_box
                        .lineStyle(1, 0xff3075, 1)
                        .drawRect(
                            -width / 2 - 5,
                            -height / 2 - 5,
                            width + 10,
                            height + 10
                        )

                    //console.log(select_box, width, height)

                    objectNode.addChild(select_box)

                    editorNode.selectedObjectNode = objectNode
                    selectableSprite.zOrder = editorNode.nextSelectionZ
                    editorNode.nextSelectionZ -= 1
                    editorNode.selectedObjectChunk = chunkName
                }
            })
        }

        this.removeObject = (key: string) => {
            //console.log(this.name, "removed object")
            if (
                editorNode.selectedObjectChunk == chunkName &&
                editorNode.selectedObjectNode.name == key
            ) {
                editorNode.deselectObject()
            }
            //console.log(this.getChildByName(snapshot.key)) // this.getChildByName(snapshot.key).destroy()
            this.destroyObject(key)
        }

        this.sync = (objects: Record<string, string>) => {
            const present = new Set(this.children.map((c) => c.name))
            for (const [key, str] of Object.entries(objects)) {
                if (!present.has(key)) {
                    this.addObject(key, GDObject.fromDatabaseString(str))
                }
            }
            for (const name of present) {
                if (!(name in objects)) this.removeObject(name)
            }
        }

        this.load = () => {
            if (TIMELAPSE_MODE) {
                this.loaded = true
            } else {
                if (this.children.length > 0) {
                    this.children.forEach((child) => {
                        child.destroy()
                    })
                }
                if (!this.loaded) {
                    this.unsub1 = subscribeChunk(chunkName, {
                        sync: (objects) => this.sync(objects),
                        add: (key, data) => {
                            if (this.getChildByName(key)) return
                            this.addObject(key, GDObject.fromDatabaseString(data))
                        },
                        remove: (key, by) => {
                            const node = this.getChildByName(key)
                            if (!node) return
                            if (node.visible)
                                editorNode.deleteLabels.addChild(
                                    new DeleteObjectLabel(by, node.position)
                                )
                            this.removeObject(key)
                        },
                    })
                    this.unsub2 = () => {}

                    this.loaded = true
                }
            }
        }
    }

    destroyObject(key) {
        this.getChildByName(key).destroy()
        this.selectableChunk.getChildByName(key).destroy()
    }

    unload() {
        if (TIMELAPSE_MODE) {
            this.loaded = false
        } else if (this.loaded) {
            const l = this.children.length

            for (let i = 0; i < l; i++) {
                this.children[0].destroy()
                this.selectableChunk.children[0].destroy()
            }

            this.unsub1()
            this.unsub2()
            this.loaded = false
        }
    }
}
