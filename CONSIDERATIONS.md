# Considerations aka. Is this a good idea?

As there have been debates about whether this software product is a good idea, I've made a little section here with my considerations.

### Goals

The goals of this piece of software

- provide an open cross-platform sync solution for browser data with a self-hosted server
- performance is a plus, but not necessary
- (eventual) consistency is more important than intention preservation (i.e. when ever a mistake happens during sync, it's guaranteed to be eventually consistent on all sites)

### Current status and Limitations

The WebExtensions bookmarks API has a few limitations:

1.  No support for batching or transactions
2.  Record GUIDs can change, but are only known to change when Firefox Sync is used.
3.  The data format doesn't represent descriptions, tags or separators
4.  No way to create a per-device folder
5.  It's impossible to express safe operations, because there are no compare-and-set primitives.
6.  Triggering a sync after the first change, causing repeated syncs and inconsistency to spread to other devices.

Nonetheless, I've chosen to utilize the WebExtensions API for implementing this sync client. As I'm aware, this decision has (at least) the following consequences:

1.  No transaction support (\#1) leads to bad performance
2.  No support for transactions (\#1) also can potentially cause intermediate states to be synced. However, all necessary precautions are taken to prevent this and even in the case that this happens, all sites will be eventually consistent, allowing you to manually resolve possible problems after the fact.
3.  Due to the modification of GUIDs (\#2), usage of Firefox Sync along with Floccus is discouraged.
4.  The incomplete data format (\#3) is an open problem, but doesn't impact the synchronization of the remaining accessible data.
5.  The inability to exclude folders from sync in 3rd-party extensions (\#4) is a problem, but manageable when users are able to manually choose folders to ignore. (Currently not implemented)
6.  The lack of safe write operations (\#5) can be dealt with similarly to the missing transaction support: Changes made during sync could lead to an unintended but consistent state, which can be resolved manually. Additionally, precautions are taken to prevent this.
7.  In order to avoid syncing prematurely (\#6) floccus employs a timeout to wait until all pending bookmarks operations are done.
