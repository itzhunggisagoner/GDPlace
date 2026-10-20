<script lang="ts">
    import { createEventDispatcher } from "svelte"
    import GDText from "./GDText.svelte"
    export let checked = false
    export let label = ""
    export let size = 22
    const dispatch = createEventDispatcher()
</script>

<button
    type="button"
    role="checkbox"
    aria-checked={checked}
    class="gdcheck invis_button"
    on:click={() => dispatch("toggle", !checked)}
>
    <img
        class="box"
        draggable="false"
        alt=""
        src={checked ? "/ui/CheckboxON.png" : "/ui/CheckboxOFF.png"}
    />
    {#if label}
        <GDText font="chat" text={label} {size} maxWidth={420} />
    {/if}
</button>

<style>
    .gdcheck {
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        text-align: left;
        padding: 4px 0;
    }
    .box {
        width: 38px;
        height: 38px;
        object-fit: contain;
        flex: none;
    }
</style>
