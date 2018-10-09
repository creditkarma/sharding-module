export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

export function retry<T>(operation: () => Promise<T>): Promise<T> {
    // This is a very liberal retry policy (retry every half second for 30
    // seconds), mostly to allow integration tests to wait while the DB
    // container starts up. You should probably not do this in production!
    const retryDelay = 500
    const maxTries = 60
    let promise = operation()
    for (let numTries = 0; numTries < maxTries; numTries++) {
        promise = promise.catch(() => delay(retryDelay).then(operation))
    }
    return promise
}
