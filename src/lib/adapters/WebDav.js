/* @jsx el */

import InputInitializeHook from '../InputInitializeHook'
import Bookmark from '../Bookmark'
import humanizeDuration from 'humanize-duration'

const {h} = require('virtual-dom')

function el (el, props, ...children) {
    return h(el, props, children)
};

const url = require('url')

export default class WebDavAdapter {
    constructor (server) {
        console.log('Webdav constructor');
        console.log(server);

        this.server = server;
        this.db = new Map();

        console.log ("THIS");
        console.log (this);
    }

    setData (data) {
        this.server = data;
    }

    getData () {
        return JSON.parse(JSON.stringify(this.server));
    }

    getLabel () {
        let data = this.getData();
        return data.username + '@' + data.url;
    }

    getBookmarksAsJSON () {
        let bookmarksList = [];
        let values = Array.from(this.db.values());

        for (var i = 0; i < values.length; ++i)
        {
            let value = values [i];
            bookmarksList.push (
                {
                    id: value.id,
                    path: value.path,
                    url: value.url,
                    title: value.title,
                });
        }

        return JSON.stringify (bookmarksList, null, 4);
    }

	getBookmarkURL () {
        return this.server.url + this.server.bookmark_file;
	}

	getBookmarkLockURL () {
		return this.getBookmarkURL () + ".lock";
	}

    async checkLock () {
        console.log ("checkLock: 001");

        let rStatus = 500;
        let response;
		let fullURL = this.getBookmarkLockURL ();
		console.log (fullURL);

        try {
            response = await fetch (fullURL, {
                    method: 'GET',
                    headers: {
                        'Authorization': 'Basic ' + btoa(this.server.username + ':' + this.server.password)
                    },
                });

            console.log ("response");
            console.log (response);

            rStatus = response.status;

            console.log (rStatus);
        } catch (e) {
            console.log ("Error Caught");
            console.log (e);
        }
       
		console.log ("checkLock: out " + rStatus );

        return rStatus;
    }

	timeout(ms) {
    	return new Promise(resolve => setTimeout(resolve, ms));
	}

    async obtainLock () {
        console.log ("obtainLock: 001");

        let rStatus;
        let maxTimeout = 30;
		let increment = 5;
        let idx = 0;

        for (idx = 0; idx < maxTimeout; idx += increment)
        {
			console.log ("loop :" + idx + ":");
            rStatus = await this.checkLock ();
			console.log ("obtainLock: 002 " + rStatus);
            if (rStatus == 200) {
				console.log ("waiting timeout :" + increment + ":");
				await this.timeout (increment * 1000);
				console.log ("waited timeout :" + increment + ":");
            } else if (rStatus == 404) {
				break;
            }
        }

		console.log ("obtainLock: 003 " + rStatus);

		if (rStatus == 200) {
        	throw new Error('Lock Error: Unable to clear lock file, consider deleting ' + this.server.bookmark_file + '.lock');
		}
		else if (rStatus == 404)
		{
			console.log ("obtainLock: 005 " + rStatus);
			let fullURL = this.getBookmarkLockURL ();
			console.log (fullURL);
			try {
				await fetch (fullURL, {
						method: 'PUT',
						headers: {
							'Content-Type': 'text/html',
							'Authorization': 'Basic ' + btoa(this.server.username + ':' + this.server.password)
						},
						body: '<html><body>I am a lock file</body></html>'
					});
			} catch (e) {
            	console.log ("Error Caught");
            	console.log (e);
            	throw new Error('Network error: Check your network connection and your account details');
        	}
		}
		else {
			console.log ("obtainLock: 006 " + rStatus);
        	throw new Error('Network Error: Unable to determine status of lock file ' + this.server.bookmark_file + '.lock');
		}

        return 1;
    }

    async freeLock () {
        console.log ("freeLock: 001");

        let fullUrl = this.server.bookmark_file;
        fullUrl = this.server.url + fullUrl + ".lock";

        console.log ("fullURL :" + fullUrl + ":");

        let rStatus = 500;
        let response;

        try {
            response = await fetch (fullUrl, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': 'Basic ' + btoa(this.server.username + ':' + this.server.password)
                    },
                });

            rStatus = response.status;

            console.log ("response");
            console.log (response);
        } catch (e) {
            console.log ("Error Caught");
            console.log (e);
        }
    }

    addBookmark (myStructure, bm)
    {
        let myArray = bm.path.split ("/");
        let idx;
        let current = myStructure;
        let current_path = "";

        for (idx = 1; idx < myArray.length; ++idx)
        {
            let item = myArray [idx];
            if (item in current.folders)
            {
                current = current.folders [item];
            }
            else
            {
                let newpath;

                if (current.path == '/')
                {
                    newpath = current.path + item;
                }
                else
                {
                    newpath = current.path + "/" + item;
                }

                current.folders [item] = {
                    'title': item,
                    'path': newpath,
                    'bookmarks': [],
                    'folders': {},
                };

                current = current.folders [item];
            }
        }

        current.bookmarks.push ({
            'title': bm.title,
            'id': bm.id,
            'path': bm.path,
            'url': bm.url
        });

        console.log ("addBookmark");
        console.log (myStructure);
    }

    convertToStructure () {
        try {
            let myBookmarks = Array.from(this.db.values());
            let myStructure = {
                    'title': '',
                    'path': '',
                    'bookmarks': [],
                    'folders': {},
            };

            myBookmarks.forEach ( (bm) => {
                this.addBookmark (myStructure, bm);
            });
        }
        catch (e) {
            console.log ("error");
            console.log (e);
        }
    }

    async syncComplete () {
        console.log ("WebDav: Uploading JSON file to server");
        this.bookmarksAsJSON = this.getBookmarksAsJSON ();

        let fullUrl = this.server.bookmark_file;
        fullUrl = this.server.url + fullUrl;
        console.log ("fullURL :" + fullUrl + ":");

        try {
            await fetch (fullUrl, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + btoa(this.server.username + ':' + this.server.password)
                    },
                    body: this.bookmarksAsJSON
                });
        } catch (e) {
            console.log ("Error Caught");
            console.log (e);
            throw new Error('Network error: Check your network connection and your account details');
        }

		this.freeLock ();

        this.convertToStructure ();
    }

    async pullFromServer () {
        let fullUrl = this.server.bookmark_file;
        fullUrl = this.server.url + fullUrl;
        console.log ("fullURL :" + fullUrl + ":");

        let response;

        try {
            response = await fetch (fullUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': 'Basic ' + btoa(this.server.username + ':' + this.server.password)
                    }
                });
        } catch (e) {
            console.log ("Error Caught");
            console.log (e);
            throw new Error('Network error: Check your network connection and your account details');
        }

        if (response.status === 401) {
            throw new Error('Couldn\'t authenticate for removing bookmarks from the server.');
        }

        if (response.status !== 200) {
            return {
                'status' : response.status,
                'db' : new Map ()
            };
        }

        let bookmark_array = await response.json();
        let server_db = new Map ();

        bookmark_array.forEach ( (bm) => {
            server_db.set(bm.id, {
                id: bm.id
                , url: bm.url
                , title: bm.title
                , path: bm.path
            });
        });

console.log ("response out");
console.log (server_db);

        return {
            'status' : response.status,
            'db' : server_db
        };
    }

    async syncStart () {
        console.log ("syncStart: started");
        await this.obtainLock ();

        try {
            let resp = await this.pullFromServer ();
            this.db = resp.db;

            if (resp.status !== 200)
            {
                if (resp.status !== 404)
                {
                    throw new Error('Failed to fetch bookmarks :' + resp.status + ":");
                }
            }
        } catch (e) {
            console.log ("caught error");
            console.log (e);

            this.db = new Map ();
        }

        console.log ("syncStart: completed");
    }

    async pullBookmarks () {
        console.log('Fetching bookmarks', this.server)

        let myBookmarks = Array.from(this.db.values())
            .map(bm => {
                    return new Bookmark(bm.id, null, bm.url, bm.title, bm.path)
            }
        );

        console.log('Received bookmarks from server')
        console.log (myBookmarks);

        return myBookmarks
    }

    async getBookmark (id, autoupdate) {
        console.log('Fetching single bookmark', this.server);
        let bm = this.db.get(id);
        if (!bm) {
            throw new Error('Failed to fetch bookmark');
        }
        let bookmark = new Bookmark(bm.id, null, bm.url, bm.title, bm.path);
        return bookmark;
    }

    async createBookmark (bm) {
        console.log('Create single bookmark', bm, this.server)

        // Per Marcel
        // Also, since the user can also delete bookmarks, it might be
        // best to have the counter persisted in the file, otherwise,
        // if the last entry is deleted and at the same time a new bookmark
        // is created, it gets the same id, causing other clients to think
        // it was changed, rather then two independent operations. Not sure
        // if that's actually a problem, but let's not make it one :)

        // I am going to postpone work on this, till I get XBEL format worked
        // out.   If there is a place in XBEL I can persist the id count that
        // would be perfect.   I could always have an augment file that could
        // persist the highestID, but that would ask for a 2nd webdav call and
        // unnecessary network overhead.

        let highestID = 0;
        this.db.forEach ( (value, key) => {
            if (value && value.id && highestID < value.id)
            highestID = value.id;
        });

        bm.id = highestID + 1;

        this.db.set(bm.id, {
            id: bm.id
            , url: bm.url
            , title: bm.title
            , path: bm.path
        });

        return bm;
    }

    async updateBookmark (remoteId, newBm) {
        console.log('Update bookmark', newBM, remoteId, this.server)

        let bm = await this.getBookmark(remoteId, false)

        this.db.set(bm.id, {
            id: bm.id
            , url: newBm.url
            , title: newBm.title
            , path: newBm.path
            })
            console.log ("THIS");
            console.log (this);
            return new Bookmark(remoteId, null, newBm.url, newBm.title, newBm.path)
    }

    async removeBookmark (remoteId) {
        console.log('Remove bookmark', remoteId, this.server)
        this.db.delete(remoteId);
        console.log ("THIS");
        console.log (this);
    }

    renderOptions (ctl, rootPath) {
        let data = this.getData()

        let onchangeURL = (e) => {
            if (this.saveTimeout)
                clearTimeout(this.saveTimeout);

            {
                let myUrl = e.target.value;
                this.saveTimeout = setTimeout(() => ctl.update({...data, url: myUrl}), 300);
            }
        }
        let onchangeUsername = (e) => {
            if (this.saveTimeout) clearTimeout(this.saveTimeout)
                this.saveTimeout = setTimeout(() => ctl.update({...data, username: e.target.value}), 300)
        }
        let onchangePassword = (e) => {
            if (this.saveTimeout) clearTimeout(this.saveTimeout)
                this.saveTimeout = setTimeout(() => ctl.update({...data, password: e.target.value}), 300)
        }
        let onchangeBookmarkFile = (e) => {
            if (this.saveTimeout) clearTimeout(this.saveTimeout)
                this.saveTimeout = setTimeout(() => ctl.update({...data, bookmark_file: e.target.value}), 300)
        }
        return <div className="account">
            <form>
            <table>
            <tr>
            <td><label for="url">WebDav Server URL:</label></td>
            <td><input value={new InputInitializeHook(data.url)} type="text" className="url" name="url" ev-keyup={onchangeURL} ev-blur={onchangeURL}/></td>
            </tr>
            <tr>
            <td><label for="username">User name:</label></td>
            <td><input value={new InputInitializeHook(data.username)} type="text" className="username" name="password" ev-keyup={onchangeUsername} ev-blur={onchangeUsername}/></td>
            </tr>
            <tr>
            <td><label for="password">Password:</label></td>
            <td><input value={new InputInitializeHook(data.password)} type="password" className="password" name="password" ev-keydown={onchangePassword} ev-blur={onchangePassword}/></td></tr>
            <tr>
            <td><label for="bookmark_file">Bookmark File:</label></td>
            <td><input value={new InputInitializeHook(data.bookmark_file)} type="text" className="text" name="bookmark_file" ev-keydown={onchangePassword} ev-blur={onchangeBookmarkFile}/></td></tr>
            <tr><td></td><td>
            <span className="status">{
                data.syncing
                    ? '↻ Syncing...'
                    : (data.error
                            ? <span>✘ Error!</span>
                            : <span>✓ all good</span>
                      )
            }</span>
        <a href="#" className="btn openOptions" ev-click={(e) => {
            e.preventDefault()
                var options = e.target.parentNode.querySelector('.options')
                if (options.classList.contains('open')) {
                    e.target.classList.remove('active')
                        options.classList.remove('open')
                } else {
                    e.target.classList.add('active')
                        options.classList.add('open')
                }
        }}>Options</a>
        <a href="#" className={'btn forceSync ' + (data.syncing ? 'disabled' : '')} ev-click={() => !data.syncing && ctl.sync()}>Sync now</a>
            <div className="status-details">{data.error
                ? data.error
                    : data.syncing === 'initial'
                    ? 'Syncing from scratch. This may take a longer than usual...'
                    : 'Last synchronized: ' + (data.lastSync ? humanizeDuration(Date.now() - data.lastSync, {largest: 1, round: true}) + ' ago' : 'never')}</div>
                    <div className="options">
                    <formgroup>
                    <h4>Sync folder</h4>
                    <input type="text" disabled value={rootPath} /><br/>
                    <a href="" title="Reset synchronized folder to create a new one" className={'btn resetRoot ' + (data.syncing ? 'disabled' : '')} ev-click={() => {
                        !data.syncing && ctl.update({...data, localRoot: null})
                    }}>Reset</a>
        <a href="#" title="Set an existing folder to sync" className={'btn chooseRoot ' + (data.syncing ? 'disabled' : '')} ev-click={(e) => {
            e.preventDefault()
                ctl.pickFolder()
        }}>Choose folder</a>
        </formgroup>
            <formgroup>
            <h4>Remove account</h4>
            <a href="#" className="btn remove" ev-click={(e) => {
                e.preventDefault()
                    ctl.delete()
            }}>Delete this account</a>
        </formgroup>
            </div>
            </td></tr>
            </table>
            </form>
            </div>
    }
}
