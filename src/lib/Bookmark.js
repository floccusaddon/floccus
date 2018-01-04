export default class Bookmark {
  constructor(id, localId, url, title, path) {
    this.id = id
    this.localId = localId
    this.url = url
    this.title = title
    this.path = path
  }

  async hash() {
    return await Bookmark.sha256(JSON.stringify({
      url: this.url
    , title: this.title
    , path: this.path
    }))
  }

	static async sha256(message) {
		const msgBuffer = new TextEncoder('utf-8').encode(message);                     // encode as UTF-8
		const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);            // hash the message
		const hashArray = Array.from(new Uint8Array(hashBuffer));                       // convert ArrayBuffer to Array
		const hashHex = hashArray.map(b => ('00' + b.toString(16)).slice(-2)).join(''); // convert bytes to hex string
		return hashHex;
	}
}
