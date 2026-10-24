<script lang="ts">
    // MoveButton on MoveButtonSliderGroove: drags the camera from the start
    // to the end of the buildable area. No fill bar (unlike GDSlider).
    import { onMount } from "svelte"
    import { pixiApp } from "../editor/app"
    import { LEVEL_BOUNDS } from "../editor/nodes"
    import { storePosState } from "../editor/app"

    let groove: HTMLDivElement
    let holding = false
    let value = 0

    const span = () => LEVEL_BOUNDS.end.x - LEVEL_BOUNDS.start.x

    const setFromEvent = (e: PointerEvent) => {
        const r = groove.getBoundingClientRect()
        const pad = r.height / 2
        const v = Math.min(1, Math.max(0, (e.clientX - r.left - pad) / Math.max(1, r.width - pad * 2)))
        value = v
        if (pixiApp?.editorNode) {
            pixiApp.editorNode.cameraPos.x = LEVEL_BOUNDS.start.x + v * span()
            storePosState(pixiApp)
        }
    }
    const down = (e: PointerEvent) => {
        holding = true
        if (pixiApp) pixiApp.dragging = null
        groove.setPointerCapture(e.pointerId)
        setFromEvent(e)
        e.stopPropagation()
        e.preventDefault()
    }
    const move = (e: PointerEvent) => {
        if (holding) setFromEvent(e)
    }
    const up = () => {
        holding = false
    }

    onMount(() => {
        let raf = 0
        const loop = () => {
            // follow the camera when the user is not dragging the button
            if (!holding && pixiApp?.editorNode) {
                const x = pixiApp.editorNode.cameraPos.x
                value = Math.min(1, Math.max(0, (x - LEVEL_BOUNDS.start.x) / span()))
            }
            raf = requestAnimationFrame(loop)
        }
        loop()
        return () => cancelAnimationFrame(raf)
    })
</script>

<div
    class="scrubber"
    bind:this={groove}
    style="--v: {value}"
    on:pointerdown={down}
    on:pointermove={move}
    on:pointerup={up}
    on:pointercancel={up}
    role="slider"
    aria-label="Move across the map"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round(value * 100)}
    tabindex="0"
>
    <div class="groove" />
    <div class="rail">
        <img
            class="btn"
            draggable="false"
            alt=""
            src={holding ? "/ui/slider/MoveButtonHolding.png" : "/ui/slider/MoveButton.png"}
        />
    </div>
</div>

<style>
    .scrubber {
        /* 22px on a 1440px-wide screen, grows with the width (--wscale, set by the Editor); ~16px on phones */
        --h: calc(22px * var(--ui-zoom, 1) * var(--wscale, 1));
        position: absolute;
        /* same row as the play-music button (top-left) and the Settings / profile buttons (top-right),
           vertically centred on that row, in the free space between them */
        top: calc(var(--corner-gap) + (var(--corner-size) - var(--h)) / 2);
        left: calc(var(--corner-gap) * 2 + var(--corner-size) + var(--h) * 1.3);
        right: calc(var(--corner-gap) * 3 + var(--corner-size) * 2 + var(--h) * 1.3);
        margin-inline: auto;
        max-width: calc(300px * var(--wscale, 1));
        height: var(--h);
        z-index: 25;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        cursor: pointer;
    }
    /* invisible, bigger touch target around the thin bar */
    .scrubber::after {
        content: "";
        position: absolute;
        inset: -14px -6px;
    }

    /* groove drawn in 3 parts: left cap | stretchable middle | right cap (sprite is 420x32, caps ~13px) */
    .groove {
        position: absolute;
        inset: 0;
        box-sizing: border-box;
        border-style: solid;
        border-width: 0 calc(var(--h) * 0.42);
        border-image: url("/ui/slider/MoveButtonSliderGroove.png") 0 3.2% fill / 0 calc(var(--h) * 0.42) / 0 stretch;
        pointer-events: none;
    }
    .rail {
        position: absolute;
        left: calc(var(--h) / 2);
        right: calc(var(--h) / 2);
        top: 0;
        bottom: 0;
        pointer-events: none;
    }
    .btn {
        position: absolute;
        top: 50%;
        left: calc(var(--v) * 100%);
        width: calc(var(--h) * 2.375); /* 76x80 sprite on a 32px groove */
        height: calc(var(--h) * 2.5);
        transform: translate(-50%, -50%);
        pointer-events: none;
    }
</style>
