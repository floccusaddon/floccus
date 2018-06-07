export default class PathParse {
  static reverseStr(str) {
    return str
      .split('')
      .reverse()
      .join('')
  }

  static parsePathIntoAnArray(path) {
    return PathParse.reverseStr(path)
      .split(/[/](?![\\])/)
      .map(value => PathParse.reverseStr(value))
      .reverse()
  }
}
