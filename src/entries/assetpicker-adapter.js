import browser from '../lib/browser-api'

window.AssetPickerAdapterFloccus = {
  events: {
    'load-items': async function(tree) {
      var resp
      if (tree.item) {
        resp = await browser.bookmarks.getSubTree(tree.item.id)
      } else {
        resp = await browser.bookmarks.getTree()
      }
      if (!resp || !resp[0]) return
      resp[0].children
      .forEach((node) => {
        this.createItem({
          id: node.id
        , name: node.title
        , type: node.url? 'file' : 'dir'
        })
      })
    }
  }
}
