const GistClient = require('gist-client')
const gistClient = new GistClient()

const GIST_ID = '51b4015641802f4f275574ca98beed61'

gistClient.setToken(process.env['GIST_TOKEN'])

async function save(sha, label, data) {
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
save('foobar', 'blabla', { test: 2 })
