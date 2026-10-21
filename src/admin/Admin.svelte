<script lang="ts">
    import { toast } from "../ui/notify"
    import { api } from "../backend/init"
    import { currentUserData } from "../backend/auth"
    import {
        editorState,
        streamLink,
        refreshState,
        adminSettings,
        levelSize,
        globalMessage,
    } from "../backend/state"
    import { toastErrorTheme, toastSuccessTheme } from "../const"
    import GDCheckbox from "../ui/GDCheckbox.svelte"
    import GDText from "../ui/GDText.svelte"
    import GDButton from "../ui/GDButton.svelte"
    import FramePanel from "../ui/FramePanel.svelte"
    import { exportGmd } from "../editor/exportGmd"

    let open = false

    // --- general settings (always loaded from the server when the panel opens) ---
    let placeTimer = ""
    let deleteTimer = ""
    let chunkLimit = ""
    let editingEnabled = true
    let stream = ""
    let levelWidth = ""
    let levelHeight = ""

    // --- per-user tools + global message (drafts, kept across page refreshes) ---
    let target = ""
    let color = ""
    let userPlaceTimer = ""
    let userDeleteTimer = ""
    let messageText = ""

    const DRAFT_KEY = "gdplace_admin_draft"
    try {
        const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}")
        target = d.target ?? ""
        color = d.color ?? ""
        userPlaceTimer = d.userPlaceTimer ?? ""
        userDeleteTimer = d.userDeleteTimer ?? ""
        messageText = d.messageText ?? ""
    } catch {}
    function saveDraft(...v: string[]) {
        try {
            localStorage.setItem(
                DRAFT_KEY,
                JSON.stringify({
                    target: v[0],
                    color: v[1],
                    userPlaceTimer: v[2],
                    userDeleteTimer: v[3],
                    messageText: v[4],
                })
            )
        } catch {}
    }
    $: saveDraft(
        String(target ?? ""),
        String(color ?? ""),
        String(userPlaceTimer ?? ""),
        String(userDeleteTimer ?? ""),
        String(messageText ?? "")
    )

    function syncFromServer() {
        const s = $editorState
        if (!s) return
        placeTimer = String(s.placeTimer)
        deleteTimer = String(s.deleteTimer)
        editingEnabled = s.canEdit
        stream = $streamLink || ""
        levelWidth = $levelSize ? String($levelSize.width) : ""
        levelHeight = $levelSize ? String($levelSize.height) : ""
        chunkLimit =
            $adminSettings?.chunkObjectLimit != null
                ? String($adminSettings.chunkObjectLimit)
                : ""
    }

    async function openPanel() {
        open = true
        syncFromServer() // instant, from what the page already has
        await refreshState() // then the freshest values
        syncFromServer()
    }

    let exporting = false
    async function doExport() {
        if (exporting) return
        exporting = true
        try {
            const n = await exportGmd()
            toast.push(`Exported ${n} objects to gdplace.gmd`, toastSuccessTheme)
        } catch (err) {
            toast.push(`Export failed! (${err?.message ?? "error"})`, toastErrorTheme)
        }
        exporting = false
    }

    async function call(body: any, okMsg: string) {
        try {
            await api("admin", body)
            toast.push(okMsg, toastSuccessTheme)
            await refreshState()
        } catch (err) {
            toast.push(`Failed! (${err?.message ?? "error"})`, toastErrorTheme)
        }
    }

    // Every setting is applied to the server and to this page as soon as it is changed:
    // typing is debounced (600ms), toggles / Enter / leaving the field apply immediately.
    const timers: Record<string, any> = {}
    const positive = ["placeTimer", "deleteTimer", "chunkObjectLimit", "levelWidth", "levelHeight"]
    function apply(key: string, raw: any, immediate = false) {
        let value = raw == null ? "" : String(raw).trim()
        clearTimeout(timers[key])

        // A stream URL is only submitted on blur/change, never while the user is halfway
        // through typing it. Invalid input stays local and cannot flood /api/admin with 400s.
        if (key === "streamLink" && !immediate) return
        if (key === "streamLink" && value !== "") {
            try {
                const parsed = new URL(value)
                if (
                    !["https:", "http:"].includes(parsed.protocol) ||
                    !parsed.hostname ||
                    parsed.username ||
                    parsed.password ||
                    value.length > 300
                ) throw new Error("Use a valid http:// or https:// link (max 300 characters)")
                value = parsed.toString()
            } catch (err) {
                toast.push(
                    err?.message?.startsWith("Use a valid")
                        ? err.message
                        : "Enter a complete link beginning with https:// or http://",
                    toastErrorTheme
                )
                return
            }
        }
        if (positive.includes(key) && value !== "" && !(+value >= 0)) return
        const run = async () => {
            try {
                await api("admin", { action: "set", key, value })
                await refreshState()
                toast.push("Saved", toastSuccessTheme)
            } catch (err) {
                toast.push(`Failed! (${err?.message ?? "error"})`, toastErrorTheme)
            }
        }
        if (immediate) run()
        else timers[key] = setTimeout(run, 600)
    }

    async function sendMessage() {
        if (!messageText.trim()) {
            toast.push("Write a message first", toastErrorTheme)
            return
        }
        await call({ action: "broadcast", text: messageText }, "Message sent to everyone")
    }
</script>

<svelte:window
    on:keydown={(e) => {
        if (e.key === "Escape") open = false
    }}
/>

{#if $currentUserData?.data?.admin}
    <div class="all">
        <button
            class="admin_button invis_button wiggle_button"
            aria-label="Admin panel"
            on:click={openPanel}
        >
            <img
                draggable="false"
                src="/ui/BlueOptions.png"
                alt="admin button"
            />
        </button>

        {#if open}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div class="overlay" on:click|self={() => (open = false)}>
                <FramePanel width="min(1000px, 100%)" dim={0.7}>
                    <div class="admin_panel">
                        <button
                            class="x_button invis_button wiggle_button"
                            aria-label="Close"
                            on:click={() => (open = false)}
                        >
                            <img draggable="false" src="/ui/Close.png" alt="close" />
                        </button>
                        <div class="title">
                            <GDText font="gold" text="Admin" size={38} />
                        </div>

                        <div class="section">
                            <GDText font="gold" text="Settings" size={28} />
                        </div>

                        <label class="field">
                            <GDText font="chat" text="Place timer (seconds)" size={22} />
                            <input
                                class="gd_input"
                                type="number"
                                min="1"
                                bind:value={placeTimer}
                                on:input={(e) => apply("placeTimer", e.currentTarget.value)}
                                on:change={(e) => apply("placeTimer", e.currentTarget.value, true)}
                            />
                        </label>
                        <label class="field">
                            <GDText font="chat" text="Delete timer (seconds)" size={22} />
                            <input
                                class="gd_input"
                                type="number"
                                min="1"
                                bind:value={deleteTimer}
                                on:input={(e) => apply("deleteTimer", e.currentTarget.value)}
                                on:change={(e) => apply("deleteTimer", e.currentTarget.value, true)}
                            />
                        </label>
                        <label class="field">
                            <GDText
                                font="chat"
                                text="Object limit per chunk (empty = default)"
                                size={22}
                            />
                            <input
                                class="gd_input"
                                type="number"
                                min="1"
                                bind:value={chunkLimit}
                                on:input={(e) => apply("chunkObjectLimit", e.currentTarget.value)}
                                on:change={(e) => apply("chunkObjectLimit", e.currentTarget.value, true)}
                            />
                        </label>
                        <div class="section">
                            <GDText font="gold" text="Build area" size={28} />
                        </div>
                        <label class="field">
                            <GDText font="chat" text="Width (grid cells)" size={22} />
                            <input
                                class="gd_input"
                                type="number"
                                min="10"
                                max="20000"
                                bind:value={levelWidth}
                                on:change={(e) => apply("levelWidth", e.currentTarget.value, true)}
                            />
                        </label>
                        <label class="field">
                            <GDText font="chat" text="Height (grid cells)" size={22} />
                            <input
                                class="gd_input"
                                type="number"
                                min="10"
                                max="2000"
                                bind:value={levelHeight}
                                on:change={(e) => apply("levelHeight", e.currentTarget.value, true)}
                            />
                            <span class="field_hint">Applied when you leave the field. Everyone's page reloads to use the new size. Objects outside a smaller area are kept but cannot be placed.</span>
                        </label>

                        <label class="field">
                            <GDText font="chat" text="Stream link" size={22} />
                            <input
                                class="gd_input"
                                type="url"
                                maxlength="300"
                                inputmode="url"
                                autocomplete="url"
                                placeholder="https://example.com/stream"
                                bind:value={stream}
                                on:input={(e) => apply("streamLink", e.currentTarget.value)}
                                on:change={(e) => apply("streamLink", e.currentTarget.value, true)}
                            />
                            <span class="field_hint">Only a complete http:// or https:// URL is saved. Leave empty to clear it.</span>
                        </label>
                        <div class="check">
                            <GDCheckbox
                                label="Editing enabled"
                                checked={editingEnabled}
                                on:toggle={(e) => {
                                    editingEnabled = e.detail
                                    apply("canEdit", e.detail ? "1" : "0", true)
                                }}
                            />
                        </div>

                        <div class="section">
                            <GDText font="gold" text="Sync" size={28} />
                        </div>
                        <div class="btns">
                            <GDButton
                                label="Reload everyone's page"
                                color="red"
                                width={320}
                                textSize={22}
                                on:click={() => {
                                    if (
                                        confirm(
                                            "Reload the page for everyone online? Their current progress (position, selected object, menu) is kept."
                                        )
                                    )
                                        call({ action: "reloadAll" }, "Reload sent to everyone")
                                }}
                            />
                        </div>
                        <div class="btns">
                            <GDButton
                                color="green"
                                label={exporting ? "Exporting..." : "Export level (.gmd)"}
                                disabled={exporting}
                                textSize={22}
                                on:click={doExport}
                            />
                        </div>
                        <div class="field">
                            <span class="field_hint">Use this after an update so everyone gets the latest version. Each player keeps their camera position, selected object and menu.</span>
                        </div>

                        <div class="section">
                            <GDText font="gold" text="Global message" size={28} />
                        </div>

                        <label class="field">
                            <GDText
                                font="chat"
                                text="Message shown to everyone (max 300 characters)"
                                size={22}
                                maxWidth={460}
                            />
                            <textarea
                                class="gd_input gd_textarea"
                                rows="4"
                                maxlength="300"
                                placeholder="Type a message..."
                                bind:value={messageText}
                            />
                        </label>
                        {#if $globalMessage}
                            <div class="field">
                                <GDText
                                    font="chat"
                                    text={`Active now: ${$globalMessage.text}`}
                                    size={18}
                                    color="#9fe870"
                                />
                            </div>
                        {/if}
                        <div class="btns">
                            <GDButton
                                label="Send message"
                                color="green"
                                width={230}
                                textSize={24}
                                on:click={sendMessage}
                            />
                            <GDButton
                                label="Clear message"
                                color="red"
                                width={230}
                                textSize={22}
                                on:click={() =>
                                    call({ action: "clearBroadcast" }, "Message cleared")}
                            />
                        </div>

                        <div class="section">
                            <GDText font="gold" text="Users" size={28} />
                        </div>

                        <label class="field">
                            <GDText
                                font="chat"
                                text="GD username (must have logged in once)"
                                size={22}
                            />
                            <input
                                class="gd_input"
                                type="text"
                                bind:value={target}
                            />
                        </label>
                        <div class="btns">
                            <GDButton
                                label="Ban"
                                color="red"
                                width={180}
                                textSize={24}
                                on:click={() =>
                                    call({ action: "ban", username: target }, "Banned")}
                            />
                            <GDButton
                                label="Unban"
                                color="green"
                                width={180}
                                textSize={24}
                                on:click={() =>
                                    call({ action: "unban", username: target }, "Unbanned")}
                            />
                            <GDButton
                                label="Make admin"
                                color="green"
                                width={180}
                                textSize={24}
                                on:click={() =>
                                    call({ action: "makeAdmin", username: target }, "Admin added")}
                            />
                            <GDButton
                                label="Remove admin"
                                color="red"
                                width={180}
                                textSize={22}
                                on:click={() =>
                                    call({ action: "removeAdmin", username: target }, "Admin removed")}
                            />
                        </div>

                        <label class="field">
                            <GDText
                                font="chat"
                                text="Name colour (hex, several = gradient, empty = reset)"
                                size={22}
                                maxWidth={460}
                            />
                            <input
                                class="gd_input"
                                type="text"
                                placeholder="fc3fe9 7a4dff"
                                bind:value={color}
                            />
                        </label>
                        <div class="btns">
                            <GDButton
                                label="Set colour"
                                color="green"
                                width={200}
                                textSize={24}
                                on:click={() =>
                                    call({ action: "color", username: target, color }, "Colour set")}
                            />
                        </div>

                        <label class="field">
                            <GDText
                                font="chat"
                                text="Personal place timer (empty = default)"
                                size={22}
                            />
                            <input
                                class="gd_input"
                                type="number"
                                min="1"
                                bind:value={userPlaceTimer}
                            />
                        </label>
                        <label class="field">
                            <GDText
                                font="chat"
                                text="Personal delete timer (empty = default)"
                                size={22}
                            />
                            <input
                                class="gd_input"
                                type="number"
                                min="1"
                                bind:value={userDeleteTimer}
                            />
                        </label>
                        <div class="btns">
                            <GDButton
                                label="Set timers"
                                color="green"
                                width={200}
                                textSize={24}
                                on:click={() =>
                                    call(
                                        {
                                            action: "userTimer",
                                            username: target,
                                            placeTimer: userPlaceTimer,
                                            deleteTimer: userDeleteTimer,
                                        },
                                        "Timers set"
                                    )}
                            />
                        </div>

                    </div>
                </FramePanel>
            </div>
        {/if}
    </div>
{/if}

<style>
    /* same layout rules as the Settings button/panel so the two match */
    .all {
        position: absolute;
        width: 100%;
        height: 100vh;
        height: 100dvh;
        pointer-events: none;
        /* no z-index here on purpose: the button and the panel overlay set their own, so the
           button can drop behind the editor UI on phones without dragging the panel with it */
    }
    .all * {
        pointer-events: auto;
    }

    .admin_button {
        position: absolute;
        top: 0;
        left: 0;
        /* the play-music button sits at top: 12px / left: 12px (75px tall), so go below it */
        margin-top: calc(var(--corner-gap) * 2 + var(--corner-size));
        margin-left: var(--corner-gap);
        padding: 0;
        line-height: 0;
        z-index: 40;
    }
    /* phone layout (same query as mobileScreenQuery in Editor.svelte): sit BEHIND the editor UI
       (z-index 10-20) but above the canvas */
    @media (max-height: 600px), (orientation: portrait) {
        .admin_button {
            z-index: 5;
        }
    }
    .admin_button > img {
        display: block;
        width: var(--corner-size);
        height: var(--corner-size);
        object-fit: contain;
    }

    .overlay {
        position: fixed;
        inset: 0;
        width: 100%;
        height: 100vh;
        height: 100dvh;
        box-sizing: border-box;
        overflow: hidden;
        z-index: 60;
        background: transparent;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 12px;
    }
    @media (max-width: 640px) {
        /* phones: the frame spans the whole screen width, only the black area stretches */
        .overlay {
            padding: 0;
        }
    }

    .x_button {
        position: absolute;
        top: 2px;
        left: 6px;
        width: 54px;
        height: 56px;
        z-index: 5;
    }
    .x_button > img {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }
    .admin_panel {
        position: relative;
        width: 100%;
        padding: 4px 8px 8px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
    }
    .title {
        padding-top: 4px;
    }
    .section {
        margin-top: 10px;
    }
    .field {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .check {
        width: 100%;
    }
    .btns {
        width: 100%;
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 6px 10px;
    }

    /* same look as the login inputs */
    .field_hint {
        display: block;
        color: #d7dfef;
        font: 12px/1.35 ChatFont, sans-serif;
        opacity: 0.78;
        padding-top: 3px;
    }
    .gd_input {
        min-width: 0;
        width: 100%;
        box-sizing: border-box;
        border-radius: 8px;
        background-color: #00000066;
        border: 2px solid #bbbbbb;
        color: white;
        font-family: ChatFont, "Helvetica Neue", Helvetica, sans-serif;
        font-size: 18px;
        padding: 10px 12px;
        outline: none;
    }
    .gd_textarea {
        resize: vertical;
        min-height: 90px;
        line-height: 1.3;
    }
    .gd_input::placeholder {
        color: #ffffff77;
    }
</style>
