<script lang="ts">
    import {
        settings,
        saveSettings,
        settings_writable,
        musicVolume,
    } from "./settings"
    import GDSlider from "../ui/GDSlider.svelte"
    import GDText from "../ui/GDText.svelte"
    import GDCheckbox from "../ui/GDCheckbox.svelte"
    import GDButton from "../ui/GDButton.svelte"
    import FramePanel from "../ui/FramePanel.svelte"

    let settingsOpen = false

    const toggle = (key: string, value: boolean, event: Event) => {
        settings[key].enabled = value
        settings_writable.update((s) => s)
        saveSettings()
        settings[key].cb && settings[key].cb(event)
    }
</script>

<svelte:window
    on:keydown={(e) => {
        if (e.key === "Escape") settingsOpen = false
    }}
/>

<div class="all">
    <button
        class="settings_button invis_button wiggle_button"
        aria-label="Settings"
        on:click={() => (settingsOpen = true)}
    >
        <img
            draggable="false"
            src="/gd/editor/GJ_optionsBtn_001.png"
            alt="settings button"
        />
    </button>

    {#if settingsOpen}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div
            class="overlay"
            on:click|self={() => (settingsOpen = false)}
        >
            <FramePanel width="min(1000px, 100%)" dim={0.7}>
            <div class="settings_panel">
                <div class="title">
                    <GDText font="gold" text="Settings" size={38} />
                </div>

                <div class="options">
                    {#each Object.keys(settings) as key}
                        <GDCheckbox
                            label={settings[key].label.trim()}
                            checked={$settings_writable[key].enabled}
                            on:toggle={(e) => toggle(key, e.detail, e)}
                        />
                    {/each}
                </div>

                <div class="custom_colors">
                    <GDText font="gold" text="Music volume" size={28} />
                    <div class="slider_row">
                        <GDSlider
                            value={$musicVolume}
                            on:input={(e) => ($musicVolume = Math.round(e.detail * 100) / 100)}
                        />
                    </div>
                </div>

                <div class="close">
                    <GDButton
                        label="Close"
                        color="green"
                        width={160}
                        on:click={() => (settingsOpen = false)}
                    />
                </div>
            </div>
            </FramePanel>
        </div>
    {/if}
</div>

<style>
    .all {
        position: absolute;
        width: 100%;
        height: 100vh;
        height: 100dvh;
        pointer-events: none;
        z-index: 40;
    }
    .all * {
        pointer-events: auto;
    }

    .settings_button {
        position: absolute;
        top: 0;
        right: 0;
        margin-top: var(--corner-gap);
        margin-right: var(--corner-gap);
        padding: 0;
        line-height: 0;
    }
    .settings_button > img {
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

    .settings_panel {
        width: 100%;
        padding: 4px 0 8px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
    }
    .title {
        padding-top: 4px;
    }
    .options {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        padding: 0 8px;
    }
    .custom_colors {
        width: 100%;
        padding: 0 8px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
    }
    .slider_row {
        width: min(440px, 100%);
        padding: 0 28px 0 0;
        box-sizing: border-box;
    }
    .tag_row {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: center;
    }
    .username_display {
        font-family: Pusab, Cabin, sans-serif;
        font-size: 24px;
        height: fit-content;
        padding: 4px 8px;
    }
    .username_gradient {
        -webkit-text-fill-color: transparent !important;
        background-clip: text !important;
        -webkit-background-clip: text !important;
    }
    .close {
        padding-bottom: 4px;
    }
</style>
