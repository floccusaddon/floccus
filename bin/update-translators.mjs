#!/usr/bin/env node
// Fetches the members of the floccus Transifex teams and writes them, grouped
// by language, to translators.json, which the About view displays.
// Usage: TX_TOKEN=<transifex api token> node bin/update-translators.mjs

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const ORGANIZATION = 'o:floccus'
const OUTPUT = fileURLToPath(new URL('../translators.json', import.meta.url))

const token = process.env.TX_TOKEN
if (!token) {
  console.error('Please set TX_TOKEN to a Transifex API token')
  process.exit(1)
}

async function fetchAll(url) {
  const items = []
  while (url) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.api+json',
      },
    })
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} for ${url}: ${await res.text()}`)
    }
    const json = await res.json()
    items.push(...json.data)
    url = json.links && json.links.next
  }
  return items
}

const memberships = await fetchAll(
  'https://rest.api.transifex.com/team_memberships?filter[organization]=' + encodeURIComponent(ORGANIZATION)
)

const byLanguage = {}
for (const membership of memberships) {
  const language = membership.relationships.language.data.id.replace(/^l:/, '')
  const user = membership.relationships.user.data.id.replace(/^u:/, '')
  byLanguage[language] = byLanguage[language] || new Set()
  byLanguage[language].add(user)
}

const translators = Object.keys(byLanguage)
  .sort()
  .map(language => ({
    language,
    users: [...byLanguage[language]].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
  }))

await writeFile(OUTPUT, JSON.stringify(translators, null, 2) + '\n')
console.log(`Wrote ${translators.length} languages, ${memberships.length} memberships to ${OUTPUT}`)
