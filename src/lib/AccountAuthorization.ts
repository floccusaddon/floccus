import { IAccountData } from './interfaces/AccountStorage'

/**
 * Sync methods that authenticate via OAuth.
 *
 * Their refresh tokens are issued to a specific client_id and we necessarily use
 * a different client_id in the browser extension than in the mobile app (see
 * google-api.credentials.json / dropbox-api.credentials.json). Thus, a refresh token
 * cannot be carried over from one platform to another: the token endpoint
 * answers such a request with `unauthorized_client`, which surfaces as E018.
 */
export const OAUTH_ACCOUNT_TYPES = ['google-drive', 'dropbox']

export function isOAuthAccount(data: IAccountData): boolean {
  return OAUTH_ACCOUNT_TYPES.includes(data.type)
}

/**
 * Whether this profile still needs the user to connect their account before it
 * can sync -- notably the case for OAuth profiles that were just imported.
 */
export function needsAuthorization(data: IAccountData): boolean {
  return isOAuthAccount(data) && !data.refreshToken
}
