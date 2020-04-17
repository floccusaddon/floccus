const url = require('url')

let api_versions = {}

api_versions.API_PATH_PREFIX = "index.php/apps/bookmarks/public/rest/"

// check for a compatible version
api_versions.lessEqual = function(v1, v2) {
	return v1 <= v2
}

// @return versionstring like "v2"
api_versions.extractVersion = function(url) {
	url = new URL(url)
	url = url.pathname
	if (url.indexOf(api_versions.API_PATH_PREFIX) == 1) {
		return url.split("/")[6]
	}
	throw "Could not parse Version."
}

export default api_versions
