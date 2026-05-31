import fs from 'fs/promises'
import os from 'os'
import path from 'path'

export const Directory = {
  External: 'External',
}

export const Encoding = {
  UTF8: 'utf8',
}

export const Filesystem = {
  async writeFile({ path: filePath, data, encoding = Encoding.UTF8 }) {
    const outputPath = path.join(os.tmpdir(), 'floccus-node-tests', filePath)
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, data, encoding)
    return { uri: outputPath }
  },
}
