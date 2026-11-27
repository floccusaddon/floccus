import { spawn } from 'child_process'
import fs from 'fs/promises'
import { createServer } from 'http'
import os from 'os'
import path from 'path'

function runGit(args, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: { ...process.env, ...env },
    })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString())
      } else {
        reject(new Error(
          `git ${args.join(' ')} exited with ${code}: ` +
          Buffer.concat(stderr).toString()
        ))
      }
    })
    child.stdin.end()
  })
}

function cgiEnvironment(req, body, root, port) {
  const url = new URL(req.url, 'http://localhost')
  const env = {
    ...process.env,
    GIT_PROJECT_ROOT: root,
    GIT_HTTP_EXPORT_ALL: '1',
    PATH_INFO: decodeURIComponent(url.pathname),
    QUERY_STRING: url.search.replace(/^\?/, ''),
    REQUEST_METHOD: req.method,
    CONTENT_TYPE: req.headers['content-type'] || '',
    CONTENT_LENGTH: String(body.length),
    REMOTE_ADDR: req.socket.remoteAddress || '127.0.0.1',
    // receive-pack is enabled for authenticated users by default; a name here
    // plus http.receivepack in the repo keeps the harness free of auth prompts.
    REMOTE_USER: 'floccus',
    SERVER_PROTOCOL: 'HTTP/1.1',
    SERVER_NAME: '127.0.0.1',
    SERVER_PORT: String(port),
    GATEWAY_INTERFACE: 'CGI/1.1',
  }
  for (const [key, value] of Object.entries(req.headers)) {
    const envKey = 'HTTP_' + key.toUpperCase().replace(/-/g, '_')
    if (envKey === 'HTTP_CONTENT_TYPE' || envKey === 'HTTP_CONTENT_LENGTH') {
      continue
    }
    env[envKey] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return env
}

function runHttpBackend(env, body) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['http-backend'], { env })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(
          `git http-backend exited with ${code}: ` +
          Buffer.concat(stderr).toString()
        ))
        return
      }
      resolve(Buffer.concat(stdout))
    })
    child.stdin.end(body)
  })
}

function parseCgiResponse(raw) {
  let separator = raw.indexOf('\r\n\r\n')
  let separatorLength = 4
  if (separator === -1) {
    separator = raw.indexOf('\n\n')
    separatorLength = 2
  }
  if (separator === -1) {
    return { status: 200, headers: {}, body: raw }
  }
  const headerText = raw.slice(0, separator).toString()
  const body = raw.slice(separator + separatorLength)
  let status = 200
  const headers = {}
  for (const line of headerText.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon === -1) {
      continue
    }
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    if (key.toLowerCase() === 'status') {
      status = parseInt(value, 10) || 200
    } else {
      headers[key] = value
    }
  }
  return { status, headers, body }
}

/**
 * A local smart-HTTP Git server for the node test suite.
 *
 * isomorphic-git cannot push to a `file://` remote, so this serves a bare
 * repository through `git http-backend` (CGI): upload-pack and receive-pack
 * both go through the ordinary smart-HTTP protocol, with no external service
 * and nothing on the network beyond 127.0.0.1.
 *
 * Returns the repository URL plus `git(args)` for assertions and `close()`.
 */
export async function createGitHttpServer(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'floccus-git-http-'))
  const repoName = options.repoName || 'test.git'
  const repoPath = path.join(root, repoName)
  await fs.mkdir(repoPath, { recursive: true })
  await runGit(['init', '--bare', '--quiet', repoPath])
  await runGit(['-C', repoPath, 'config', 'http.receivepack', 'true'])
  // A bare repo starts with HEAD on master; clone/fetch of the branch the
  // adapter uses has to find a HEAD that points at it.
  await runGit(['-C', repoPath, 'symbolic-ref', 'HEAD', 'refs/heads/main'])

  // Test seam: called with the request just before it reaches http-backend,
  // so a test can move a ref between two requests (a push race).
  let beforeRequest = null

  const handle = async(req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }
    const chunks = []
    for await (const chunk of req) {
      chunks.push(chunk)
    }
    const body = Buffer.concat(chunks)
    const { port } = server.address()
    try {
      if (beforeRequest) {
        await beforeRequest(req)
      }
      const raw = await runHttpBackend(cgiEnvironment(req, body, root, port), body)
      const { status, headers, body: responseBody } = parseCgiResponse(raw)
      res.writeHead(status, headers)
      res.end(responseBody)
    } catch (e) {
      res.statusCode = 500
      res.end(String(e))
    }
  }

  const server = createServer(handle)
  server.on('checkContinue', (req, res) => {
    res.writeContinue()
    handle(req, res)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()

  return {
    root,
    repoPath,
    url: `http://127.0.0.1:${port}/${repoName}`,
    git: (args, env) => runGit(['-C', repoPath, ...args], { env }),
    /** Run git anywhere, for tests that build a history in a work tree */
    run: runGit,
    get beforeRequest() {
      return beforeRequest
    },
    set beforeRequest(fn) {
      beforeRequest = fn
    },
    close: async() => {
      await new Promise((resolve) => server.close(resolve))
      await fs.rm(root, { recursive: true, force: true })
    },
  }
}
