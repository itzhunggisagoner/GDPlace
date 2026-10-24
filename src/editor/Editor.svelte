<script lang="ts">

    import { LazyHowl } from "../utils/audio"
    import { pinch } from "svelte-gestures"
    import { toast } from "../ui/notify"

    import { vec } from "../utils/vector"
    import {
        DRAGGING_THRESHOLD,
        EditorApp,
        storePosState,
        pixiApp,
        pixiCanvas,
        EditorMenu,
        pixiAppStore,
        selectedObject,
        toGradient,
        musicPlaying,
        appReady,
        appError,
    } from "./app"

    import {
        GdColor,
        GDObject,
        getObjSettings,
        OBJECT_SETTINGS,
    } from "./object"
    import { EDIT_BUTTONS, PALETTE } from "./edit"
    import { lazyLoad } from "../lazyLoad"
    import {
        addObjectToLevel,
        deleteTimerMaxCommon,
        getUsernameColors,
        placeTimerMaxCommon,
        streamLink,
        userCount,
    } from "../backend/database"
    import { canEdit, currentUserData } from "../backend/auth"
    import {
        MAX_ZOOM,
        MIN_ZOOM,
        toastErrorTheme,
        toastSuccessTheme,
    } from "../const"
    import { onMount } from "svelte"
    import { settings, settings_writable } from "../settings/settings"
    import {
        getPlacedUsername,
        LEVEL_BOUNDS,
        SPAWN_POS,
        setLevelBounds,
        levelCells,
    } from "./nodes"
    import { ready as stateReady, levelSize, reloadHook } from "../backend/state"
    import { clamp } from "../utils/math"
    import MapScrubber from "../ui/MapScrubber.svelte"

    $: Object.keys(settings).forEach((key) => {
        settings[key] = $settings_writable[key]
    })

    let currentMenu = EditorMenu.Build
    let currentObjectTab = "blocks"
    let objectSearch = ""

    $: if ($settings_writable.hideDecoObjects.enabled && pixiApp?.editorNode) {
        const obj = getObjSettings(pixiApp.editorNode.selectedObjectId)

        if (!(obj.solid || obj.nonDeco)) {
            pixiApp.editorNode.objectPreview &&
                pixiApp.editorNode.removePreview()
            pixiApp.editorNode.selectedObjectId = 1
        }
    }

    let placeTimerMax, deleteTimerMax
    $: {
        // a personal timer of 0 is real (no cooldown); only "not set" falls back to the global default
        placeTimerMax =
            $currentUserData?.data?.placeTimer ?? $placeTimerMaxCommon
        deleteTimerMax =
            $currentUserData?.data?.deleteTimer || $deleteTimerMaxCommon
    }

    const switchMenu = (to: EditorMenu) => {
        currentMenu = to
        // editorNode only exists after assets finish loading (setup runs asynchronously)
        if (!pixiApp?.editorNode) return
        if (currentMenu == EditorMenu.Delete) {
            pixiApp.editorNode.removePreview()
            pixiApp.editorNode.setObjectsSelectable(true)
            pixiApp.editorNode.tooltip.show = false
        } else {
            pixiApp.editorNode.setObjectsSelectable(false)
            pixiApp.editorNode.deselectObject()
            pixiApp.editorNode.tooltip.show = true
        }
    }

    // ---- keep the user's progress across a page reload (admin "reload everyone") ----
    const PROGRESS_KEY = "gdplace_progress"
    const saveProgress = () => {
        try {
            const n = pixiApp?.editorNode
            if (pixiApp) storePosState(pixiApp) // camera position + zoom
            sessionStorage.setItem(
                PROGRESS_KEY,
                JSON.stringify({
                    selectedObjectId: n?.selectedObjectId ?? 1,
                    tab: currentObjectTab,
                    menu: currentMenu,
                    editTab: currentEditTab,
                    search: objectSearch,
                    preview: n?.objectPreview ? n.objectPreview.toDatabaseString() : null,
                })
            )
        } catch (e) {
            console.warn("could not save progress", e)
        }
    }
    const restoreProgress = () => {
        let saved: any = null
        try {
            saved = JSON.parse(sessionStorage.getItem(PROGRESS_KEY) || "null")
            sessionStorage.removeItem(PROGRESS_KEY)
        } catch {}
        const n = pixiApp?.editorNode
        if (!saved || !n) return false
        try {
            if (typeof saved.tab === "string" && categoryList.includes(saved.tab)) {
                currentObjectTab = saved.tab
                n.currentObjectTab = saved.tab
            }
            if (Number.isFinite(saved.selectedObjectId)) n.selectedObjectId = saved.selectedObjectId
            objectSearch = String(saved.search ?? "")
            if (Number.isFinite(saved.editTab)) currentEditTab = saved.editTab
            switchMenu(
                [EditorMenu.Build, EditorMenu.Edit, EditorMenu.Delete].includes(saved.menu)
                    ? saved.menu
                    : EditorMenu.Build
            )
            if (saved.preview && saved.menu !== EditorMenu.Delete) {
                n.objectPreview = GDObject.fromDatabaseString(saved.preview)
                n.updateObjectPreview()
            }
        } catch (e) {
            console.warn("could not restore progress", e)
        }
        return true
    }
    reloadHook.fn = () => {
        saveProgress()
        toast.push("An admin updated the game, reloading...", toastSuccessTheme)
        setTimeout(() => window.location.reload(), 700)
    }

    // the build area size comes from the server (Admin panel): apply it before the editor is built
    let appliedLevel = false
    $: if (appliedLevel && $levelSize) {
        const cur = levelCells()
        if (cur.width !== $levelSize.width || cur.height !== $levelSize.height) {
            toast.push("Build area changed, reloading...", toastSuccessTheme)
            setTimeout(() => window.location.reload(), 800)
        }
    }

    onMount(() => {
        ;(async () => {
            await stateReady
            if ($levelSize) setLevelBounds($levelSize.width, $levelSize.height)
            appliedLevel = true
            start()
        })()
    })

    const start = () => {
        let data = new URLSearchParams(window.location.search)

        // get editor position from local storage
        let editorPosition: any = null
        try {
            editorPosition = JSON.parse(localStorage.getItem("editorPosition") || "null")
        } catch {
            localStorage.removeItem("editorPosition")
        }

        if (!editorPosition || typeof editorPosition !== "object") {
            editorPosition = { x: SPAWN_POS + 27 * 30, y: 4, zoom: -3 }
        }

        if (data.get("x")) {
            editorPosition.x = parseInt(data.get("x")!) * 30
        }
        if (data.get("y")) {
            editorPosition.y = parseInt(data.get("y")!) * 30
        }
        if (data.get("zoom")) {
            editorPosition.zoom = parseInt(data.get("zoom")!)
        }

        editorPosition.x = clamp(editorPosition.x, 0, LEVEL_BOUNDS.end.x)
        editorPosition.y = clamp(editorPosition.y, 0, LEVEL_BOUNDS.end.y)
        editorPosition.zoom = clamp(editorPosition.zoom, MAX_ZOOM, MIN_ZOOM)

        try {
            pixiAppStore.set(
                new EditorApp($pixiCanvas, editorPosition, () => {
                    if (!restoreProgress()) switchMenu(EditorMenu.Build)
                })
            )
        } catch (e) {
            console.error("EditorApp init failed", e)
            appError.set(String((e as any)?.message ?? e))
        }

    }

    enum EditTab {
        Transform,
        Layers,
        Colors,
    }

    let currentEditTab = EditTab.Transform

    enum ColorChannel {
        Main,
        Detail,
    }

    let currentChannel = ColorChannel.Main

    // temporary way of generating categories
    let categoryList = []
    //console.log(OBJECT_SETTINGS)
    OBJECT_SETTINGS.forEach((x) => {
        if (!categoryList.includes(x.category)) categoryList.push(x.category)
    })

    let lastPlaced = 0
    let lastDeleted = 0

    let placeTimeLeft = 6969696969
    let deleteTimeLeft = 6969696969

    // temporary client-side way of disabling button just to avoid user being able to spam button
    // in event that cloud function returns slowly
    let placeButtonDisabled = false
    let deleteButtonDisabled = false

    let placeTimerSound = new LazyHowl({
        src: ["/gd/world/crystal01.ogg"],
    })
    let deleteTimerSound = new LazyHowl({
        src: ["/gd/world/achievement_01.ogg"],
    })

    const updateTimeLeft = () => {
        const now = Date.now()
        placeTimeLeft = Math.max(placeTimerMax - (now - lastPlaced) / 1000, 0)
        deleteTimeLeft = Math.max(
            deleteTimerMax - (now - lastDeleted) / 1000,
            0
        )
    }

    setInterval(() => {
        updateTimeLeft()
    }, 200)

    const gradientFunc = (t) =>
        `conic-gradient(white ${t * 360}deg, black ${t * 360}deg 360deg)`

    currentUserData.subscribe((value) => {
        if (typeof value != "string" && value != null) {
            if (typeof value.data != "string" && value.data != null) {
                lastDeleted = value.data.lastDeleted
                lastPlaced = value.data.lastPlaced
                if (placeTimerMax * 1000 - (Date.now() - lastPlaced) > 0) {
                    let t = setTimeout(() => {
                        placeTimerSound.play()
                        clearTimeout(t)
                    }, Math.max(placeTimerMax * 1000 - (Date.now() - lastPlaced), 0))
                }

                if (deleteTimerMax * 1000 - (Date.now() - lastDeleted) > 0) {
                    let t2 = setTimeout(() => {
                        deleteTimerSound.play()
                        clearTimeout(t2)
                    }, Math.max(deleteTimerMax * 1000 - (Date.now() - lastDeleted), 0))
                }

                updateTimeLeft()
            }
        }
    })

    const mobileScreenQuery = window.matchMedia(
        "(max-height: 600px) or (orientation: portrait)"
    )

    let mobileScreen = mobileScreenQuery.matches

    mobileScreenQuery.addEventListener("change", () => {
        mobileScreen = mobileScreenQuery.matches
    })

    // ---------- UI scale follows the screen WIDTH ----------
    // wide screens (>= 900px) scale the menu, tabs and move bar up; phones keep their own sizes.
    // --wscale is also read by MapScrubber.svelte
    let wscale = 1
    const updateWScale = () => {
        const w = window.innerWidth
        wscale = w >= 900 ? clamp(w / 1440, 0.9, 1.5) : 1
        document.documentElement.style.setProperty("--wscale", String(wscale))
    }
    updateWScale()
    window.addEventListener("resize", updateWScale)

    // ---------- object list sizing ----------
    // the cell size and number of rows are computed from the real height of the list, so the cells are as big as
    // they can be (bigger on phones AND desktop) and always fit, whatever the screen size / orientation
    let trayH = 0
    let trayRows = 2
    let trayCell = 64
    const TRAY_GAP = 8
    // size of the category tabs (the bar above the list)
    $: tabSize = mobileScreen ? 40 : Math.round(56 * wscale)
    $: {
        const inner = Math.max(trayH - 12, 0) // tray bottom padding (4) + list padding (4 + 4)
        // phones: smaller cells (46-56px, up to 4 rows); wide screens: cells grow with the width
        const minCell = mobileScreen ? 46 : 70 * wscale
        const maxCell = mobileScreen ? 56 : 108 * wscale
        if (inner > 0) {
            trayRows = Math.max(
                1,
                Math.min(mobileScreen ? 4 : 3, Math.floor((inner + TRAY_GAP) / (minCell + TRAY_GAP)))
            )
            trayCell = Math.max(
                40,
                Math.min(maxCell, Math.floor((inner - TRAY_GAP * (trayRows - 1)) / trayRows))
            )
        }
    }

    // A few GD sprites are tiny: thin lines (120x4 px) or a 6-12 px dot parked in the top-left corner of a
    // 120x120 transparent picture. Shrunk into a cell they were invisible ("empty" cells), so they are
    // stretched / zoomed here. Only affects the thumbnail, never the object placed in the level.
    const THUMB_FIX: Record<number, string> = {
        468: "width:80%;height:9px;object-fit:fill;",
        1004: "width:80%;height:10px;object-fit:fill;",
        1753: "width:80%;height:8px;object-fit:fill;",
        1754: "width:80%;height:8px;object-fit:fill;",
        1757: "width:40%;height:8px;object-fit:fill;",
        1005: "width:10px;height:80%;object-fit:fill;transform:scale(1.6) translate(0,-28.75%);",
        472: "transform:scale(8) translate(47.5%,47.5%);",
        473: "transform:scale(5) translate(46.25%,46.25%);",
        474: "transform:scale(3.5) translate(44.17%,47.08%);",
        1205: "transform:scale(4) translate(45%,45%);",
        1206: "transform:scale(4) translate(45%,45%);",
        1207: "transform:scale(2.5) translate(40%,45%);",
    }

    // ---------- secret swipe tool ----------
    // Only for players whose personal place timer is 0 (Admin panel -> "Personal place timer" = 0).
    // Admins are NOT special: with no personal timer they have the default timer like everybody else.
    // With swipe on, dragging one finger / the mouse over the map places the selected object (with the
    // current rotation / colours / layer) on every grid cell the pointer passes over.
    $: swipeAllowed =
        $currentUserData?.data?.placeTimer === 0 && !$currentUserData?.data?.banned
    let swipeOn = false
    $: if (!swipeAllowed) swipeOn = false

    type SwipeStroke = {
        pointerId: number
        tpl: GDObject
        first: { x: number; y: number }
        last: { x: number; y: number }
        started: boolean
        visited: Set<string>
        queue: GDObject[]
        running: number
        failed: boolean
        count: number
    }
    let swipeStroke: SwipeStroke | null = null
    let swipeJustDrew = false
    const swipePointers = new Set<number>()
    const SWIPE_MAX_PER_STROKE = 400
    const SWIPE_CONCURRENCY = 4

    const swipeActive = () =>
        swipeOn &&
        swipeAllowed &&
        $canEdit &&
        currentMenu != EditorMenu.Delete &&
        !!pixiApp?.editorNode

    const swipeTemplate = (): GDObject | null => {
        const n = pixiApp?.editorNode
        if (!n) return null
        if (n.objectPreview && n.objectPreview.id == n.selectedObjectId) return n.objectPreview.clone()
        return new GDObject(
            n.selectedObjectId, 0, 0, 0, false, 1.0, 50,
            new GdColor("ffffff", false, 1.0),
            new GdColor("ffffff", false, 1.0)
        )
    }

    const swipeCellAt = (e: PointerEvent) => {
        const w = pixiApp.editorNode.toWorld(vec(e.pageX, e.pageY), pixiApp.canvasSize())
        return { x: Math.floor(w.x / 30), y: Math.floor(w.y / 30) }
    }

    // all grid cells from a (excluded) to b (included)
    const swipeCellsBetween = (a: { x: number; y: number }, b: { x: number; y: number }) => {
        const out: { x: number; y: number }[] = []
        let x = a.x
        let y = a.y
        const dx = Math.abs(b.x - x)
        const dy = Math.abs(b.y - y)
        const sx = x < b.x ? 1 : -1
        const sy = y < b.y ? 1 : -1
        let err = dx - dy
        while ((x !== b.x || y !== b.y) && out.length < 200) {
            const e2 = 2 * err
            if (e2 > -dy) {
                err -= dy
                x += sx
            }
            if (e2 < dx) {
                err += dx
                y += sy
            }
            out.push({ x, y })
        }
        return out
    }

    const swipeObjectAt = (s: SwipeStroke, cell: { x: number; y: number }) => {
        const o = s.tpl.clone()
        const st = getObjSettings(o.id)
        const off = vec(st.offset_x ?? 0, st.offset_y ?? 0).rotated(-(o.rotation * Math.PI) / 180)
        o.x = cell.x * 30 + 15 + off.x
        o.y = cell.y * 30 + 15 + off.y
        return o
    }

    const swipePump = (s: SwipeStroke) => {
        while (!s.failed && s.running < SWIPE_CONCURRENCY && s.queue.length) {
            const o = s.queue.shift()!
            s.running++
            addObjectToLevel(o)
                .catch((err) => {
                    if (s.failed) return
                    s.failed = true
                    s.queue.length = 0
                    toast.push(`Swipe stopped! (${err?.message ?? err})`, toastErrorTheme)
                })
                .finally(() => {
                    s.running--
                    swipePump(s)
                })
        }
    }

    const swipeEnqueue = (s: SwipeStroke, cell: { x: number; y: number }) => {
        if (s.failed || s.count >= SWIPE_MAX_PER_STROKE) return
        const key = `${cell.x},${cell.y}`
        if (s.visited.has(key)) return
        s.visited.add(key)
        const { width, height } = levelCells()
        if (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height) return
        s.count++
        s.queue.push(swipeObjectAt(s, cell))
        swipePump(s)
    }

    // returns true when swipe took over the pointer (so the map must not start a camera drag)
    const swipeDown = (e: PointerEvent): boolean => {
        if (!swipeActive()) return false
        swipePointers.add(e.pointerId)
        if (swipePointers.size > 1) {
            swipeStroke = null // second finger = pinch zoom, not a stroke
            return true
        }
        const tpl = swipeTemplate()
        if (!tpl) return true
        const cell = swipeCellAt(e)
        swipeStroke = {
            pointerId: e.pointerId,
            tpl,
            first: cell,
            last: cell,
            started: false,
            visited: new Set(),
            queue: [],
            running: 0,
            failed: false,
            count: 0,
        }
        pixiApp.dragging = null
        try {
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        } catch {}
        return true
    }

    const swipeMove = (e: PointerEvent) => {
        const s = swipeStroke
        if (!s || e.pointerId !== s.pointerId || swipePointers.size > 1) return
        const cell = swipeCellAt(e)
        if (cell.x === s.last.x && cell.y === s.last.y) return
        if (!s.started) {
            // a tap (no movement) still just moves the preview; the stroke only starts once the finger leaves its cell
            s.started = true
            swipeEnqueue(s, s.first)
        }
        for (const c of swipeCellsBetween(s.last, cell)) swipeEnqueue(s, c)
        s.last = cell
        // the preview follows the finger
        const n = pixiApp.editorNode
        n.objectPreview = swipeObjectAt(s, cell)
        n.updateObjectPreview()
    }

    const swipeEnd = (e: PointerEvent, cancelled = false) => {
        swipePointers.delete(e.pointerId)
        const s = swipeStroke
        if (s && e.pointerId === s.pointerId) {
            swipeJustDrew = s.started && !cancelled
            swipeStroke = null
        }
    }

    const toggleSwipe = () => {
        swipeOn = !swipeOn
        toast.push(
            swipeOn ? "Swipe ON: drag on the map to place many objects" : "Swipe OFF",
            toastSuccessTheme
        )
    }

    let menuIndex = 0
    function nextMenu(): EditorMenu {
        return [EditorMenu.Build, EditorMenu.Edit, EditorMenu.Delete][
            menuIndex++ % 3
        ]
    }
</script>

<svelte:window
    on:pointerup={(e) => {
        swipePointers.delete(e.pointerId)
        if (pixiApp) pixiApp.dragging = null
    }}
    on:pointercancel={(e) => {
        swipePointers.delete(e.pointerId)
    }}
    on:pointermove={(e) => {
        if (!pixiApp) return
        pixiApp.mousePos = vec(e.pageX, e.pageY)
        if (
            pixiApp.dragging &&
            !pixiApp.draggingThresholdReached &&
            pixiApp.mousePos.distTo(pixiApp.dragging.prevMouse) >=
                DRAGGING_THRESHOLD
        ) {
            pixiApp.draggingThresholdReached = true
            pixiApp.dragging.prevMouse = vec(e.pageX, e.pageY)
        }
    }}
    on:keydown={(e) => {
        // never steal keys while the player is typing (login, Admin panel fields...) or using Ctrl/Cmd shortcuts
        const t = e.target as HTMLElement | null
        if (
            t &&
            (t.isContentEditable ||
                ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))
        )
            return
        if (e.ctrlKey || e.metaKey) return
        if ($canEdit && pixiApp?.editorNode) {
            if (e.code == "Digit1") {
                e.preventDefault()
                switchMenu(EditorMenu.Build)
                return
            }
            if (e.code == "Digit2") {
                e.preventDefault()
                switchMenu(EditorMenu.Edit)
                return
            }
            if (e.code == "Digit3") {
                e.preventDefault()
                switchMenu(EditorMenu.Delete)
                return
            }
            for (let tab of EDIT_BUTTONS) {
                for (let button of tab.buttons) {
                    if (
                        e.key.toLowerCase() == button.shortcut?.key &&
                        e.shiftKey == button.shortcut?.shift &&
                        e.altKey == button.shortcut?.alt
                    ) {
                        let obj = pixiApp.editorNode.objectPreview
                        e.preventDefault()
                        if (
                            !(
                                obj == null ||
                                (["cw_5", "ccw_5"].includes(button["image"]) &&
                                    getObjSettings(
                                        pixiApp.editorNode.objectPreview?.id
                                    ).solid)
                            )
                        ) {
                            button.cb(obj)
                            pixiApp.editorNode.updateObjectPreview()
                        }
                        return
                    }
                }
            }
        }
    }}
/>

<!-- <canvas id="screenshot_canvas" /> -->
<div class="editor">
    <canvas
        class="pixi_canvas"
        bind:this={$pixiCanvas}
        on:pointerdown={(e) => {
            if (swipeDown(e)) return
            pixiApp.draggingThresholdReached = false
            pixiApp.dragging = {
                prevCamera: pixiApp.editorNode.cameraPos.clone(),
                prevMouse: vec(e.pageX, e.pageY),
            }
        }}
        on:wheel={(e) => {
                e.preventDefault()
            // if (e.ctrlKey) {
            let wm = pixiApp.editorNode.toWorld(
                pixiApp.mousePos,
                pixiApp.canvasSize()
            )
            let prevZoom = pixiApp.editorNode.zoom()
            pixiApp.editorNode.zoomLevel += e.deltaY > 0 ? -1 : 1
            pixiApp.editorNode.zoomLevel = Math.min(
                MIN_ZOOM,
                Math.max(MAX_ZOOM, pixiApp.editorNode.zoomLevel)
            )
            let zoomRatio = pixiApp.editorNode.zoom() / prevZoom
            pixiApp.editorNode.cameraPos = wm.plus(
                pixiApp.editorNode.cameraPos.minus(wm).div(zoomRatio)
            )
            // } else if (e.shiftKey) {
            //     pixiApp.editorNode.cameraPos.x += e.deltaY
            //     pixiApp.editorNode.cameraPos.y -= e.deltaX
            // } else {
            //     pixiApp.editorNode.cameraPos.y -= e.deltaY
            //     pixiApp.editorNode.cameraPos.x += e.deltaX
            // }
            // set editor position to local storage
            storePosState(pixiApp)
        }}
        use:pinch
        on:pinch={({ detail }) => {
                pixiApp.dragging = null
            let prevZoom = pixiApp.editorNode.zoom()

            if (pixiApp.pinching == null) {
                pixiApp.pinching = {
                    prevZoom: pixiApp.editorNode.zoom(),
                }
            }

            pixiApp.editorNode.zoomLevel =
                Math.log2(pixiApp.pinching.prevZoom * detail.scale) * 8

            let wm = pixiApp.editorNode.toWorld(
                vec(detail.center.x, detail.center.y),
                pixiApp.canvasSize()
            )

            pixiApp.editorNode.zoomLevel = Math.min(
                MIN_ZOOM,
                Math.max(MAX_ZOOM, pixiApp.editorNode.zoomLevel)
            )
            let zoomRatio = pixiApp.editorNode.zoom() / prevZoom
            pixiApp.editorNode.cameraPos = wm.plus(
                pixiApp.editorNode.cameraPos.minus(wm).div(zoomRatio)
            )
            // set editor position to local storage
            storePosState(pixiApp)
        }}
        on:pinchup={() => {
                pixiApp.pinching = null
        }}
        on:pointermove={swipeMove}
        on:pointercancel={(e) => swipeEnd(e, true)}
        on:pointerup={(e) => {
            swipeEnd(e)
            pixiApp.pinching = null
            pixiApp.mousePos = vec(e.pageX, e.pageY)
            if (swipeJustDrew) {
                // a swipe just placed objects: don't also drop the preview where the finger was lifted
                swipeJustDrew = false
                return
            }
            if (currentMenu == EditorMenu.Delete) {
                return
            }
            if (pixiApp.editorNode.tooltip.visible) {
                if (pixiApp.editorNode.tooltip) {
                    pixiApp.editorNode.tooltip.visible = false
                    pixiApp.editorNode.tooltip.currentObject.isHovering = false
                    pixiApp.editorNode.tooltip.unHighlight()
                }
                return
            }

            if (pixiApp.editorNode.tooltip.currentObject)
                pixiApp.editorNode.tooltip.currentObject.isHovering = false
            if ($canEdit) {
                if (
                    pixiApp.dragging == null ||
                    !pixiApp.draggingThresholdReached
                ) {
                    const settings = getObjSettings(
                        pixiApp.editorNode.selectedObjectId
                    )

                    let snapped = pixiApp.editorNode
                        .toWorld(pixiApp.mousePos, pixiApp.canvasSize())
                        .snapped(30)
                        .plus(vec(15, 15))

                    if (
                        pixiApp.editorNode.objectPreview == null ||
                        pixiApp.editorNode.selectedObjectId !=
                            pixiApp.editorNode.objectPreview?.id
                    ) {
                        pixiApp.editorNode.objectPreview = new GDObject(
                            pixiApp.editorNode.selectedObjectId,
                            snapped.x + settings.offset_x,
                            snapped.y + settings.offset_y,
                            0,
                            false,
                            1.0,
                            50,
                            new GdColor("ffffff", false, 1.0),
                            new GdColor("ffffff", false, 1.0)
                        )
                    } else {
                        const obj = pixiApp.editorNode.objectPreview

                        pixiApp.editorNode.objectPreview.x = snapped.x
                        pixiApp.editorNode.objectPreview.y = snapped.y

                        let offVec = vec(
                            settings.offset_x,
                            settings.offset_y
                        ).rotated(-(obj.rotation * Math.PI) / 180)
                        obj.x += offVec.x
                        obj.y += offVec.y
                        // offVec = offVec.rotated(-(obj.rotation * Math.PI) / 180)
                        // obj.x += offVec.x
                        // obj.y += offVec.y
                    }
                    pixiApp.editorNode.updateObjectPreview()
                }
            }
        }}
    />

    {#if $appReady}
        <MapScrubber />
        <div class="playbutton">
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <img
                src={$musicPlaying
                    ? "/gd/editor/GJ_stopMusicBtn_001.png"
                    : "/gd/editor/GJ_playMusicBtn_001.png"}
                alt="play music"
                height="75"
                id="music_button"
                on:click={() => {
                    if (!pixiApp?.editorNode) return
                    if (!pixiApp.playingMusic) {
                        pixiApp.playMusic()
                    } else {
                        pixiApp.stopMusic()
                    }
                }}
            />
        </div>
    {/if}

    {#if settings.showObjInfo.enabled && $selectedObject != null}
        <div class="obj_info">
            <div class="info_line">
                <b> Object type: </b>
                <img
                    draggable="false"
                    alt={$selectedObject.obj.id.toString()}
                    class="info_icon"
                    src={`/gd/objects/main/${$selectedObject.obj.id}.png`}
                />
            </div>
            {#if getObjSettings($selectedObject.obj.id).tintable}
                {#each [[$selectedObject.obj.mainColor, "Main color"], [$selectedObject.obj.detailColor, "Detail color"]] as [color, name]}
                    <div class="info_line">
                        <b> {name}: </b>
                        <div class="color_info">
                            <div
                                class="color_circle"
                                style="background-color: #{color['hex']}"
                            />
                            {#if color["blending"]}
                                <span class="blending_info"> B </span>
                            {/if}
                            {#if color["opacity"] != 1.0}
                                <span class="opacity_info">
                                    {color["opacity"] * 100}%
                                </span>
                            {/if}
                        </div>
                    </div>
                {/each}
            {/if}

            <div class="info_line">
                <b> Z layer: </b>
                {$selectedObject.obj.zOrder}
            </div>
            <div class="info_line">
                <b> Rotation: </b>
                {$selectedObject.obj.rotation}°
            </div>
            <div class="info_line">
                <b> Scale: </b>
                {$selectedObject.obj.scale.toFixed(2)}
            </div>
            {#await getPlacedUsername($selectedObject.dbname) then username}
                {#await getUsernameColors(username) then colors}
                    <div class="info_line">
                        <b> Placed by: </b>
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <div
                            on:pointerdown={() => {
                                navigator.clipboard
                                    .writeText(username)
                                    .then(() => {
                                        toast.pop()
                                        toast.push("Copied", toastSuccessTheme)
                                    })
                                    .catch((e) => {
                                        toast.push(e, toastErrorTheme)
                                    })
                            }}
                            class="username_display {colors.length > 1
                                ? 'username_gradient'
                                : ''}"
                            style={colors.length == 1
                                ? `color: #${colors[0].toString(16)}`
                                : `background-image: ${toGradient(colors)}`}
                        >
                            {username}
                        </div>
                    </div>
                {/await}
            {/await}
        </div>
    {/if}

    {#if $canEdit && !settings.hideMenu.enabled}
        <div class="menu">
            <div
                class="side_panel menu_panel"
                style={mobileScreen
                    ? "justify-content: center; margin: 0;"
                    : ""}
            >
                {#if mobileScreen}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <div
                        class="portrait_button_container"
                        on:click={() => {
                            switchMenu(nextMenu())
                        }}
                    >
                        <button
                            class="portrait_button invis_button wiggle_button"
                            style:opacity={+(currentMenu == EditorMenu.Build)}
                            style:transform="scale({1 -
                                0.3 * +(currentMenu != EditorMenu.Build)})"
                        >
                            <img
                                draggable="false"
                                src="/gd/editor/side/build.svg"
                                alt=""
                                class="side_panel_button_icon"
                            />
                            {#if placeTimeLeft != 0}
                                <div
                                    class="radial_timer"
                                    style:background={gradientFunc(
                                        1 - placeTimeLeft / placeTimerMax
                                    )}
                                />
                            {/if}
                        </button>

                        <button
                            class="portrait_button invis_button wiggle_button"
                            style:opacity={+(currentMenu == EditorMenu.Edit)}
                            style:transform="scale({1 -
                                0.3 * +(currentMenu != EditorMenu.Edit)})"
                        >
                            <img
                                draggable="false"
                                src="/gd/editor/side/edit.svg"
                                alt=""
                                class="side_panel_button_icon"
                            />
                        </button>

                        <button
                            class="portrait_button invis_button wiggle_button"
                            style:opacity={+(currentMenu == EditorMenu.Delete)}
                            style:transform="scale({1 -
                                0.3 * +(currentMenu != EditorMenu.Delete)})"
                        >
                            <img
                                draggable="false"
                                src="/gd/editor/side/delete.svg"
                                alt=""
                                class="side_panel_button_icon"
                            />

                            {#if deleteTimeLeft != 0}
                                <div
                                    class="radial_timer"
                                    style:background={gradientFunc(
                                        1 - deleteTimeLeft / deleteTimerMax
                                    )}
                                />
                            {/if}
                        </button>
                    </div>

                    <div class="dots">
                        <span
                            class="dot"
                            id={currentMenu == EditorMenu.Build ? "dot_on" : ""}
                        />
                        <span
                            class="dot"
                            id={currentMenu == EditorMenu.Edit ? "dot_on" : ""}
                        />
                        <span
                            class="dot"
                            id={currentMenu == EditorMenu.Delete
                                ? "dot_on"
                                : ""}
                        />
                    </div>
                {:else}
                    <button
                        class="invis_button wiggle_button"
                        style:opacity={currentMenu == EditorMenu.Build
                            ? 1
                            : 0.25}
                        on:click={() => {
                            switchMenu(EditorMenu.Build)
                        }}
                    >
                        <img
                            draggable="false"
                            src="/gd/editor/side/build.svg"
                            alt=""
                            class="side_panel_button_icon"
                        />
                        {#if placeTimeLeft != 0}
                            <div
                                class="radial_timer"
                                style:background={gradientFunc(
                                    1 - placeTimeLeft / placeTimerMax
                                )}
                            />
                        {/if}
                    </button>
                    <button
                        class="invis_button wiggle_button"
                        on:click={() => {
                            switchMenu(EditorMenu.Edit)
                        }}
                        style:opacity={currentMenu == EditorMenu.Edit
                            ? 1
                            : 0.25}
                    >
                        <img
                            draggable="false"
                            src="/gd/editor/side/edit.svg"
                            alt=""
                            class="side_panel_button_icon"
                        />
                    </button>
                    <button
                        class="invis_button wiggle_button"
                        style:opacity={currentMenu == EditorMenu.Delete
                            ? 1
                            : 0.25}
                        on:click={() => {
                            switchMenu(EditorMenu.Delete)
                        }}
                    >
                        <img
                            draggable="false"
                            src="/gd/editor/side/delete.svg"
                            alt=""
                            class="side_panel_button_icon"
                        />

                        {#if deleteTimeLeft != 0}
                            <div
                                class="radial_timer"
                                style:background={gradientFunc(
                                    1 - deleteTimeLeft / deleteTimerMax
                                )}
                            />
                        {/if}
                    </button>
                {/if}
            </div>

            <div class="buttons_panel menu_panel">
                {#if currentMenu == EditorMenu.Build}
                    <div
                        class="tabs"
                        style="--tab-size: {tabSize}px; --tab-n: {categoryList.length}"
                    >
                        {#each categoryList as objectTab}
                            <button
                                class="obj_tab_button tab_button invis_button {currentObjectTab == objectTab ? 'active' : ''}"
                                aria-label={objectTab}
                                title={objectTab}
                                aria-pressed={currentObjectTab == objectTab}
                                on:click={() => {
                                    currentObjectTab = objectTab
                                    if (pixiApp?.editorNode)
                                        pixiApp.editorNode.currentObjectTab = objectTab
                                    objectSearch = ""
                                }}
                            >
                                <img
                                    draggable="false"
                                    alt=""
                                    class="obj_tab_icon"
                                    use:lazyLoad={`/gd/objects/main/${
                                        OBJECT_SETTINGS.find(
                                            (x) =>
                                                x.category == objectTab &&
                                                x.categoryIcon
                                        )?.id || 1607
                                    }.png`}
                                />
                            </button>
                        {/each}
                    </div>
                    <div class="objects_grid_container build_objects_grid">
                        <div
                            class="tray"
                            bind:clientHeight={trayH}
                            style="--cell: {trayCell}px; --rows: {trayRows}"
                        >
                        <div class="objects_grid" id="objects_list">
                            <div class="obj_buttons_container grid_padding">
                                {#each OBJECT_SETTINGS.filter((objectData) =>
                                    currentObjectTab == objectData.category &&
                                    (!objectSearch.trim() ||
                                        String(objectData.id).includes(objectSearch.trim()) ||
                                        String(objectData.comment ?? "").toLowerCase().includes(objectSearch.trim().toLowerCase()))
                                ) as objectData (objectData.id)}
                                    <button
                                        class="obj_button invis_button wiggle_button"
                                        data-category={objectData.category}
                                        data-id={objectData.id}
                                        title={"Object " + objectData.id + (objectData.comment ? " — " + objectData.comment : "")}
                                        aria-label={`Select object ${objectData.id}`}
                                        id={pixiApp?.editorNode
                                            ?.selectedObjectId == objectData.id
                                            ? "selected_obj_button"
                                            : ""}
                                        on:click={() => {
                                            pixiApp.editorNode.selectedObjectId =
                                                objectData.id
                                        }}
                                        disabled={$settings_writable
                                            .hideDecoObjects.enabled &&
                                            !(
                                                objectData.nonDeco ||
                                                objectData.solid
                                            )}
                                    >
                                        <img
                                            draggable="false"
                                            alt=""
                                            class="button_icon"
                                            style={THUMB_FIX[objectData.id] ?? ""}
                                            use:lazyLoad={`/gd/objects/main/${objectData.id}.png`}
                                        />
                                        {#if objectData.comment}
                                            <p class="object_comment">
                                                {objectData.comment}
                                            </p>
                                        {/if}
                                        <p
                                            class="debug_objectID object_comment"
                                        >
                                            {objectData.id}
                                        </p>
                                    </button>
                                {/each}
                                {#if !OBJECT_SETTINGS.some((objectData) =>
                                    currentObjectTab == objectData.category &&
                                    (!objectSearch.trim() ||
                                        String(objectData.id).includes(objectSearch.trim()) ||
                                        String(objectData.comment ?? "").toLowerCase().includes(objectSearch.trim().toLowerCase()))
                                )}
                                    <p class="object_search_empty">No objects found</p>
                                {/if}
                            </div>
                        </div>
                        </div>
                    </div>
                {:else if currentMenu == EditorMenu.Edit}
                    <div class="tabs">
                        {#each EDIT_BUTTONS as editTab, i}
                            <button
                                class="tab_button edit_tab_button invis_button"
                                class:active={currentEditTab === i}
                                aria-pressed={currentEditTab === i}
                                on:click={() => {
                                    currentEditTab = i
                                }}
                            >
                                {editTab.tabName}
                            </button>
                        {/each}
                    </div>
                    <div class="objects_grid_container">
                        <div class="objects_grid">
                            {#if currentEditTab === EditTab.Transform}
                                <div class="obj_buttons_container grid_padding">
                                    {#each EDIT_BUTTONS[currentEditTab].buttons as editButton, i (currentEditTab * 100 + i)}
                                        <button
                                            class="edit_button invis_button wiggle_button"
                                            title={editButton.image.replaceAll("_", " ")}
                                            aria-label={editButton.image.replaceAll("_", " ")}
                                            disabled={pixiApp.editorNode
                                                .objectPreview == null ||
                                                (["cw_5", "ccw_5"].includes(
                                                    editButton["image"]
                                                ) &&
                                                    getObjSettings(
                                                        pixiApp.editorNode
                                                            .objectPreview?.id
                                                    ).solid)}
                                            on:click={() => {
                                                if (
                                                    pixiApp.editorNode
                                                        .objectPreview != null
                                                ) {
                                                    editButton.cb(
                                                        pixiApp.editorNode
                                                            .objectPreview
                                                    )

                                                    pixiApp.editorNode.updateObjectPreview()
                                                }
                                            }}
                                        >
                                            <img
                                                draggable="false"
                                                style="transform: scale({editButton.scale})"
                                                class="button_icon"
                                                alt=""
                                                use:lazyLoad={`/gd/editor/edit/${editButton["image"]}.png`}
                                            />
                                        </button>
                                    {/each}
                                    {#if swipeAllowed}
                                        <!-- secret swipe toggle: only exists for players with personal place timer 0 -->
                                        <button
                                            class="edit_button swipe_button invis_button wiggle_button"
                                            class:on={swipeOn}
                                            title="Swipe"
                                            aria-label="Swipe to place many objects"
                                            aria-pressed={swipeOn}
                                            on:click={toggleSwipe}
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                                <path d="M2.5 15c3-6 6 6 9 0s6 6 9 0" />
                                                <path d="M16.5 5.5l4.5 3.5-4.5 3.5" />
                                            </svg>
                                        </button>
                                    {/if}
                                </div>
                            {/if}

                            {#if currentEditTab === EditTab.Layers}
                                <div class="zlayers_container">
                                    <div
                                        class="obj_buttons_container grid_padding"
                                        style="grid-area: buttons"
                                    >
                                        {#each EDIT_BUTTONS[currentEditTab].buttons as editButton, i (currentEditTab * 100 + i)}
                                            <button
                                                class="edit_button invis_button wiggle_button"
                                                title={editButton.image.replaceAll("_", " ")}
                                                aria-label={editButton.image.replaceAll("_", " ")}
                                                disabled={pixiApp.editorNode
                                                    .objectPreview == null}
                                                on:click={() => {
                                                    if (
                                                        pixiApp.editorNode
                                                            .objectPreview !=
                                                        null
                                                    ) {
                                                        editButton.cb(
                                                            pixiApp.editorNode
                                                                .objectPreview
                                                        )

                                                        pixiApp.editorNode.updateObjectPreview()
                                                    }
                                                }}
                                            >
                                                <img
                                                    draggable="false"
                                                    style="transform: scale({editButton.scale})"
                                                    class="button_icon"
                                                    alt=""
                                                    use:lazyLoad={`/gd/editor/edit/${editButton["image"]}.png`}
                                                />
                                            </button>
                                        {/each}
                                    </div>

                                    {#if pixiApp.editorNode.objectPreview}
                                        <t class="edit_info_text">
                                            Z = {pixiApp.editorNode
                                                .objectPreview?.zOrder}
                                        </t>
                                    {/if}

                                    {#if pixiApp.editorNode.objectPreview?.mainColor.blending || pixiApp.editorNode.objectPreview?.detailColor.blending}
                                        <t class="edit_info_text2">
                                            (Since one of your colors has
                                            blending, layering might not work as
                                            expected. This is to replicate GD
                                            behavior.)
                                        </t>
                                    {/if}
                                </div>
                            {/if}

                            {#if currentEditTab === EditTab.Colors}
                                <div class="colors_tab_container">
                                    <div class="colors_tab_channels_container">
                                        {#each ["Main", "Detail"] as channel, i}
                                            <div
                                                class="colors_tab_labels_container"
                                                id={currentChannel === i
                                                    ? "selected_channel_button"
                                                    : ""}
                                            >
                                                <button
                                                    class="invis_button wiggle_button colors_tab_labels"
                                                    on:click={() => {
                                                        currentChannel = i
                                                    }}
                                                >
                                                    {channel}
                                                </button>

                                                <button
                                                    class="blending_toggle wiggle_button"
                                                    style={(channel == "Main" &&
                                                        pixiApp.editorNode
                                                            .objectPreview
                                                            ?.mainColor
                                                            .blending) ||
                                                    (channel == "Detail" &&
                                                        pixiApp.editorNode
                                                            .objectPreview
                                                            ?.detailColor
                                                            .blending)
                                                        ? "filter: brightness(1.15) drop-shadow(0 0 3px #09d6e5);"
                                                        : ""}
                                                    disabled={!getObjSettings(
                                                        pixiApp.editorNode
                                                            .objectPreview?.id
                                                    ).tintable ||
                                                        pixiApp.editorNode
                                                            .objectPreview ==
                                                            null ||
                                                        (channel == "Main" &&
                                                            pixiApp.editorNode
                                                                .objectPreview
                                                                ?.mainColor
                                                                .hex ==
                                                                "000000") ||
                                                        (channel == "Detail" &&
                                                            pixiApp.editorNode
                                                                .objectPreview
                                                                ?.detailColor
                                                                .hex ==
                                                                "000000")}
                                                    on:click={() => {
                                                        if (
                                                            pixiApp.editorNode
                                                                .objectPreview !=
                                                            null
                                                        ) {
                                                            if (
                                                                channel ==
                                                                "Main"
                                                            )
                                                                pixiApp.editorNode.objectPreview.mainColor.blending =
                                                                    !pixiApp
                                                                        .editorNode
                                                                        .objectPreview
                                                                        .mainColor
                                                                        .blending
                                                            else if (
                                                                channel ==
                                                                "Detail"
                                                            )
                                                                pixiApp.editorNode.objectPreview.detailColor.blending =
                                                                    !pixiApp
                                                                        .editorNode
                                                                        .objectPreview
                                                                        .detailColor
                                                                        .blending
                                                            pixiApp.editorNode.updateObjectPreview()
                                                        }
                                                    }}
                                                >
                                                    {#if mobileScreen}
                                                        B
                                                    {:else}
                                                        Blending
                                                    {/if}
                                                </button>
                                            </div>
                                        {/each}
                                    </div>

                                    <div class="colors_buttons_container">
                                        <!-- opacity slider -->
                                        <div class="opacity_slider_container">
                                            <input
                                                type="range"
                                                min="0.2"
                                                max="1"
                                                step="0.1"
                                                value={currentChannel ==
                                                ColorChannel.Main
                                                    ? pixiApp.editorNode
                                                          .objectPreview
                                                          ?.mainColor.opacity
                                                    : pixiApp.editorNode
                                                          .objectPreview
                                                          ?.detailColor.opacity}
                                                class="opacity_slider"
                                                disabled={!getObjSettings(
                                                    pixiApp.editorNode
                                                        .objectPreview?.id
                                                ).tintable ||
                                                    pixiApp?.editorNode
                                                        ?.objectPreview == null}
                                                on:input={(e) => {
                                                    if (
                                                        pixiApp.editorNode
                                                            .objectPreview !=
                                                        null
                                                    ) {
                                                        const val = e.target
                                                        if (
                                                            currentChannel ==
                                                            ColorChannel.Main
                                                        )
                                                            pixiApp.editorNode.objectPreview.mainColor.opacity =
                                                                val.value
                                                        else if (
                                                            currentChannel ==
                                                            ColorChannel.Detail
                                                        )
                                                            pixiApp.editorNode.objectPreview.detailColor.opacity =
                                                                val.value

                                                        pixiApp.editorNode.updateObjectPreview()
                                                    }
                                                }}
                                            />
                                        </div>
                                        <div class="colors_palette_container">
                                            {#each PALETTE as color}
                                                <button
                                                    class="edit_color_button invis_button wiggle_button"
                                                    style={(currentChannel ==
                                                        ColorChannel.Main &&
                                                        pixiApp.editorNode
                                                            .objectPreview
                                                            ?.mainColor.hex ==
                                                            color) ||
                                                    (currentChannel ==
                                                        ColorChannel.Detail &&
                                                        pixiApp.editorNode
                                                            .objectPreview
                                                            ?.detailColor.hex ==
                                                            color)
                                                        ? "outline: 2px solid #09d6e5;background-image:var(--color-button-enable);"
                                                        : ""}
                                                    disabled={!getObjSettings(
                                                        pixiApp.editorNode
                                                            .objectPreview?.id
                                                    ).tintable ||
                                                        pixiApp?.editorNode
                                                            ?.objectPreview ==
                                                            null ||
                                                        (currentChannel ===
                                                            ColorChannel.Main &&
                                                            pixiApp?.editorNode
                                                                ?.objectPreview
                                                                ?.mainColor
                                                                .blending &&
                                                            color ==
                                                                "000000") ||
                                                        (currentChannel ===
                                                            ColorChannel.Detail &&
                                                            pixiApp?.editorNode
                                                                ?.objectPreview
                                                                ?.detailColor
                                                                .blending &&
                                                            color == "000000")}
                                                    on:click={() => {
                                                        if (
                                                            pixiApp.editorNode
                                                                .objectPreview !=
                                                            null
                                                        ) {
                                                            if (
                                                                currentChannel ===
                                                                ColorChannel.Main
                                                            )
                                                                pixiApp.editorNode.objectPreview.mainColor.hex =
                                                                    color
                                                            else
                                                                pixiApp.editorNode.objectPreview.detailColor.hex =
                                                                    color

                                                            pixiApp.editorNode.updateObjectPreview()
                                                        }
                                                    }}
                                                >
                                                    <div
                                                        class="color_icon"
                                                        style="background-color: {'#' +
                                                            color};"
                                                    />
                                                </button>
                                            {/each}
                                        </div>
                                    </div>
                                </div>
                            {/if}
                        </div>
                    </div>
                {:else}
                    <div class="delete_menu">
                        Select the object you want to delete!
                    </div>
                {/if}
            </div>

            {#if currentMenu != EditorMenu.Delete}
                <button
                    class="place_button invis_button wiggle_button"
                    disabled={placeButtonDisabled || placeTimeLeft > 0}
                    on:click={() => {
                        if (
                            pixiApp.editorNode.objectPreview &&
                            placeTimeLeft == 0 &&
                            !placeButtonDisabled
                        ) {
                            placeButtonDisabled = true
                            addObjectToLevel(pixiApp.editorNode.objectPreview)
                                .catch((err) => {
                                    console.log(err)
                                    toast.push(
                                        `Failed to place object! (${err.message})`,
                                        toastErrorTheme
                                    )

                                    placeButtonDisabled = false
                                })
                                .then(() => {
                                    pixiApp.editorNode.removePreview()

                                    placeButtonDisabled = false
                                })
                        }
                    }}
                >
                    <div
                        style="opacity: {placeTimeLeft == 0
                            ? 1
                            : 0.5}; transform: scale({placeTimeLeft == 0
                            ? 1.0
                            : 0.7});transition: ease-in-out 0.4s;"
                    >
                        Place
                    </div>

                    <div
                        class="timer"
                        style="font-size:{placeTimeLeft == 0
                            ? 0
                            : 'var(--timer-font)'} !important;transition: ease-in-out 0.4s; text-align: center"
                    >
                        {new Date(placeTimeLeft * 1000)
                            .toISOString()
                            .substring(14, 19)}
                    </div>
                </button>
            {:else}
                <button
                    class="delete_button invis_button wiggle_button"
                    disabled={deleteButtonDisabled || deleteTimeLeft > 0}
                    on:click={() => {
                        if (
                            deleteTimeLeft == 0 &&
                            !deleteButtonDisabled &&
                            pixiApp.editorNode.selectedObjectNode != null
                        ) {
                            deleteButtonDisabled = true

                            pixiApp.editorNode.deleteSelectedObject(
                                () => {
                                    deleteButtonDisabled = false
                                },
                                () => {
                                    deleteButtonDisabled = false
                                }
                            )
                        }
                    }}
                >
                    <div
                        style="opacity: {deleteTimeLeft == 0
                            ? 1
                            : 0.5}; transform: scale({deleteTimeLeft == 0
                            ? 1.0
                            : 0.7});transition: ease-in-out 0.4s;"
                    >
                        Delete
                    </div>

                    <div
                        class="timer"
                        style="font-size:{deleteTimeLeft == 0
                            ? 0
                            : 'var(--timer-font)'} !important;transition: ease-in-out 0.4s;"
                    >
                        {new Date(deleteTimeLeft * 1000)
                            .toISOString()
                            .substring(14, 19)}
                    </div>
                </button>
            {/if}
        </div>
    {:else if !settings.hideMenu.enabled}
        <div class="login_requirement_message">
            You must be signed in to help build the level!
            <div style="transform:scale(0.8);opacity:0.5;margin-top:10px;">
                (click the icon in the top right corner)
            </div>
        </div>
    {/if}
</div>

<style>
    :root {
        --menu-height: calc(360px * var(--wscale, 1));
        --tray-rows: 2;
        --font-small: 24px;
        --font-medium: 32px;
        --font-large: 48px;
        --side-panel-icon-size: calc(56px * var(--wscale, 1));
        --icon-padding: 15px;
        --grid-button-size: 92px;
        --grid-gap: 16px;

        --tab-width: 170px;

        --timer-scale: 1;

        --timer-font: 70px;

        --color-button-enable: linear-gradient(
            rgb(183, 247, 130),
            rgb(64, 117, 48)
        );
    }

    /* tall desktop screens: three rows of objects */
    @media screen and (min-height: 960px) and (min-width: 900px) {
        :root {
            --menu-height: calc(420px * var(--wscale, 1));
            --tray-rows: 3;
        }
    }

    @media screen and (max-height: 800px) {
        :root {
            --menu-height: 250px;
            --font-small: 20px;
            --font-medium: 30px;
            --font-large: 40px;
            --side-panel-icon-size: 38px;
            --timer-scale: 0.678571429;
            --grid-button-size: 64px;
            --grid-gap: 12px;
            --timer-font: 40px;
        }
    }

    @media screen and (max-height: 375px) {
        :root {
            --menu-height: 170px;
            --font-small: 18px;
            --font-medium: 24px;
            --font-large: 32px;
            --side-panel-icon-size: 38px;
            --icon-padding: 5px;
            --timer-scale: 0.5;
            --grid-button-size: 50px;
            --grid-gap: 10px;
            --timer-font: 24px;
        }
    }

    @media screen and (orientation: landscape) and (max-height: 600px) {
        .menu {
            grid-template-columns: auto 1fr 20vw !important;
        }

        .place_button,
        .delete_button {
            width: min(20vw, 220px) !important;
            min-width: 116px !important;
            max-width: 20vw !important;
            font-size: 22px !important;
            -webkit-text-stroke: 1px black;
        }

        .timer {
            font-size: 24px !important;
        }

        .side_panel {
            min-width: 80px !important;
            min-height: 80px !important;
        }

        .login_requirement_message {
            max-height: 25vh;
            font-size: calc(var(--font-medium) - 6px) !important;
        }

        .loading {
            width: 100%;
            height: 100px !important;
            margin: 10px;
            overflow-x: hidden;
        }
    }

    .timer {
        justify-self: center;
        opacity: 1;
        /* font-size: var(--font-large); */

        text-shadow: 0 0 4px black;
    }

    @media screen and (orientation: portrait) {
        :root {
            --grid-button-size: 62px;
            --grid-gap: 12px;
            --font-medium: 22px;
            --font-large: 32px;

            --side-panel-icon-size: 100%;
        }

        .menu {
            /* the object list gets the bigger row; Place + the mode buttons the smaller one */
            grid-template-rows: minmax(0, 1.7fr) minmax(0, 1fr) !important;
            row-gap: var(--grid-gap) !important;
            height: min(46vh, 430px) !important;
        }


        .side_panel {
            min-width: 80px !important;
            min-height: 80px !important;
            grid-row-start: 2 !important;
        }

        .tab_button {
            font-size: calc(var(--font-small) * 0.8) !important;
        }

        .buttons_panel {
            min-width: 200px !important;
            grid-column-start: 1 !important;
        }

        .place_button,
        .delete_button {
            grid-area: placeh !important;
            justify-self: center !important;
            width: 100% !important;
        }

        .login_requirement_message {
            font-size: calc(var(--font-large) - 6px) !important;
        }

    }

    @media screen and (max-width: 600px) {
        :root {
            --grid-button-size: 48px;
            --font-medium: 18px;
        }
    }

    @media screen and (max-width: 1000px), screen and (max-height: 600px) {
        .colors_tab_container {
            grid-template-areas:
                "channels channels"
                "buttons buttons" !important;

            grid-template-columns: 1fr 1fr !important;
            grid-template-rows: 30px auto !important;
            overflow: hidden !important;
            gap: 2px !important;
        }

        .colors_tab_channels_container {
            flex-direction: row !important;
        }

        .colors_tab_labels_container {
            grid-template-columns: 70% 30% !important;
            grid-template-rows: 100% 0px !important;
            flex-direction: row !important;
            height: 100% !important;
        }

        .colors_tab_labels {
            border-radius: 6px 0px 0px 6px !important;
        }
        .blending_toggle {
            border-radius: 0px 6px 6px 0px !important;
            font-size: var(--font-small);
        }
    }

    * {
        -webkit-user-drag: none;
        -webkit-tap-highlight-color: rgba(255, 255, 255, 0);
    }

    ::-webkit-scrollbar {
        width: 15px;
        height: 15px;
    }
    ::-webkit-scrollbar-thumb {
        border-radius: 8px;
        background-color: #c3c3c3;
        border: 2px solid #eee;
    }

    ::-webkit-scrollbar-track {
        -webkit-box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.2);
        box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.2);
    }

    .editor {
        width: 100%;
        height: inherit;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        align-items: center;
        position: fixed;
    }
    .editor > .pixi_canvas {
        touch-action: none; /* the map handles its own drag / pinch / swipe gestures */
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100%;
        display: inline-block;
        z-index: 0;
    }

    .menu {
        width: 100%;
        height: min(var(--menu-height), 44vh);
        display: grid;
        grid-auto-columns: 1fr;
        grid-template-columns: auto 1fr auto;
        grid-template-rows: minmax(0, 1fr) 0px;
        grid-template-areas:
            "menu buttons placev"
            "menu placeh placeh";
        column-gap: var(--grid-gap);
        z-index: 20;
        isolation: isolate;
        padding: var(--grid-gap);
        padding-bottom: calc(var(--grid-gap) + env(safe-area-inset-bottom, 0px));

        /* pinned to the bottom edge: its place never depends on the flex layout / browser bars */
        position: fixed;
        left: 0;
        bottom: 0;
        animation-name: menu_in;
        animation-duration: 0.24s;
        animation-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    @keyframes menu_in {
        0% {
            opacity: 0;
            transform: translateY(100%);
        }
        100% {
            opacity: 1;
            transform: translateY(0%);
        }
    }

    .login_requirement_message {
        width: calc(100% - 32px);
        height: 300px;
        z-index: 10;
        display: flex;
        margin: 16px;
        background-color: #000c;
        border-radius: 16px;
        padding: var(--font-large); /* ?? */
        justify-content: center;
        flex-direction: column;
        gap: 10px;
        align-items: center;
        font-family: Pusab, Helvetica, sans-serif;
        color: white;
        font-size: calc(var(--font-large) - 6px);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        text-align: center;
    }

    .count_down_message {
        width: calc(100% - 32px);
        height: fit-content;
        min-height: 100px;
        max-height: 25vh;
        z-index: 10;
        display: flex;
        margin: 20px;

        background-color: #000c;
        border-radius: 16px;

        justify-content: center;

        align-items: center;

        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        margin-top: 5px;
        overflow: hidden;
    }

    @keyframes slide {
        0% {
            transform: translateX(-100%);
        }

        100% {
            transform: translateX(0%);
        }
    }

    .count_down_content {
        width: fit-content;
        display: grid;
        grid-template-columns: 30% 80%;
        margin: 20px;
        flex-direction: row;
        animation-name: slide;

        animation-duration: 5s;
        animation-timing-function: cubic-bezier(0, 0.3, 0.3, 1);
    }

    .count_down_text {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 15px;
        align-items: center;
        max-height: inherit;
    }

    .loading {
        width: 100%;
        height: 90%;
        margin: 10px;
        overflow: hidden;
        display: flex;
        justify-content: center;
        align-items: center;
    }
    .loading_icon {
        height: 100%;
        width: auto;
        object-fit: contain;
        -webkit-mask-image: linear-gradient(
            90deg,
            #00000000 15%,
            #fff 50%,
            #00000000 80%
        );
        mask-image: linear-gradient(
            90deg,
            #00000000 15%,
            #fff 50%,
            #00000000 80%
        );
    }

    .user_counter {
        display: flex;
        flex-direction: row;
        justify-content: center;
        align-items: center;
        gap: 15px;

        margin: 10px;
        font-family: Cabin, sans-serif;
        color: white;
        font-size: calc(var(--font-large) - 10px);
        text-align: center;
        min-width: 50vw;
    }

    .livestream_link {
        width: fit-content;
        height: fit-content;

        z-index: 12;
        padding: 5px;
        padding-left: 20px;
        padding-right: 20px;

        background-color: #000c;
        border-radius: 16px;

        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);

        font-family: Cabin, sans-serif;
        font-size: var(--font-medium);
        color: white;
        margin: 0;
        text-align: center;

        bottom: 0;
    }

    .livestream_link > a {
        color: rgb(98, 192, 255);
        text-decoration: none;
    }

    .menu_panel {
        background-color: #000c;
        border-radius: 16px;
        box-shadow: 0 8px 12px 0 #000a;
        backdrop-filter: blur(30px);
        -webkit-backdrop-filter: blur(30px);
    }

    .side_panel {
        min-width: min(120px, 10vh);
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: center;
        padding-top: var(--icon-padding);
        padding-bottom: var(--icon-padding);
        grid-area: menu;
        align-self: start;
    }
    .side_panel_button_icon {
        width: var(--side-panel-icon-size);
    }
    .side_panel.menu_panel > button {
        position: relative;
    }

    .dots {
        display: flex;
        flex-direction: row;
        margin-top: 5px;
    }

    .dot {
        height: 6px;
        width: 6px;
        background-color: rgb(255, 255, 255, 0.5);
        border-radius: 50%;
        display: inline-block;
        margin: 3px;
        transition: 0.3s;
    }
    #dot_on {
        background-color: rgb(255, 255, 255);
        transform: scale(1.2);
        transition: 0.1s;
    }
    .radial_timer {
        position: absolute;
        width: calc(var(--timer-scale) * 24px);
        height: calc(var(--timer-scale) * 24px);
        bottom: 0;
        right: 0;
        border-radius: 50%;
        /* backdrop-filter: blur(12px); */
        border: calc(var(--timer-scale) * 3.5px) solid white;
        background: conic-gradient(white 30deg, #000a 30deg 360deg);
    }

    .buttons_panel {
        width: 100%;
        min-width: 400px;
        height: 100%;
        display: grid;
        grid-template-rows: auto 1fr;
        grid-template-areas: "tabs" "container";
        gap: 0px 0px;
        grid-area: buttons;
        position: relative;
    }

    .tabs {
        grid-area: tabs;
        min-height: 40px;
        width: calc(100% - 32px);
        position: absolute;
        transform: translateY(-100%);
        justify-self: center;
        display: flex;
    }
    .tab_button {
        height: 32px;
        max-width: 250px;
        flex: 1 0 auto;
        background-color: #000c;
        border-radius: 16px 16px 0 0;
        margin: 0 8px 0 0;
        font-family: Pusab, Helvetica, sans-serif;
        -webkit-text-stroke: 1.5px black;
        color: white;
        font-size: var(--font-small);
        /* no transition: the tabs must never animate / bounce when switching */
        transition: none;
        backdrop-filter: blur(30px);
        -webkit-backdrop-filter: blur(30px);
    }
    /* Edit tabs (Transform / Layers / Colors): same size selected or not, only the brightness changes */
    .tabs .edit_tab_button {
        height: 36px;
        margin-top: 0;
        opacity: 0.55;
        transform: none !important;
    }
    .tabs .edit_tab_button.active {
        opacity: 1;
        background-color: #000f;
    }

    .obj_tab_button {
        background-color: transparent;
        background-image: url("/gd/ui/GJ_button_04-category-clean.png");
        background-repeat: no-repeat;
        background-position: center;
        background-size: 100% 100%;
        border-radius: 0;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        opacity: 0.78;
        filter: saturate(0.82);
        min-width: 42px;
        padding: 0 4px;
        position: relative;
        z-index: 2;
    }
    /* selected category: the tab AND its icon darken together, like the selected object cell */
    .obj_tab_button.active {
        opacity: 1;
        filter: brightness(0.5);
        z-index: 3;
    }
    .tab_button .obj_tab_icon {
        width: auto;
        height: auto;
        max-width: 5vw;
        max-height: 80%;
        object-fit: contain;
        vertical-align: middle;
        margin: 3px;
    }
    .tabs .obj_tab_button .obj_tab_icon {
        max-width: 100%;
        max-height: 100%;
        width: auto;
        height: auto;
        margin: 0;
        display: block;
        pointer-events: none;
    }
    /* category tabs: half the size of an object cell, bar centred above the panel */
    .tabs {
        justify-content: center;
        align-items: flex-end;
    }
    .tabs .obj_tab_button {
        flex: 0 0 auto;
        /* --tab-size comes from the script (bigger on wide screens); on narrow screens all the tabs shrink
           together so the whole bar always fits the width. Same size selected or not. */
        --fit: calc((100vw - var(--grid-gap) * 2 - 32px - var(--tab-n, 10) * 3px) / var(--tab-n, 10));
        width: min(var(--tab-size, 40px), var(--fit));
        height: min(var(--tab-size, 40px), var(--fit));
        /* no size change / transition between selected and unselected: nothing moves or bounces */
        transition: none;
        transform: none !important;
        min-width: 0;
        max-width: none;
        margin: 0 3px 0 0;
        padding: 0;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .tabs .obj_tab_button:last-child {
        margin-right: 0;
    }
    .tabs .obj_tab_button .obj_tab_icon {
        width: 66%;
        height: 66%;
        max-width: none;
        max-height: none;
        margin: 0;
        display: block;
        object-fit: contain;
        pointer-events: none;
    }

    .portrait_button_container {
        display: flex;
        align-items: center;
        justify-content: center;

        width: 100%;
        height: 100%;
        overflow: hidden;
        cursor: pointer;
    }

    .portrait_button {
        position: absolute;
        height: auto;
        width: auto;
        transition: all 0.2s;
    }

    .edit_info_text {
        font-family: Pusab, Helvetica, sans-serif;
        -webkit-text-stroke: 1.5px black;
        color: white;
        font-size: var(--font-medium);
        display: flex;
        justify-content: center;
        grid-area: text;
        align-items: center;
    }
    .edit_info_text2 {
        font-size: var(--font-small);
        opacity: 0.5;
        color: white;
        font-family: Cabin, sans-serif;
        grid-area: text2;
        display: flex;
        justify-content: center;
        align-items: center;
        font-style: italic;
        padding: var(--grid-gap);
        text-align: center;
    }
    .objects_grid_container {
        overflow-x: hidden;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        position: relative;
        grid-area: container;
        height: 100%;
        min-height: 0;
        isolation: isolate;
    }
    .build_objects_grid {
        display: flex;
        flex-direction: column;
        gap: 5px;
        overflow: hidden;
    }
    .object_search {
        flex: 0 0 30px;
        align-self: center;
        width: min(380px, calc(100% - 20px));
        height: 30px;
        min-height: 30px;
        box-sizing: border-box;
        border: 2px solid #111;
        border-radius: 8px;
        padding: 3px 10px;
        color: #fff;
        background: rgba(7, 22, 38, 0.96);
        box-shadow: inset 0 1px 0 #ffffff50, 0 2px 4px #0008;
        font: 14px ChatFont, sans-serif;
        outline: 1px solid #bfc4d0;
        user-select: text;
        -webkit-user-select: text;
        position: relative;
        z-index: 3;
    }
    .object_search::placeholder { color: #d2d6df; opacity: 0.75; }
    .build_objects_grid .objects_grid {
        flex: 1;
        height: auto;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        align-content: flex-start;
        scrollbar-gutter: stable;
    }
    .object_search_empty {
        width: 100%;
        padding: 18px 8px;
        color: #e7e9f1;
        text-align: center;
        font: 15px ChatFont, sans-serif;
        opacity: 0.78;
        text-shadow: 0 1px 2px #000;
    }
    .objects_grid {
        width: 100%;
        display: flex;
        height: 100%;
        flex-wrap: wrap;
        justify-content: center;
    }
    .obj_buttons_container {
        display: flex;
        position: relative;
        height: fit-content;
        width: 100%;
        justify-content: center;
        flex-wrap: wrap;
        align-content: flex-start;
        isolation: isolate;
    }
    .grid_padding {
        padding: var(--grid-gap);
        gap: 10px;
    }

    .delete_menu {
        width: 100%;
        height: 100%;
        padding: 10px;
        display: flex;
        justify-content: center;
        align-items: center;
        font-family: Pusab, Helvetica, sans-serif;
        color: white;
        font-size: calc(var(--font-medium));
        grid-area: container;
        text-align: center;
        -webkit-text-stroke: 1px black;
    }

    .place_button {
        width: clamp(150px, 22vw, 270px);
        height: 100%;
        background-color: #7ade2d;
        border-radius: 18px;
        box-shadow: 0 0 0 4px white inset, 0 0 0 8px black inset,
            4px 4px 0 8px #c6f249 inset, -4px -4px 0 8px #49851b inset;
        font-family: Pusab, Helvetica, sans-serif;
        color: white;
        font-size: clamp(22px, 2.7vw, var(--font-large));
        -webkit-text-stroke: 2px black;
        paint-order: stroke fill;
        line-height: 1;
        justify-self: end;
        grid-area: placev;

        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
    }
    .delete_button {
        width: clamp(150px, 22vw, 270px);
        height: 100%;
        background-color: #de2d30;
        border-radius: 18px;
        box-shadow: 0 0 0 4px white inset, 0 0 0 8px black inset,
            4px 4px 0 8px #f24980 inset, -4px -4px 0 8px #851b1d inset;
        font-family: Pusab, Helvetica, sans-serif;
        color: white;
        font-size: clamp(22px, 2.7vw, var(--font-large));
        -webkit-text-stroke: 2px black;
        justify-self: end;

        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
    }
    .obj_button {
        box-sizing: border-box;
        width: calc(var(--grid-button-size) * 0.94);
        height: calc(var(--grid-button-size) * 0.94);
        min-width: calc(var(--grid-button-size) * 0.94);
        min-height: calc(var(--grid-button-size) * 0.94);
        border-radius: 0;
        background: url("/gd/ui/GJ_button_04-clean.png") center / 100% 100% no-repeat;
        box-shadow: none;
        display: flex;
        justify-content: center;
        align-items: center;
        position: relative;
        z-index: 1;
        transform-origin: center;
    }

    .obj_button:disabled {
        opacity: 0.3;
    }

    /* selected object: the square AND the icon darken together */
    #selected_obj_button {
        filter: brightness(0.5);
        outline: none;
        z-index: 2;
    }

    .debug_objectID {
        display: none;
    }

    .obj_info {
        position: absolute;
        float: left;
        top: 100px;
        left: 12px;
        width: 300px;
        height: fit-content;
        padding: 10px;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        background-color: #000c;
        border-radius: 0px 16px 16px 16px;
        color: white;
        font-size: calc(var(--font-small) * 0.7);
        font-family: Cabin, sans-serif;
        max-height: 30vh;
        overflow-y: auto;
        overflow-x: hidden;
    }

    .username_display {
        font-family: Cabin, sans-serif;
        font-size: calc(var(--font-small) * 0.7);
        transform-origin: right;
        transform: scale(1.5);
        text-align: center;
    }

    .username_gradient {
        -webkit-text-fill-color: transparent !important;
        background-clip: text !important;
        -webkit-background-clip: text !important;
    }

    .info_line {
        display: flex;
        justify-content: space-between;
        height: 20px;
        width: 100%;
        flex-direction: row;
        margin: 0 0 10px 0;
    }

    .info_icon {
        width: auto;
        height: auto;
        max-height: 20px;
        max-width: 40px;
        float: right;
        object-fit: contain;
        vertical-align: middle;
    }

    .color_info {
        width: fit-content;
        height: 20px;
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 4px;
        row-gap: 50px;
        margin: 0 0 4px 0;
    }

    .color_circle {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        float: right;
        outline: 2px solid white;
    }

    .blending_info {
        width: 20px;
        height: 20px;
        font-family: Pusab, Helvetica, sans-serif;
        color: white;
        font-size: 24px;
        float: right;
        transform: translateY(-3px);
    }

    .opacity_info {
        width: 40px;
        height: 20px;
        font-family: Cabin, Helvetica, sans-serif;
        color: rgba(255, 255, 255, 0.8);
        font-size: 18px;
        float: right;
    }

    .object_comment {
        font-size: 10px;
        position: absolute;
        top: 5px;
        left: 5px;
        text-align: left;
        color: white;
        font-weight: bold;
        text-shadow: 1px 1px 2px black;
    }

    .edit_button,
    .edit_color_button,
    .blending_toggle,
    .colors_tab_labels {
        /* one plain stretched image (like the X button): no slices, so no grid lines */
        border-style: solid;
        border-width: 6px;
        border-color: transparent;
        border-image: none;
        background: url("/ui/GreenButton.png") center / 100% 100% no-repeat border-box;
        box-shadow: none;
        color: white;
        text-shadow: 0 1px 2px #000, 1px 1px 1px #000;
        position: relative;
        z-index: 1;
    }
    .edit_button {
        width: calc(var(--grid-button-size) * 0.92);
        height: calc(var(--grid-button-size) * 0.92);
        min-width: calc(var(--grid-button-size) * 0.92);
        min-height: calc(var(--grid-button-size) * 0.92);
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .edit_button:disabled,
    .edit_color_button:disabled,
    .blending_toggle:disabled {
        opacity: 0.42;
        filter: grayscale(0.6);
    }
    .blending_toggle {
        border-width: 6px;
        border-image-width: 6px;
        min-width: 34px;
    }
    .colors_tab_labels {
        border-width: 5px;
        border-image-width: 5px;
        padding: 0 4px;
    }

    .edit_color_button {
        width: calc(var(--grid-button-size) * 0.82);
        height: calc(var(--grid-button-size) * 0.82);
        display: flex;
        justify-content: center;
        align-items: center;
    }

    .edit_color_button:disabled {
        opacity: 0.3;
    }

    .colors_tab_container {
        display: grid;
        gap: 10px;
        grid-template-rows: minmax(auto, min-content) minmax(auto, min-content);

        grid-template-areas:
            "channels buttons"
            "channels buttons";
        width: 100%;
        height: 100%;
    }

    .colors_tab_channels_container {
        grid-area: channels;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 5px;
    }

    .colors_tab_labels {
        font-family: Pusab;
        color: white;
        -webkit-text-stroke: 1.5px black;
        paint-order: stroke fill;
        font-size: calc(var(--font-small) * 0.85);
        line-height: 1;
        white-space: nowrap;
        overflow: hidden;
        min-width: 0;

        display: flex;
        flex-direction: row;
        justify-content: center;
        align-items: center;
        text-align: center;
        border-radius: 6px 6px 0px 0px;
        background-image: url("/ui/EmptyButtonGreen.png");
        background-size: 100% 100%;
    }

    .colors_tab_labels_container {
        display: grid;
        grid-template-rows: 60% 40%;
        flex-direction: column;
        height: 100%;
        width: 100%;
        opacity: 0.3;
        padding: 0;
        gap: 2px;
    }

    .blending_toggle {
        border-radius: 0px 0px 6px 6px;
        display: flex;
        justify-content: center;
        align-items: center;

        font-family: Pusab, Helvetica, sans-serif;
        color: white;
        font-size: calc(var(--font-small) * 0.7);
        -webkit-text-stroke: 1.5px black;
        paint-order: stroke fill;
        line-height: 1;
        text-align: center;
        white-space: nowrap;
        padding: 0 !important;

        width: 100%;
        text-overflow: clip;
        overflow: hidden;
    }

    .colors_buttons_container {
        height: 100%;
        width: 100%;
        grid-area: buttons;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        padding-bottom: 14px;
    }

    .colors_palette_container {
        grid-area: palette;
        width: 100%;
        height: 100%;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: center;
    }

    .zlayers_container {
        display: grid;
        gap: 0px 0px;
        grid-template-areas:
            "buttons"
            "text"
            "text2";
        width: 100%;
        height: 100%;
        grid-template-rows: min-content min-content min-content;
    }

    #selected_channel_button {
        opacity: 1;
    }

    .blending_toggle:disabled {
        opacity: 0.3;
    }

    .opacity_slider_container {
        width: 100%;
        height: 100%;

        padding: 10px 20px 10px 20px;

        display: flex;
        justify-content: center;
        align-items: center;
        gap: 8px;
        flex-direction: column;
    }

    .opacity_slider:disabled {
        opacity: 0.3;
    }

    .opacity_slider {
        background: none;
        appearance: none;
        width: 100%;
    }

    input[type="range"]::-moz-range-track {
        -moz-appearance: none;
        width: 100%;
        height: 100%;
        background: linear-gradient(to right, #00000000 0%, #ffffffff 100%);
        background-color: none;
        border-radius: 6px;
    }
    input[type="range"]::-webkit-slider-runnable-track {
        width: 100%;
        height: 100%;
        background: linear-gradient(to right, #00000000 0%, #ffffffff 100%);
        background-color: none;
        border-radius: 6px;
        -webkit-appearance: none;
    }

    .playbutton {
        position: absolute;
        top: var(--corner-gap);
        left: var(--corner-gap);
        cursor: pointer;
        z-index: 20;
    }
    /* same size as the Settings / profile / Admin corner buttons */
    .playbutton > img {
        display: block;
        height: var(--corner-size);
        width: auto;
    }

    .tab_button::before {
        box-shadow: 0 0 0 300px rgba(#95a, 0.75);
    }

    .edit_button > .button_icon {
        object-fit: fill;
        max-width: 60%;
        max-height: 60%;
        width: auto;
        height: auto;
    }

    .obj_button > .button_icon {
        position: absolute;
        inset: 0;
        margin: auto;
        display: block;
        width: 60%;
        height: 60%;
        max-width: none;
        max-height: none;
        object-fit: contain;
        transform: none;
        pointer-events: none;
    }

    .invis_button {
        cursor: pointer;
    }


    .color_icon {
        width: 85%;
        height: 85%;
        border-radius: 10%;
        border: 2px solid white;
    }

    /* ---------- object tray: 2 rows, pages side by side, swipe to scroll ---------- */
    .build_objects_grid .tray {
        flex: 1;
        min-height: 0;
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 0 4px 4px;
    }
    .build_objects_grid .tray .objects_grid {
        flex: 1;
        min-width: 0;
        height: 100%;
        display: block;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: none;
        scrollbar-gutter: auto;
        scroll-snap-type: x proximity;
        -webkit-overflow-scrolling: touch;
    }
    .build_objects_grid .tray .objects_grid::-webkit-scrollbar {
        display: none;
    }
    .build_objects_grid .tray .obj_buttons_container {
        display: grid;
        /* --cell / --rows are computed in the script from the real height of the list */
        grid-template-rows: repeat(var(--rows, 2), var(--cell, 64px));
        grid-auto-flow: column;
        grid-auto-columns: var(--cell, 64px);
        justify-content: center;
        justify-items: center; /* cells keep their own square size, never stretched by the grid */
        align-items: center;
        align-content: center;
        gap: 8px;
        width: max-content;
        min-width: 100%;
        height: 100%;
        padding: 4px 8px;
        box-sizing: border-box;
    }
    .build_objects_grid .tray .obj_buttons_container > .obj_button {
        flex: none;
        width: var(--cell, 64px);
        height: var(--cell, 64px);
        min-width: var(--cell, 64px);
        min-height: var(--cell, 64px);
        aspect-ratio: 1 / 1;
    }
    .build_objects_grid .tray .obj_button {
        scroll-snap-align: start;
    }
    .build_objects_grid .tray .object_search_empty {
        grid-column: 1 / -1;
        grid-row: 1 / -1;
        align-self: center;
    }

    /* ---- secret swipe button (Transform tab): same GD green button as the other edit buttons ---- */
    .swipe_button {
        color: white;
    }
    .swipe_button > svg {
        width: 58%;
        height: 58%;
        display: block;
        filter: drop-shadow(0 1px 1px #000);
        pointer-events: none;
    }
    .swipe_button.on {
        filter: brightness(1.18) drop-shadow(0 0 4px #c6f249);
    }

    /* ---- Main / Detail / B buttons of the Colors tab ----
       Built from the 3 pieces cut out of GreenButton.png (green_l / green_m / green_r, the same ones GDButton
       uses): the two ends keep their rounded shape and only the middle stretches, so nothing is squashed. */
    .colors_tab_labels,
    .blending_toggle {
        border: 0 !important;
        border-radius: 0 !important;
        background: url("/ui/btn/green_m.png") center / 100% 100% no-repeat !important;
        box-shadow: none !important;
    }
    .colors_tab_labels {
        padding: 0 0.8em !important;
    }
    .colors_tab_labels::before,
    .colors_tab_labels::after,
    .blending_toggle::before,
    .blending_toggle::after {
        content: "";
        position: absolute;
        top: 0;
        height: 100%;
        aspect-ratio: 28 / 80; /* the end pieces are 28x80 */
        background-repeat: no-repeat;
        background-size: 100% 100%;
        pointer-events: none;
        z-index: -1; /* behind the text, above the stretched middle */
    }
    .colors_tab_labels::before,
    .blending_toggle::before {
        left: 0;
        background-image: url("/ui/btn/green_l.png");
    }
    .colors_tab_labels::after,
    .blending_toggle::after {
        right: 0;
        background-image: url("/ui/btn/green_r.png");
    }
</style>
