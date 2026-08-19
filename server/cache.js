const store = new Map();
const inflight = new Map();

export function cached(key, ttlMs, fetcher, staleMs = ttlMs * 4) {
  const hit = store.get(key);
  const now = Date.now();

  if (hit && hit.expires > now) {
    return Promise.resolve(hit.value);
  }

  if (hit && hit.staleUntil > now) {
    if (!inflight.has(key)) {
      const refresh = fetcher()
        .then((value) => {
          store.set(key, {
            value,
            expires: now + ttlMs,
            staleUntil: now + ttlMs + staleMs,
          });
          return value;
        })
        .catch(() => hit.value)
        .finally(() => {
          inflight.delete(key);
        });
      inflight.set(key, refresh);
    }
    return Promise.resolve(hit.value);
  }

  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const promise = fetcher()
    .then((value) => {
      store.set(key, {
        value,
        expires: now + ttlMs,
        staleUntil: now + ttlMs + staleMs,
      });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export function clearAll() {
  store.clear();
  inflight.clear();
}
