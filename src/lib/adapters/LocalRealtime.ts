import CachingAdapter from './Caching'
import Logger from '../Logger'
import { Folder, TItemLocation } from '../Tree'
import {
  AuthenticationError,
  HttpError,
  NetworkError,
  RealtimeConflictError,
  ResourceLockedError
} from '../../errors/Error'

export default class LocalRealtimeAdapter extends CachingAdapter {
  private abortController: AbortController|null
  private leaseId: string|null
  private transactionId: string|null
  private baseVersion: number
  private leaseRenewTimer: ReturnType<typeof setInterval>|null
  private leaseRenewError: Error|null
  private recoveredState: { expectedCache:any, expectedMappings:any }|null

  constructor(server) {
    super(server)
    this.server = server
    this.abortController = null
    this.leaseId = null
    this.transactionId = null
    this.baseVersion = 0
    this.leaseRenewTimer = null
    this.leaseRenewError = null
    this.recoveredState = null
  }

  static getDefaultValues() {
    return {
      type: 'local-realtime',
      url: 'http://127.0.0.1:32145',
      username: '',
      password: '',
      libraryId: 'default',
      enabled: true,
      syncIntervalEnabled: true,
      syncInterval: 1,
      syncOnStartupEnabled: true,
      strategy: 'default',
      nestedSync: false,
      failsafe: true,
      allowNetwork: false,
    }
  }

  getData() {
    return { ...LocalRealtimeAdapter.getDefaultValues(), ...this.server }
  }

  getLabel():string {
    return this.server.label || 'Floccus Local'
  }

  private endpoint(path:string):string {
    return this.server.url.replace(/\/$/, '') + '/api/v1' + path
  }

  private async request(path:string, options:any = {}):Promise<any> {
    let response
    try {
      response = await fetch(this.endpoint(path), {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + this.server.password,
          ...(options.headers || {}),
        },
        cache: 'no-store',
        signal: this.abortController?.signal,
      })
    } catch (error) {
      throw new NetworkError()
    }
    let payload:any = {}
    try {
      payload = await response.json()
    } catch (error) {
      // Error handling below uses the status even if the response was not JSON.
    }
    if (response.ok) return payload
    if (response.status === 401 || response.status === 403) throw new AuthenticationError()
    if (response.status === 423) throw new ResourceLockedError()
    if (response.status === 409) throw new RealtimeConflictError(payload.message || 'The shared library changed during sync')
    throw new HttpError(response.status, options.method || 'GET')
  }

  private loadState(state:any) {
    if (!state || !state.tree || typeof state.version !== 'number') {
      throw new RealtimeConflictError('The local service returned an invalid bookmark state')
    }
    this.bookmarksCache = Folder.hydrate(state.tree).restampTree(false, 'Server')
    this.bookmarksCache.createIndex()
    this.baseVersion = state.version
    let highestId = 0
    const visit = item => {
      const numericId = Number(item.id)
      if (Number.isSafeInteger(numericId)) highestId = Math.max(highestId, numericId)
      if (item.children) item.children.forEach(visit)
    }
    visit(this.bookmarksCache)
    this.highestId = highestId
    this.server.localRealtimeVersion = state.version
    this.server.localRealtimeUpdatedAt = state.updatedAt
  }

  async onSyncStart(needLock = true) {
    this.stopLeaseRenewal()
    this.abortController = new AbortController()
    this.leaseId = null
    this.recoveredState = null
    const pending = this.server.localRealtimePending
    this.transactionId = pending?.transactionId || crypto.randomUUID()
    const libraryId = encodeURIComponent(this.server.libraryId || 'default')
    let state
    if (needLock) {
      if (pending?.preparedConflict && pending.leaseId) {
        await this.request(`/libraries/${libraryId}/lease/renew`, {
          method: 'POST',
          body: JSON.stringify({ leaseId: pending.leaseId, transactionId: this.transactionId }),
        })
        state = await this.request(`/libraries/${libraryId}/state`)
        if (state.version !== pending.baseVersion) {
          throw new RealtimeConflictError('The shared library changed before the conflict resolution started')
        }
        this.leaseId = pending.leaseId
        this.startLeaseRenewal()
      } else {
        state = await this.request(`/libraries/${libraryId}/lease`, {
          method: 'POST',
          body: JSON.stringify({ transactionId: this.transactionId }),
        })
      }
      if (state.alreadyCommitted) {
        if (!pending?.expectedCache || !pending?.expectedMappings) {
          throw new RealtimeConflictError('A committed transaction is missing its local recovery state')
        }
        this.recoveredState = {
          expectedCache: pending.expectedCache,
          expectedMappings: pending.expectedMappings,
        }
        this.server.localRealtimeConflictId = null
        this.server.localRealtimeConflictBaseVersion = null
        this.transactionId = crypto.randomUUID()
        state = await this.request(`/libraries/${libraryId}/lease`, {
          method: 'POST',
          body: JSON.stringify({ transactionId: this.transactionId }),
        })
        this.leaseId = state.leaseId
        this.startLeaseRenewal()
      } else if (!this.leaseId) {
        this.leaseId = state.leaseId
        this.startLeaseRenewal()
      }
      if (!this.leaseId) {
        state = await this.request(`/libraries/${libraryId}/state`)
      }
    } else {
      state = await this.request(`/libraries/${libraryId}/state`)
    }
    this.loadState(state)
    if (this.leaseId) {
      this.server.localRealtimePending = {
        ...(pending?.transactionId === this.transactionId ? pending : {}),
        transactionId: this.transactionId,
        leaseId: this.leaseId,
        baseVersion: this.baseVersion,
        startedAt: Date.now(),
      }
    }
    return state.version === 0 ? false : undefined
  }

  async getBookmarksTree():Promise<Folder<TItemLocation>> {
    return super.getBookmarksTree()
  }

  async onSyncComplete() {
    if (!this.leaseId) {
      return
    }
    if (this.leaseRenewError) throw this.leaseRenewError
    const libraryId = encodeURIComponent(this.server.libraryId || 'default')
    const payload = {
      leaseId: this.leaseId,
      transactionId: this.transactionId,
      baseVersion: this.baseVersion,
      tree: await this.bookmarksCache.clone(false).toJSONAsync(),
      reason: 'browser-sync',
      conflictId: this.server.localRealtimePending?.conflictId || this.server.localRealtimeConflictId || undefined,
    }
    let result
    try {
      result = await this.request(`/libraries/${libraryId}/commit`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error
      try {
        result = await this.request(`/transactions/${encodeURIComponent(this.transactionId)}`)
      } catch (lookupError) {
        throw error
      }
    }
    this.server.localRealtimeVersion = result.version
    this.server.localRealtimePending = {
      ...this.server.localRealtimePending,
      committedVersion: result.version,
    }
    this.stopLeaseRenewal()
    this.leaseId = null
    Logger.log('Floccus Local committed version', result.version, 'changed:', result.changed)
  }

  async onSyncFail() {
    this.stopLeaseRenewal()
    if (!this.leaseId) return
    try {
      const libraryId = encodeURIComponent(this.server.libraryId || 'default')
      await this.request(`/libraries/${libraryId}/lease`, {
        method: 'DELETE',
        body: JSON.stringify({ leaseId: this.leaseId }),
      })
    } catch (error) {
      Logger.log('Could not release Floccus Local lease', error)
    } finally {
      this.leaseId = null
    }
  }

  async recordConflict(localTree:Folder<TItemLocation>, sharedTree:Folder<TItemLocation>, details:string) {
    const libraryId = encodeURIComponent(this.server.libraryId || 'default')
    const conflict = await this.request(`/libraries/${libraryId}/conflict`, {
      method: 'POST',
      body: JSON.stringify({
        baseVersion: this.baseVersion,
        localTree: await localTree.toJSONAsync(),
        sharedTree: await sharedTree.toJSONAsync(),
        details,
      }),
    })
    this.server.localRealtimeConflictRecorded = true
    this.server.localRealtimeConflictId = conflict.id
    this.server.localRealtimeConflictBaseVersion = conflict.baseVersion
  }

  consumeRecoveredState() {
    const recovered = this.recoveredState
    this.recoveredState = null
    return recovered
  }

  cancel() {
    this.abortController?.abort()
    this.stopLeaseRenewal()
  }

  private startLeaseRenewal() {
    this.leaseRenewError = null
    this.leaseRenewTimer = setInterval(async() => {
      if (!this.leaseId || this.leaseRenewError) return
      try {
        const libraryId = encodeURIComponent(this.server.libraryId || 'default')
        await this.request(`/libraries/${libraryId}/lease/renew`, {
          method: 'POST',
          body: JSON.stringify({ leaseId: this.leaseId, transactionId: this.transactionId }),
        })
      } catch (error) {
        this.leaseRenewError = error
        Logger.log('Floccus Local lease renewal failed', error)
      }
    }, 10_000)
  }

  private stopLeaseRenewal() {
    if (this.leaseRenewTimer) clearInterval(this.leaseRenewTimer)
    this.leaseRenewTimer = null
  }

  isAtomic():boolean {
    return true
  }
}
