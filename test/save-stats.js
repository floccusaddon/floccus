const GistClient = require('gist-client')
const gistClient = new GistClient()

const GIST_ID = '51b4015641802f4f275574ca98beed61'

async function save(sha, label, data) {
  if (!process.env.GIST_TOKEN) return
  gistClient.setToken(process.env['GIST_TOKEN'])
  const gist = await gistClient.getOneById(GIST_ID)
  const db = JSON.parse(gist.files['index.json'].content)
  if (!db[sha]) {
    db[sha] = {}
  }
  db[sha][label] = data
  await gistClient.update(GIST_ID, {
    files: { 'index.json': { content: JSON.stringify(db) } }
  })
}

module.exports = save
