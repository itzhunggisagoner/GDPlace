<script lang="ts">
    import { toast } from "../ui/notify"

    import { toastErrorTheme, toastSuccessTheme } from "../const"
    import {
        type UserData,
        signOut,
        signIn,
        currentUserData,
    } from "../backend/auth"
    import { getUsernameColors } from "../backend/database"
    import { toGradient } from "../editor/app"

    import GDText from "../ui/GDText.svelte"
    import GDButton from "../ui/GDButton.svelte"
    import Spinner from "../ui/Spinner.svelte"
    import FramePanel from "../ui/FramePanel.svelte"
    import "./auth.css"

    export let loadedUserData: UserData | null

    let loginPopupVisible = false
    let showLoader = false

    let usernameInput = ""
    let passwordInput = ""

    $: if (loadedUserData != null) loginPopupVisible = false

    async function submit() {
        if (!usernameInput.trim() || !passwordInput) return
        showLoader = true
        try {
            await signIn(usernameInput.trim(), passwordInput)
            passwordInput = ""
            toast.push("Signed in successfully!", toastSuccessTheme)
            loginPopupVisible = false
        } catch (err) {
            console.error(err)
            toast.push(
                `Failed to login! (${err?.message ?? "unknown error"})`,
                toastErrorTheme
            )
        } finally {
            showLoader = false
        }
    }

    function complement(colors) {
        // returns "black" or "white"
        const rbg = colors.map((color) => [
            (color >> 16) & 255,
            (color >> 8) & 255,
            color & 255,
        ])
        let [r, g, b] = rbg.reduce(
            (acc, cur) => [acc[0] + cur[0], acc[1] + cur[1], acc[2] + cur[2]],
            [0, 0, 0]
        )
        r = r / rbg.length
        g = g / rbg.length
        b = b / rbg.length
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b

        return luma > 255 / 2
            ? `1px rgb(${(r / 2 / 255) ** 1.5 * 255}, ${
                  (g / 2 / 255) ** 1.5 * 255
              }, ${(b / 2 / 255) ** 1.5 * 255})`
            : "1px black"
    }
</script>

<div
    class="all"
    style={loginPopupVisible
        ? "position: absolute; width: 100%; z-index: 50;"
        : ""}
>
    {#if loadedUserData == null && !loginPopupVisible}
        <button
            class="log_in_out_button wiggle_button invis_button pos_move"
            style:margin-right="calc(var(--corner-gap) * 2 + var(--corner-size))"
            on:click={() => {
                loginPopupVisible = true
            }}
        >
            <img
                class="alert_glow"
                draggable="false"
                src="/login/profile_in.png"
                alt="sign in button"
            />
        </button>
    {:else if !loginPopupVisible}
        <button
            class="log_in_out_button invis_button wiggle_button pos_move"
            style:margin-right="calc(var(--corner-gap) * 2 + var(--corner-size))"
            on:click={() => {
                if (confirm("Are you sure you want to sign out?")) {
                    signOut()
                        .then(() => {
                            toast.push(
                                "Successfully logged out!",
                                toastSuccessTheme
                            )
                        })
                        .catch((err) => {
                            console.error(err)
                            toast.push("Failed to log out!", toastErrorTheme)
                        })
                }
            }}
        >
            <img
                draggable="false"
                src="/login/profile_out.png"
                alt="logout button"
            />
        </button>
        {#await getUsernameColors($currentUserData?.data?.username) then colors}
            <div
                class="username_display pos_move {colors.length > 1
                    ? 'username_gradient'
                    : ''}"
                style="{colors.length == 1
                    ? `color: #${colors[0].toString(16)}`
                    : `background-image: ${toGradient(
                          colors
                      )}`};-webkit-text-stroke: {complement(colors)};"
            >
                {loadedUserData.data.username}
            </div>
        {/await}
    {/if}

    {#if loginPopupVisible}
        <div class="login_popup_container">
            {#if loadedUserData == null}
                <button
                    class="back_button invis_button wiggle_button"
                    aria-label="Close"
                    on:click={async () => {
                        loginPopupVisible = false
                    }}
                >
                    <img
                        draggable="false"
                        src="/ui/Close.png"
                        alt="close"
                    />
                </button>
            {/if}

            <FramePanel width="min(600px, 94%)" height="min(800px, 94%)">
                {#if showLoader}
                    <div class="loading_container blur_bg">
                        <Spinner size={72} />
                    </div>
                {/if}
                <div class="login_swiper_slide" style="width: 100%; height: 100%;">
                    <div class="login_popup">
                        <div class="login_popup_title">
                            <GDText font="gold" text="Sign in" size={44} />
                        </div>
                        <div class="login_popup_text">
                            <GDText
                                font="chat"
                                align="center"
                                size={20}
                                maxWidth={380}
                                text="Log in with your Geometry Dash account to start building. Your password is only forwarded to the Geometry Dash servers to check it - it is never stored."
                            />
                        </div>

                        <form
                            class="email_password_login"
                            on:submit|preventDefault={submit}
                        >
                            <div class="email_password_header">
                                <GDText font="chat" text="GD username" size={24} />
                            </div>
                            <input
                                class="email_password_input"
                                type="text"
                                placeholder="Username"
                                maxlength="20"
                                autocomplete="username"
                                bind:value={usernameInput}
                            />
                            <div class="email_password_header">
                                <GDText font="chat" text="GD password" size={24} />
                            </div>
                            <input
                                class="email_password_input"
                                type="password"
                                placeholder="Password"
                                maxlength="40"
                                autocomplete="current-password"
                                bind:value={passwordInput}
                            />
                            <div class="login_register">
                                <GDButton
                                    label="Log in"
                                    color="green"
                                    type="submit"
                                    disabled={showLoader}
                                />
                            </div>
                        </form>
                    </div>
                </div>
            </FramePanel>
        </div>
    {/if}
</div>

<style>
    .all {
        height: 100vh;
        height: 100dvh;
        display: flex;
        justify-content: flex-end;
        align-items: flex-start;
        /* username / log out buttons: above the editor (<= 20) but BELOW the Settings and
           Admin panels (40+). The login popup raises itself to 50 via the inline style. */
        z-index: 30;
        pointer-events: none;
    }

    /* phone layout (same query as mobileScreenQuery in Editor.svelte): the username / log out
       area must sit BEHIND the editor UI (10-20), but stay above the canvas. The login popup
       still raises itself to 50 through the inline style. */
    @media (max-height: 600px), (orientation: portrait) {
        .all {
            z-index: 5;
        }
    }

    .all * {
        pointer-events: auto;
    }

    .back_button {
        position: absolute;
        top: 10px;
        left: 10px;
        width: 62px;
        height: 64px;
        color: white;
        border-radius: 8px;
        font-family: Cabin;
        font-size: 16px;
        cursor: pointer;
        transition: all 0.1s;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10; /* above the frame (its sidebars sit at z-index 1) */
    }

    .back_button > img {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }

    .login_popup_container {
        position: relative;
        width: 100%;
        height: 100%;
        background-color: #0009;
        backdrop-filter: blur(32px);
        -webkit-backdrop-filter: blur(32px);
        display: flex;
        justify-content: center;
        align-items: center;
    }


    .log_in_out_button {
        margin-top: var(--corner-gap);
        padding: 0;
        line-height: 0;
    }

    .log_in_out_button > img {
        display: block;
        width: var(--corner-size);
        height: var(--corner-size);
        object-fit: contain;
    }

    .login_popup {
        position: absolute;
        width: min(600px, 90%);
        height: min(800px, 90%);
        border-radius: 16px;
        display: flex;
        flex-direction: column;

        align-items: center;
        overflow-y: auto;
    }

    .email_password_login {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        height: fit-content;
        justify-content: center;
    }

    .login_register {
        display: flex;
        flex-direction: row;
        align-items: center;
        margin-top: 0px;
        width: 100%;
        height: 100%;
        justify-content: center;
        margin: 10px;
        column-gap: 10px;
    }

    .email_password_login_button {
        width: 60%;
        border-radius: 8px;
        background-color: #0b0b0e;
        border: 2px solid #bbbbbb;
        color: white;
        font-family: Cabin;
        font-size: 16px;
        cursor: pointer;
        transition: all 0.1s;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 15px;
        transition: 1s;
    }
    .email_password_login_button:hover {
        box-shadow: rgba(76, 255, 40, 0.185) 0px 0px 5px 5px;
        transition: 0.2s;
    }
    .email_password_input {
        border-radius: 8px;
        background-color: #00000000;
        border: 2px solid #bbbbbb;
        color: white;
        font-family: Helvetica, sans-serif;
        font-size: 16px;
        cursor: pointer;
        transition: all 0.1s;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 15px;
        margin: 5px;
        width: 60%;
    }

    .login_popup_title {
        font-family: "Cabin", sans-serif;
        font-size: var(--font-large);
        color: white;
        margin-bottom: 32px;
        margin-top: 16px;
        text-align: center;
    }

    .email_password_header {
        font-family: "Cabin", sans-serif;
        font-size: var(--font-medium);
        color: rgba(255, 255, 255, 0.75);
        margin-bottom: 24px;
        margin-top: 24px;
        text-align: center;
    }

    .login_popup_text {
        font-family: "Cabin", sans-serif;
        font-size: 16px;
        width: 80%;
        color: rgba(255, 255, 255, 0.5);
        margin-bottom: 12px;
        text-align: center;
        float: top;
    }

    .login_popup_icons {
        width: 100%;
        height: fit-content;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        padding: 8px;
        gap: 20px;
        margin-top: 5vh;
    }

    .login_method_button > * {
        width: 60px;
        height: 60px;
        object-fit: contain;
    }
    .login_method_button {
        background-color: transparent;
        border-radius: 8px;
        transition: all 0.1s;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        text-align: center;
        color: white;
        font-family: Cabin;
        font-size: 16px;
        gap: 16px;
        padding: 5px;
    }
    .login_method_button:enabled {
        cursor: pointer;
    }
    .login_method_button:enabled:hover {
        background-color: #fff2;
    }
    .login_method_button:disabled {
        opacity: 0.25;
    }

    .username_form {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        text-align: center;
        justify-content: center;
        align-items: center;
        font-family: Pusab;
        font-size: 32px;
        color: white;
        gap: 16px;
    }
    .username_input {
        width: 300px;
        height: 60px;
        outline: none;
        border: 2px solid white;
        background-color: #1113;
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-radius: 8px;
        font-family: Pusab;
        font-size: 24px;
        color: white;
        text-align: center;
    }

    .pos_move {
        transition: padding-righ margin-right ease-in-out 0.3s;
    }

    /* the name sits right under the profile / settings buttons, never over the music button */
    .username_display {
        position: absolute;
        top: calc(var(--corner-gap) + var(--corner-size) + 4px);
        right: var(--corner-gap);
        max-width: calc(100vw - var(--corner-gap) * 2);
        padding: 2px 4px;
        display: block;
        line-height: 1.1;
        font-family: Pusab;
        font-size: clamp(14px, calc(var(--font-medium) * 0.75), 24px);
        text-align: right;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        -webkit-filter: drop-shadow(1px 1px 3px rgba(0, 0, 0, 0.6));
        filter: drop-shadow(1px 1px 3px rgba(0, 0, 0, 0.6));
    }

    .username_gradient {
        -webkit-text-fill-color: rgba(255, 255, 255, 0.1) !important;
        background-clip: text !important;
        -webkit-background-clip: text !important;
    }

    .loading_container {
        font-family: Cabin;
        color: white;
        position: absolute;
        width: 100%;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        flex-direction: column;
        gap: 20px;
        z-index: 10;
        border-radius: 16px;
        font-style: italic;
    }

    .loading {
        width: 50%;
    }

    .loading_icon {
        -webkit-mask-image: linear-gradient(
            90deg,
            #00000000 15%,
            #fff 50%,
            #00000000 80%
        );
        mask-image: linear-gradient(
            90deg,
            #00000000 15%,
            #fff 50%,
            #00000000 80%
        );
    }

    .blur_bg {
        background-color: #01010199;
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
    }

    .alert_glow {
        animation: scale 4s ease-in-out forwards infinite;
    }

    @keyframes scale {
        0% {
            transform: scale(1);
        }
        50% {
            transform: scale(1.2);
        }
        100% {
            transform: scale(1);
        }
    }
</style>
