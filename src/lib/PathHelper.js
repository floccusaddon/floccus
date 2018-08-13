export default class PathHelper {
  static reverseStr(str) {
    return str
      .split('')
      .reverse()
      .join('')
  }

  static pathToArray(path) {
    return this.reverseStr(path)
      .split(/[/](?![\\])|[/](?=\\\\)/)
      .map(value => this.reverseStr(value))
      .map(value => value.replace(/\\[/]/g, '/'))
      .map(value => value.replace(/\\\\/g, '\\'))
      .reverse()
  }

  static arrayToPath(array) {
    return array
      .map(value => value.replace(/\\/g, '\\\\'))
      .map(value => value.replace(/[/]/g, '\\/'))
      .join('/')
  }
}
