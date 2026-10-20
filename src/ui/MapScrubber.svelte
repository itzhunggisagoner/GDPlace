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
        --h: 32px;
        position: absolute;
        top: calc(var(--corner-gap) + var(--corner-size) / 2 - var(--h) / 2);
        left: 50%;
        transform: translateX(-50%);
        width: min(440px, 44vw);
        min-width: 140px;
        height: var(--h);
        z-index: 25;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        cursor: pointer;
    }
    /* phones / narrow screens: own row under the corner buttons, with room for the
       button (1.9 x height) to stick out at both ends without being covered */
    @media (max-width: 900px), (orientation: portrait) {
        .scrubber {
            top: calc(var(--corner-gap) * 2 + var(--corner-size) + var(--h) * 0.5);
            width: calc(100vw - var(--h) * 3);
            max-width: 560px;
            min-width: 0;
        }
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
