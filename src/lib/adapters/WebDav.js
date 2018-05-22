/* @jsx el */

import InputInitializeHook from '../InputInitializeHook'
import Bookmark from '../Bookmark'
import humanizeDuration from 'humanize-duration'

const {h} = require('virtual-dom')

function el (el, props, ...children) {
    return h(el, props, children)
};

const url = require('url')

function getServerKey (server) {
    let key = "";

    key = key + "," + server.url;
    key = key + "," + server.username;
    key = key + "," + server.bookmark_file;

    return key;
}

function getBookmarkKey (bm) {
    let key = "";

    key = bm.path;
    key = "," + bm.title;
    key = "," + bm.url;

    return key;
}

var WebDavAdapters = new Map ();

export default class WebDavAdapter {
    constructor (server) {
        console.log('Webdav constructor');
        console.log(server);

        this.server = server;
        this.db = new Map();

        console.log ("THIS");
        console.log (this);
    }

    // WebDavAdapter is a multiton based in server
    static getMultiton (server) {
        let key = getServerKey (server);
        console.log ("getInstance: KEY :" + key + ":");

        let wda = WebDavAdapters.get(key);
        if (wda)
        {
            console.log ("Returning multiton");
            return wda;
        }

        console.log ("Creating new instance");
        wda = new WebDavAdapter (server);
        WebDavAdapters.set (key, wda);

        return wda;
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

    async syncComplete () {
        console.log ("WebDav: Copying JSON file to server");
        this.bookmarksAsJSON = this.getBookmarksAsJSON ();

        console.log ("path :" + this.server.bookmark_file + ":");
        console.log ("BODY");
        console.log (this.bookmarksAsJSON);
        console.log (this.server);

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
    }

    async pullFromServer () {
        let fullUrl = this.server.bookmark_file;
        fullUrl = this.server.url + fullUrl;
        console.log ("fullURL :" + fullUrl + ":");

        let myBookmarks = this.getBookmarksAsJSON ();
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
        try {
            let resp = await this.pullFromServer ();
            this.db = resp.db;

console.log ("resp");
console.log (resp);

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

        let server_db;
        try {
            let resp = await this.pullFromServer ();
            server_db = resp.db;

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

            server_db = new Map ();
        }

        let myBookmarks = Array.from(server_db.values())
            .map(bm => {
                    return new Bookmark(bm.id, null, bm.url, bm.title, bm.path)
                    })

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
            if (!~['https:', 'http:', 'ftp:'].indexOf(url.parse(bm.url).protocol)) {
                return false
            }

        let highestID = 0;
        this.db.forEach ( (value, key) => {
            if (value && value.id && highestID < value.id)
            highestID = value.id;
        });

        bm.id = highestID + 1;

try {
        this.db.set(bm.id, {
            id: bm.id
            , url: bm.url
            , title: bm.title
            , path: bm.path
        });
} catch (e) {
    console.log ("SET FAILED");
    console.log (e);
    console.log (this);
    console.log (bm);
}

        return bm;
    }

    async updateBookmark (remoteId, newBm) {
        console.log('Update bookmark', newBM, remoteId, this.server)
        if (!~['https:', 'http:', 'ftp:'].indexOf(url.parse(newBm.url).protocol)) {
            return false
        }
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
            if (this.saveTimeout) clearTimeout(this.saveTimeout)
            {
                let myUrl = e.target.value;
                let myHttps = 0;
                if (~['https:'].indexOf(url.parse(myUrl).protocol))
                    myHttps = 1;
                this.saveTimeout = setTimeout(() => ctl.update({...data, url: myUrl, isHttps: myHttps}), 300);
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
