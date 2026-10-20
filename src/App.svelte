<script lang="ts">
    import Auth from "./auth/Auth.svelte"
    import Settings from "./settings/Settings.svelte"
    import Editor from "./editor/Editor.svelte"
    import Admin from "./admin/Admin.svelte"
    import LoadingScreen from "./ui/LoadingScreen.svelte"
    import NotificationHost from "./ui/NotificationHost.svelte"
    import { currentUserData } from "./backend/auth"
</script>

<Editor />
<div class="auth_settings">
    <Settings />
    <Auth loadedUserData={$currentUserData} />
</div>
<Admin />
<LoadingScreen />
<NotificationHost />

<style>
    .auth_settings {
        width: 100%;
        height: 100vh;
        height: 100dvh;
        display: flex;
        justify-content: flex-end;
        position: absolute;
        top: 0;
        right: 0;
        pointer-events: none;
    }
</style>
