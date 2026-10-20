import "./global.css"
import App from "./App.svelte"

const app = new App({
    target: document.getElementById("app"),
})

// Remove the static boot screen from index.html once fonts are ready
// (or after a safety timeout); the app's own loading screen is already
// underneath it with the same look.
const removeBoot = () => document.getElementById("boot_loader")?.remove()
Promise.all([
    document.fonts.load("32px Pusab"),
    document.fonts.load("20px ChatFont"),
])
    .catch(() => {})
    .then(() => requestAnimationFrame(() => requestAnimationFrame(removeBoot)))
setTimeout(removeBoot, 4000)

export default app
