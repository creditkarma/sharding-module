export function arbitraryInteger(max: number = Math.pow(2, 32)): number {
    return Math.floor(Math.random() * max)
}
