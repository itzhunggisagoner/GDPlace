<!-- GD-style frame (Topbar / left & right Sidebar / Bottombar) wrapping the Settings and Login UI.
     The middle area is black; `dim` is its opacity (0-1). -->
<script lang="ts">
    import { gdPopIn, gdPopOut } from "./gdAnim"
    export let width = "auto"
    export let height = "auto"
    export let dim = 0.4
</script>

<div class="fp" style:width style:height in:gdPopIn out:gdPopOut>
    <div class="top" />
    <div class="row">
        <div class="side l" />
        <div class="content" style:background="rgba(0, 0, 0, {dim})">
            <slot />
        </div>
        <div class="side r" />
    </div>
    <div class="bottom">
        <div class="p capl" />
        <div class="p gl" />
        <div class="p mid" />
        <div class="p gr" />
        <div class="p capr" />
    </div>
</div>

<style>
    .fp {
        display: flex;
        flex-direction: column;
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
        isolation: isolate; /* the sidebars' z-index stays inside the frame and can't cover outside buttons */
        zoom: var(--ui-zoom, 1); /* smaller on phones, see global.css */
        /* zoom also scales lengths, so divide to keep the panel inside the screen */
        max-height: calc((100vh - 16px) / var(--ui-zoom, 1));
        max-height: calc((100dvh - 16px) / var(--ui-zoom, 1)); /* mobile: ignore the browser's address/nav bars */
        position: relative;
    }
    .top {
        flex: none;
        height: 54px;
        box-sizing: border-box;
        border-style: solid;
        border-width: 0 30px;
        border-image: url("/ui/Topbar.png") 0 60 fill / 0 30px stretch;
    }
    .row {
        flex: 1;
        min-height: 0;
        display: flex;
        margin-top: -12px;
        margin-bottom: -10px;
    }
    .side {
        position: relative;
        z-index: 1; /* above the black area, which bleeds underneath it */
        flex: none;
        width: 30px;
        background: url("/ui/Sidebar.png") repeat-y left top / 30px 64px;
    }
    .side.r {
        transform: scaleX(-1);
    }
    .content {
        flex: 1;
        min-width: 0;
        position: relative;
        /* the sidebar art is transparent on its inner half, so stretch the black area 8px
           underneath each sidebar (no gap) and pad the real content back in */
        margin: 0 -8px;
        padding: 0 8px;
        overflow-y: auto;
        overflow-x: hidden; /* never scroll/cut sideways */
        -webkit-overflow-scrolling: touch;
        color: white;
    }
    .content :global(*) {
        max-width: 100%;
    }
    .bottom {
        flex: none;
        height: 51px;
        display: flex;
    }
    .p {
        height: 100%;
        background-repeat: no-repeat;
        background-size: 100% 100%;
    }
    .capl {
        width: 28px;
        background-image: url("/ui/bb_capl.png");
    }
    .gl {
        flex: 1;
        background-image: url("/ui/bb_gl.png");
    }
    .mid {
        width: 51px;
        background-image: url("/ui/bb_mid.png");
    }
    .gr {
        flex: 1;
        background-image: url("/ui/bb_gr.png");
    }
    .capr {
        width: 28px;
        background-image: url("/ui/bb_capr.png");
    }
</style>
