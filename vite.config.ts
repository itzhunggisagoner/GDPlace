import { defineConfig } from "vite"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import FullReload from "vite-plugin-full-reload"

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [svelte(), FullReload(["src/**/*"])],
    server: {
        port: 8080,
        // `npm run dev:api` (wrangler dev) runs on 8787
        proxy: { "/api": "http://localhost:8787" },
    },
})
