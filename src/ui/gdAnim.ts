// Compact Geometry Dash-style popup transitions: responsive without the large elastic bounce.
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

export function gdPopIn(node: Element, { duration = 240, from = 0.94 } = {}) {
    return {
        duration,
        easing: easeOut,
        css: (t: number) =>
            `opacity: ${Math.min(1, t * 3.5)}; transform: scale(${from + (1 - from) * t});`,
    }
}

export function gdPopOut(node: Element, { duration = 110, to = 0.97 } = {}) {
    return {
        duration,
        easing: (t: number) => t * t,
        css: (t: number) => `opacity: ${t}; transform: scale(${to + (1 - to) * t});`,
    }
}
