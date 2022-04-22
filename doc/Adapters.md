# Adapters

An adapter in the context of floccus is a module that implements support for a specific syncing backend. It is used by the Sync Algorithm to access said backend as well as the UI to offer configuration options for the backend.

## API

### Adapter and resource API

All adapters implement the following API.

```js
class Adapter extends Resource {
  /**
   * @param data:any the initial account data
   */
  constructor(data: any)

  /**
   * @static
   * @param state:{account:AccountData} Contains the current account data
   * @param update:(data) => void Allows updating account data
   * @return hyperapp-tree The options UI for this adapter
   */
  static renderOptions(state, update) : VNode

  /**
   * @static
   * @return Object the default values of the account data for this adapter
   */
  static getDefaultValues() : any

  /**
   * @param Object the account data entered in the options
   */
  setAccountData(data: any)

  getAccountData() : any

  /**
   * The label for this account based on the account data
   */
  getLabel() : string

  /**
   * @return Boolean true if the bookmark type can be handled by the adapter
   */
  acceptsBookmark(bookmark) : boolean

  /**
   * Optional hook to do something on sync start
   */
  async onSyncStart()

  /**
   * Optional hook to do something on sync completion
   */
  async onSyncComplete()

  /**
   * Optional hook to do something on sync fail
   */
  async onSyncFail()
}

class Resource {
  /**
   * @return Promise<Folder> The bookmarks tree as it is present on the server
   */
  async getBookmarksTree() : Folder

  /**
   * @param bookmark:Bookmark the bookmark to create
   * @return int the id of the new bookmark
   */
  async createBookmark(bookmark: Bookmark) : int

  /**
   * @param bookmark:Bookmark the bookmark with the new data
   * @returns (optional) new id of the bookmark
   */
  async updateBookmark(bookmark: Bookmark) : int|undefined

  /**
   * @param id:int the id of the bookmark to delete
   */
  async removeBookmark(id:int)

  /**
   * @param parentId:int the id of the parent node of the new folder
   * @param title:string the title of the folder
   * @return Promise<int> the id of the new folder
   */
  async createFolder(parentId: int, title: string) : int

  /**
   * @param id:int the id of the folder to be updated
   * @param title:string the new title
   */
  async updateFolder(id: int, title: string)

  /**
   * @param id:int the id of the folder
   * @param newParentId: int the id of the new folder
   */
  async moveFolder(id: int, newParent:int)

  /**
   * @param id:int the id of the folder
   */
  async removeFolder(id: int)

  /**
   * ------
   * The following methods are optional
   * ------
   */

  /**
   * (Optional method)
   * @param id:int the id of the folder
   * @param order the order of the folder's contents
   */
  async orderFolder(id: int, order: {id: int, type: 'bookmark'|'folder'}[])

  /**
   * (Optional method)
   * @param parentId:int the id of the folder to import into
   * @param folder:Folder the folder to import
   */
  async bulkImportFolder(parentId: int, folder: Folder)

}
```

## Data Types

Your adapter will receive and return data using the following data types.

```js
class Bookmark {
  public type: string = 'bookmark'
  public id: int
  public parentId: int
  public url: string
  public title: string

  constructor({ id: int, parentId: int, url: string, title: string })

  clone() : Bookmark
}

class Folder {
  public type: string = 'folder'
  public id: int
  public parentId: int
  public title: string
  public children: (Folder|Bookmark)[]

  constructor({ id: int, parentId: int, title: string, children: (Folder|Bookmark)[] })

  findFolder(id: int) : Folder|undefined

  findBookmark(id) : Bookmark|undefined

  clone() : Folder
}
```

You can import these using the following line:

```js
import { Folder, Bookmark } from '../Tree'
```

### Account data

The account data object holds all state specific to each account and is easily extensible. Floccus reserves the following properties for internal use:

```js
{
  type: string, // specifies the account adapter
  enabled: boolean, // whether automatic syncing is enabled for this account
  localRoot: string, // the local folder associated with this account
  rootPath: string, // the full folder path to the local root folder
  error: null|string, // either null or a string containing the latest error of the last sync
  syncing: false|float, // either false or a float between 0 and 1 indicating the sync progress
  strategy: string, // indicates the sync strategy to be used
  lastSync: int // the timestamp of the last sync run

  // ...any properties your adapter adds
}
```

## Rendering the options UI

Most method signatures above should be self-explanatory, with the exception perhaps of the `renderOptions` method.

```js
static renderOptions(state, update) : VNode
```

Floccus uses a React-style virtual DOM rendering system and uses JSX to write templates. An options view could look like this:

```js
  static renderOptions(state, update) {
    let data = state.account
    let onchange = (prop, e) => {
      update({ [prop]: e.target.value })
    }
    return (
      <form>
        <Label for="url">Nextcloud URL</Label>
        <Input
          value={data.url}
          type="text"
          name="url"
          oninput={(e) => onchange('url', e)}
        />
        <Label for="username">Nextcloud Username</Label>
        <Input
          value={data.username}
          type="text"
          name="username"
          oninput={(e) => onchange('username', e)}
        />
        <Label for="password">Password</Label>
        <Input
          value={data.password}
          type="password"
          name="password"
          oninput={(e) => onchange('password', e)}
        />
        <OptionSyncFolder account={state.account} />
        <OptionSyncInterval account={state.account} />
        <OptionResetCache account={state.account} />
        <OptionParallelSyncing account={state.account} />
        <OptionSyncStrategy account={state.account} />
        <OptionDelete account={state.account} />
      </form>
    )
  }
```

Let's go through this:

First, we get the account data from the state parameter:

```js
let data = state.account
```

Then we create a little helper function that makes updating that state a little less cumbersome.

```js
let onchange = (prop, e) => {
  update({ [prop]: e.target.value })
}
```

It takes the property name and the change event object from the DOM and calls the update callback with the new value for that property.

The next step might be a little strange if your not familiar with React style javascript: We just return the HTML code for our UI. Directly in javascript. Boom.

This syntax is called JSX (Google will tell you more about it) and it also allows you to interpolate data into your HTML using curly braces, like this `<button>{myVariable}</button>` or this `<button onclick={ () => console.log('CLICKED!') }`.

The next unusual thing is this part:

```js
<OptionSyncFolder account={state.account} />
<OptionSyncInterval account={state.account} />
<OptionResetCache account={state.account} />
<OptionParallelSyncing account={state.account} />
<OptionSyncStrategy account={state.account} />
<OptionDelete account={state.account} />
```

It looks like some kind of HTML or XML. In fact it's just another feature of JSX: You can store blocks of HTML code in variables, pass them around and use them somewhere else. This is what happens here. Floccus defines some common settings that are useful in accounts of all types. Actually, nearly all elements we've used so far are custom elements. They are defined by floccus and can be imported as follows:

```js
import * as Basics from '../components/basics'
const {
  Input,
  Button,
  Label,
  OptionSyncFolder,
  OptionDelete,
  OptionResetCache,
  OptionParallelSyncing,
  OptionSyncInterval,
  OptionSyncStrategy,
  H3
} = Basics
```

Using these will make sure that your UI will fit in with the design of floccus.

## Internationalization

In order for your UI to be translatable, you'll have to add your strings to the following file with a unique ID: `_locales/en/messages.json`

The format should be quite simple to figure out from the existing messages.

You can use these strings by specifying the unique ID using the following API:

```
import browser from '../browser-api'

// ....

browser.i18n.getMessage('LabelNextcloudurl')
```

## ... and beyond!

I also encourage you to check out the code of existing adapters for inspiration.
