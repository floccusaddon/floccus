export default class PathHelper {
  static reverseStr(str) {
    return str
      .split('')
      .reverse()
      .join('')
  }

  static pathToArray(path) {
    return this.reverseStr(path)
      .split(/[/](?![\\])/)
      .map(value => this.reverseStr(value))
      .reverse()
  }

  static arrayToPath(array) {
    return array.map(value => value.replace(/[/]/, '\\/')).join('/')
  }
}
