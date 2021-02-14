import { fromUint8Array, toUint8Array } from 'js-base64'

export default class Crypto {
  static iterations = 250000
  static ivLength = 16

  static async sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message) // encode as UTF-8
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer) // hash the message
    const hashHex = this.bufferToHexstr(new Uint8Array(hashBuffer)) // convert bytes to hex string
    return hashHex
  }

  static bufferToHexstr(buffer: Uint8Array): string {
    return Array.from(new Uint8Array(buffer))
      .map(b => ('00' + b.toString(16)).slice(-2))
      .join('') // convert bytes to hex string
  }

  static hexstrToBuffer(hex: string): Uint8Array {
    for (
      var bytes = new Uint8Array(hex.length / 2), c = 0;
      c < hex.length;
      c += 2
    ) {
      bytes[c / 2] = parseInt(hex.substr(c, 2), 16)
    }
    return bytes
  }

  static async prepareKey(passphrase: string, salt: string): Promise<CryptoKey> {
    const enc = new TextEncoder()
    const passphraseBytes = enc.encode(passphrase)
    const saltBytes = enc.encode(salt)
    const key = await crypto.subtle.importKey('raw', passphraseBytes, 'PBKDF2', false, ['deriveKey'])
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: saltBytes,
        iterations: Crypto.iterations
      },
      key,
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['encrypt', 'decrypt']
    )
  }

  static async decryptAES(key: string, payload: string, salt: string) : Promise<string> {
    const cryptoKey = await this.prepareKey(key, salt)
    const buffer = toUint8Array(payload)
    const iv = buffer.slice(0, this.ivLength)
    const ciphertext = buffer.slice(this.ivLength)

    const plaintextBytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ciphertext)
    return new TextDecoder().decode(plaintextBytes)
  }

  static async encryptAES(key: string, message: string, salt: string): Promise<string> {
    // Generate a random 16 byte initialization vector
    const iv = this.getRandomBytes(this.ivLength)
    const messageBytes = new TextEncoder().encode(message)
    const cryptoKey = await this.prepareKey(key, salt)
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      messageBytes
    )

    const resultBytes = this.concatBytes(iv, new Uint8Array(ciphertext))

    return fromUint8Array(resultBytes)
  }

  static concatBytes(array1: Uint8Array, array2: Uint8Array): Uint8Array {
    const result = new Uint8Array(array1.length + array2.length)
    result.set(array1, 0)
    result.set(array2, array1.length)
    return result
  }

  static getRandomBytes(bytelength: number) : Uint8Array {
    const rand = new Uint8Array(bytelength)
    crypto.getRandomValues(rand)
    return rand
  }
}
