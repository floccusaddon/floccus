const store = new Map()

export const Preferences = {
  async get({ key }) {
    return {
      value: store.has(key) ? store.get(key) : null,
    }
  },

  async set({ key, value }) {
    store.set(key, value)
  },

  async remove({ key }) {
    store.delete(key)
  },

  async clear() {
    store.clear()
  },
}
