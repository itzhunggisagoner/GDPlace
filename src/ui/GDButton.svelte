<script lang="ts">
    import GDText from "./GDText.svelte"
    // green = normal action, purple = optional / secondary, red = dangerous action (ban, clear, log out)
    // "blue" is an alias of purple. Art = the real /ui/GreenButton.png, PurpleButton.png, RedButton.png cut into
    // left end / middle / right end (public/ui/btn). The ends keep their rounded shape, only the middle
    // stretches, and the parts overlap by 1px, so there is no squashed corner and no grid line.
    // The button is only as wide as its text: `width` is accepted for old callers but ignored.
    export let color: "green" | "purple" | "red" | "blue" = "green"
    export let label = ""
    export let disabled = false
    export let type: "button" | "submit" = "button"
    export let width: number | null = null
    export let textSize = 26

    $: k = color === "red" ? "red" : color === "green" ? "green" : "purple"
</script>

<button
    {type}
    {disabled}
    class="gdbtn wiggle_button invis_button"
    data-ignored-width={width}
    style:--l={`url(/ui/btn/${k}_l.png)`}
    style:--m={`url(/ui/btn/${k}_m.png)`}
    style:--r={`url(/ui/btn/${k}_r.png)`}
    on:click
>
    <span class="label"><GDText font="gold" text={label} size={textSize} align="center" /></span>
</button>

<style>
    .gdbtn {
        --h: 50px;
        --cap: calc(var(--h) * 0.35); /* the end pieces are 28 of the 80px sprite */
        position: relative;
        box-sizing: border-box;
        display: inline-flex;
        justify-content: center;
        align-items: center;
        width: fit-content;
        height: var(--h);
        min-width: 0;
        max-width: 100%;
        padding: 0 calc(var(--cap) * 0.9);
        border: 0;
        background-color: transparent;
        background-image: var(--l), var(--r), var(--m);
        background-repeat: no-repeat;
        background-position: left center, right center, center;
        background-size:
            auto 100%,
            auto 100%,
            calc(100% - var(--cap) * 2 + 2px) 100%;
        overflow: visible;
    }
    .label {
        position: relative;
        padding-top: 3px; /* Pusab sits ~2.5px high in its line box */
        white-space: nowrap;
    }
    .label :global(.gdtext) {
        white-space: nowrap;
    }
    .gdbtn:disabled {
        filter: grayscale(1) brightness(0.7);
    }
</style>
