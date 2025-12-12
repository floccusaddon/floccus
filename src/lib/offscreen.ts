import browserApi from './browser-api'
export async function createOffscreen() {
  if (await browserApi.offscreen.hasDocument()) return

  await browserApi.offscreen.createDocument({
    url: '/dist/html/offscreen.html',
    reasons: ['WORKERS'],
    justification: 'In order to sync your bookmarks uninterrupted without displaying a visible window.'
  })
}

export async function destroyOffscreen() {
  if (!(await browserApi.offscreen.hasDocument())) return
  await browserApi.offscreen.closeDocument()
}