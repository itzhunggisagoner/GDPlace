<script lang="ts">
    // gold = title text: Pusab with a yellow -> orange gradient and a black outline
    // chat = regular text: chatFont.otf
    export let text = ""
    export let font: "gold" | "chat" = "chat"
    export let size = 22 // roughly the line height, px
    export let maxWidth: number | null = null
    export let color: string | null = null // only applies to chat
    export let align: "left" | "center" | "right" = "left"

    $: str = String(text ?? "")
    // maxWidth is a cap, never a fixed size: on narrow screens the text must wrap inside its container
    $: cap = maxWidth ? `min(${maxWidth}px, 100%)` : "100%"
    $: width = maxWidth && align !== "left" ? cap : "fit-content"
</script>

{#if font === "gold"}
    <span
        class="gdtext gold"
        data-text={str}
        style:font-size="{size * 0.8}px"
        style:width
        style:max-width={cap}
        style:text-align={align}><span class="fill">{str}</span></span
    >
{:else}
    <span
        class="gdtext chat"
        style:font-size="{size * 0.85}px"
        style:width
        style:max-width={cap}
        style:text-align={align}
        style:color={color || "#fff"}>{str}</span
    >
{/if}

<style>
    .gdtext {
        display: block;
        pointer-events: none;
        white-space: pre-wrap;
        overflow-wrap: break-word;
        line-height: 1.15;
    }

    /* ---------- gold ---------- */
    .gold {
        position: relative;
        font-family: Pusab, Cabin, sans-serif;
    }
    /* black outline layer behind the gradient fill */
    .gold::before {
        content: attr(data-text);
        position: absolute;
        inset: 0;
        color: #000;
        -webkit-text-stroke: 0.2em #000;
        text-shadow: 0 0.07em 0 rgba(0, 0, 0, 0.55);
        text-align: inherit;
    }
    .fill {
        position: relative;
        display: inline;
        /* extend the gradient box past the font's line box so the black
           outline layer never shows through the top/bottom of the glyphs */
        padding: 0.3em 0.12em;
        margin: -0.3em -0.12em;
        /* the padding above extends the box past the glyphs, so the colour is held flat over the
           padding and the real top -> bottom gradient runs across the original text box */
        background-image: linear-gradient(
            180deg,
            var(--gd-gold-top) 0,
            var(--gd-gold-top) 0.3em,
            var(--gd-gold-bottom) calc(100% - 0.3em),
            var(--gd-gold-bottom) 100%
        );
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        color: transparent;
        -webkit-box-decoration-break: clone;
        box-decoration-break: clone;
    }

    /* ---------- chat ---------- */
    .chat {
        font-family: ChatFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
        line-height: 1.2;
        text-shadow: 0 0 2px #000, 0 1px 2px #000, 0 0 4px rgba(0, 0, 0, 0.6);
    }
</style>
