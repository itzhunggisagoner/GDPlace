<script lang="ts">
    export let size = 64
</script>

<img
    src="/ui/loadingCircle.png"
    alt="Loading"
    class="spinner"
    draggable="false"
    style:width="{size}px"
    style:height="{size}px"
/>

<style>
    .spinner {
        animation: spin 0.9s linear infinite;
        display: block;
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
