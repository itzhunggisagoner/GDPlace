<script lang="ts">
    import { fade } from "svelte/transition"
    import { notices, toast } from "./notify"
    import { gdPopIn, gdPopOut } from "./gdAnim"
    import GDText from "./GDText.svelte"
    import GDButton from "./GDButton.svelte"

    $: current = $notices[0]

    const close = () => {
        if (current) toast.pop(current.id)
    }
</script>

<svelte:window
    on:keydown={(e) => {
        if (current && (e.key === "Enter" || e.key === "Escape")) {
            e.preventDefault()
            close()
        }
    }}
/>

{#if current}
    {#key current.id}
        <div class="backdrop" transition:fade={{ duration: 160 }}>
            <!-- Use the provided square01_001-hd Geometry Dash notification frame -->
            <div
                class="notif {current.kind}"
                role="alertdialog"
                in:gdPopIn
                out:gdPopOut
            >
                <GDText font="gold" text={current.title} size={36} />
                <GDText
                    font="chat"
                    text={current.msg}
                    size={24}
                    maxWidth={520}
                    align="center"
                />
                <GDButton label="OK" color="green" textSize={30} on:click={close} />
            </div>
        </div>
    {/key}
{/if}

<style>
    .backdrop {
        position: fixed;
        inset: 0;
        z-index: 9500; /* above everything, including the loading screen */
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 20px;
        background: rgba(0, 0, 0, 0.55);
    }
    /* Geometry Dash dialog: the frame is 9-sliced (corners keep their size) and wraps its content. */
    .notif {
        position: relative;
        box-sizing: border-box;
        width: fit-content;
        min-width: min(330px, 88vw);
        max-width: min(640px, 94vw);
        max-height: 92dvh;
        border-style: solid;
        border-width: 34px;
        border-image: url("/gd/ui/square01_001-clean.png") 60 fill / 34px stretch;
        /* flat navy under the slices hides hairline seams */
        background: linear-gradient(#002446, #002446) no-repeat center / calc(100% - 40px) calc(100% - 40px);
        padding: 0 14px 6px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        text-align: center;
        isolation: isolate;
    }
    .notif :global(.gdtext) {
        position: relative;
        z-index: 1;
    }
    .notif :global(.gdbtn) {
        flex: 0 0 auto;
        z-index: 1;
    }
</style>
