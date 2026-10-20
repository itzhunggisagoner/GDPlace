<script lang="ts">
    // Slider for settings: SliderKnob on SliderKnobGroove, with SliderKnobBar
    // filling the groove behind the knob while it is dragged.
    import { createEventDispatcher } from "svelte"
    export let value = 0 // 0..1
    export let disabled = false
    export let height = 32
    const dispatch = createEventDispatcher()

    let groove: HTMLDivElement
    let holding = false

    const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

    const setFromEvent = (e: PointerEvent) => {
        const r = groove.getBoundingClientRect()
        // knob is as tall as the groove, keep it inside the groove
        const pad = r.height / 2
        const v = clamp01((e.clientX - r.left - pad) / Math.max(1, r.width - pad * 2))
        value = v
        dispatch("input", v)
    }
    const down = (e: PointerEvent) => {
        if (disabled) return
        holding = true
        groove.setPointerCapture(e.pointerId)
        setFromEvent(e)
        e.stopPropagation()
    }
    const move = (e: PointerEvent) => {
        if (holding) setFromEvent(e)
    }
    const up = (e: PointerEvent) => {
        if (!holding) return
        holding = false
        dispatch("change", value)
    }
</script>

<div
    class="slider"
    class:disabled
    style="--h: {height}px; --v: {value}"
    bind:this={groove}
    on:pointerdown={down}
    on:pointermove={move}
    on:pointerup={up}
    on:pointercancel={up}
    role="slider"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round(value * 100)}
    tabindex="0"
>
    <div class="groove" />
    <!-- fill bar (SliderKnobBar): tiled in pieces, always shown up to just behind the knob -->
    <div class="inner">
        <div class="bar" />
    </div>
    <div class="rail">
        <img
            class="knob"
            draggable="false"
            alt=""
            src={holding ? "/ui/slider/SliderKnobHolding.png" : "/ui/slider/SliderKnob.png"}
        />
    </div>
</div>

<style>
    .slider {
        position: relative;
        width: 100%;
        max-width: 440px;
        height: var(--h);
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        cursor: pointer;
        margin: calc(var(--h) * 0.75) 0;
    }
    .slider.disabled {
        opacity: 0.5;
        cursor: default;
    }
    /* groove drawn in 3 parts: left cap | stretchable middle | right cap (sprite is 420x32, caps ~13px) */
    .groove {
        position: absolute;
        inset: 0;
        box-sizing: border-box;
        border-style: solid;
        border-width: 0 calc(var(--h) * 0.42);
        border-image: url("/ui/slider/SliderKnobGroove.png") 0 3.2% fill / 0 calc(var(--h) * 0.42) / 0 stretch;
        pointer-events: none;
    }
    .inner {
        position: absolute;
        left: calc(var(--h) * 0.22);
        right: calc(var(--h) * 0.22);
        /* hollow part of the groove sprite: rows 11-19 of 32 */
        top: 34.5%;
        bottom: 37%;
        overflow: hidden;
        border-radius: 999px;
        pointer-events: none;
    }
    .bar {
        height: 100%;
        /* ends a little behind the knob centre; never negative */
        width: max(0px, calc(var(--h) * -0.07 + var(--v) * (100% - var(--h) * 0.56)));
        background: url("/ui/slider/SliderKnobBar.png") left center / auto 100% repeat-x;
    }
    .rail {
        position: absolute;
        left: calc(var(--h) / 2);
        right: calc(var(--h) / 2);
        top: 0;
        bottom: 0;
        pointer-events: none;
    }
    .knob {
        position: absolute;
        top: 50%;
        left: calc(var(--v) * 100%);
        height: calc(var(--h) * 2.375); /* 76px knob on a 32px groove */
        width: calc(var(--h) * 2.375);
        transform: translate(-50%, -50%);
        pointer-events: none;
    }
</style>
