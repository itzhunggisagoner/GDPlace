<script lang="ts">
    import { appReady, appError, loadProgress } from "../editor/app"
    import Spinner from "./Spinner.svelte"
    import GDText from "./GDText.svelte"
</script>

{#if !$appReady}
    <div class="loading_screen">
        {#if $appError}
            <div class="loading_error">
                Could not initialise the map:<br />{$appError}
            </div>
        {:else}
            <Spinner size={72} />
            <div class="loading_text">
                <GDText font="gold" text={`Loading ${$loadProgress}%`} size={40} />
            </div>
        {/if}
    </div>
{/if}

<style>
    .loading_screen {
        position: fixed;
        inset: 0;
        z-index: 9000; /* above the editor, settings, login and admin UI */
        background: #000;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 14px;
        color: white;
        font-family: sans-serif;
        font-size: 20px;
        text-align: center;
        padding: 24px;
    }
    .loading_text {
        margin-top: 18px; /* move text down a bit (matches index.html boot screen) */
    }
    .loading_error {
        color: #ff6b6b;
        max-width: 90%;
        word-break: break-word;
    }
</style>
