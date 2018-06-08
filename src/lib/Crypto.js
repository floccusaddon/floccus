import murmur2 from 'murmur2js'

export default class Crypto {
  static murmur2(message) {
    return murmur2(message)
  }

  static async sha256(message) {
    const msgBuffer = new TextEncoder('utf-8').encode(message) // encode as UTF-8
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer) // hash the message
    const hashHex = this.bufferToHexstr(hashBuffer) // convert bytes to hex string
    return hashHex
  }

  static bufferToHexstr(buffer) {
    return Array.from(new Uint8Array(buffer))
      .map(b => ('00' + b.toString(16)).slice(-2))
      .join('') // convert bytes to hex string
  }

  static hexstrToBuffer(hex) {
    for (
      var bytes = new Uint8Array(hex.length / 2), c = 0;
      c < hex.length;
      c += 2
    ) {
      bytes[c / 2] = parseInt(hex.substr(c, 2), 16)
    }
    return bytes
  }

  static async prepareKey(key) {
    const keyBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder('utf-8').encode(key)
    ) // hash the key
    let cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-CBC' },
      false,
      ['decrypt', 'encrypt']
    )
    return cryptoKey
  }

  static async decryptAES(key, iv, ciphertext) {
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv: Uint8Array.from(iv) },
        await this.prepareKey(key),
        this.hexstrToBuffer(ciphertext)
      )
    )
  }

  static async encryptAES(key, iv, message) {
    return this.bufferToHexstr(
      await crypto.subtle.encrypt(
        { name: 'AES-CBC', iv: Uint8Array.from(iv) },
        await this.prepareKey(key),
        new TextEncoder().encode(message)
      )
    )
  }

  static getRandomBytes(bytelength) {
    let rand = new Int8Array(bytelength)
    crypto.getRandomValues(rand)
    return rand
  }
}

// A default initialization vector for the key hash
Crypto.iv = [
  58,
  14,
  9,
  204,
  174,
  93,
  77,
  98,
  12,
  248,
  11,
  160,
  143,
  24,
  119,
  20
]
