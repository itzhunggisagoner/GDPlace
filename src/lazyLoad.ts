const options = {
    root: null,
    rootMargin: "0px",
    threshold: 0,
}

// Loads the image once it scrolls into view. Supports `update` so that when Svelte
// re-uses the same <img> for another object (category change / search), the new
// image is loaded instead of keeping the old one.
export const lazyLoad = (image: HTMLImageElement, src: string) => {
    let current = src
    let visible = false

    image.style.backgroundColor = "#00000044"
    image.style.transition = "0.1s"
    image.style.borderRadius = "5px"

    const loaded = () => {
        image.style.backgroundColor = ""
        image.style.borderRadius = ""
    }
    const apply = () => {
        if (!visible) return
        if (image.getAttribute("src") === current) return
        image.removeEventListener("load", loaded)
        image.src = current
        if (image.complete) loaded()
        else image.addEventListener("load", loaded, { once: true })
    }
    const observer = new IntersectionObserver((entries) => {
        visible = entries[entries.length - 1].isIntersecting
        apply()
    }, options)
    observer.observe(image)

    return {
        update(newSrc: string) {
            if (newSrc === current) return
            current = newSrc
            image.style.backgroundColor = "#00000044"
            apply()
        },
        destroy() {
            observer.disconnect()
            image.removeEventListener("load", loaded)
        },
    }
}
