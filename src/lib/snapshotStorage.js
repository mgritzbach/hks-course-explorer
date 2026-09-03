// IndexedDB holds the last verified response without Web Storage's small quota.
// Failure to persist is non-fatal; the bundled release copy remains available.
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('hks-public-catalogue-v1', 1)
    const timer = setTimeout(() => reject(new Error('Catalogue storage timed out')), 2000)
    request.onupgradeneeded = () => request.result.createObjectStore('datasets')
    request.onsuccess = () => {
      clearTimeout(timer)
      resolve(request.result)
    }
    request.onerror = () => {
      clearTimeout(timer)
      reject(request.error)
    }
    request.onblocked = () => {
      clearTimeout(timer)
      reject(new Error('Catalogue storage blocked'))
    }
  })
}

export async function readSnapshot(key) {
  let db
  try {
    db = await database()
    return await new Promise((resolve, reject) => {
      const request = db.transaction('datasets').objectStore('datasets').get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } catch {
    return null
  } finally {
    db?.close()
  }
}

export async function writeSnapshot(key, value) {
  let db
  try {
    db = await database()
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('datasets', 'readwrite')
      transaction.objectStore('datasets').put(value, key)
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } catch {
    // A full disk or private browser must not prevent online catalogue access.
  } finally {
    db?.close()
  }
}
