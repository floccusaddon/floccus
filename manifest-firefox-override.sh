#!/usr/bin/sh

# Local development workaround for Firefox.
#
# Once you build this extension (with `npm install` and `npm run build`, as per <README.md>), to
# load it, visit Firefox special URL about:debugging#/runtime/this-firefox. Click button "Load
# Temporary Add-on..." That button shows a file/folder picker.
#
# Problem: The file picker does allow you to select `manifest.firefox.json`, BUT it will not load
# it. It loads `manifest.json` (from the directory where you selected `manifest.firefox.json`)
# instead. (Indeed, a Firefox defect - but life is too short for us to waste it on Mozilla's
# bugzilla....)
#
# Firefox doesn't allow to use symlinks to workaround the above problem (see
# https://bugzilla.mozilla.org/show_bug.cgi?id=803999 - symlinks are a security problem).
#
# Workaround: This script
# 1. copies manifest.firefox.json over manifest.json
# 2. prevents that change from being accidentally committed to GIT.

# Enter the directory where this script is (in case we call it from somewhere else).
cd "${0%/*}"

# Invoking `/usr/bin/cp` directly, in case there's an alias that warns about overriding existing
# files.
/usr/bin/cp manifest.firefox.json manifest.json

# See also
# https://stackoverflow.com/questions/13630849/git-difference-between-assume-unchanged-and-skip-worktree
git update-index --skip-worktree manifest.json
