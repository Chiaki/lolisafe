# Todo

Normal priority:

* [x] Improve performance of album public pages, ~~and maybe paginate them~~.
* [x] Use [native lazy-load tag](https://web.dev/native-lazy-loading) on nojs album pages.
* [x] Use incremental version numbering instead of randomized strings.
* [ ] Use versioning in /api/check. To elaborate, make it so that when a version string reported by server is higher than expected, force user to reload the page (which should be all that is needed for users to be loading latest front-end assets). Possibly also use it in /api/tokens/verify, for dashboard page.
* [x] Better `df` handling (system disk stats). To elaborate, either properly show disk usages of directories that have sub-directories, or only show disk usages of whitelisted directories (thumbs, chunks, etc).
* [x] Use loading spinners on dashboard's sidebar menus.
* [x] Disable all other sidebar menus when a menu is still loading.
* [ ] Collapsible dashboard's sidebar albums menus.
* [ ] Add "View uploads" button in "Manage your albums" page. Assuming the sidebar album menus are collapsed, users can optionally use this button as a shortcut, if they already happened to be in that page.
* [x] Change `title` attribute of disabled control buttons in uploads & users lists.
* [x] Use Gatsby logo for link to [blog.fiery.me](https://blog.fiery.me/) on the homepage.
* [ ] Automatically create missing columns in `database/db.js`. That way we will no longer need the migration script.
* [x] Better error message when server is down.
* [x] Show expiry date in thumbs view.
* [ ] Add Select all checkbox somewhere in thumbs view.
* [x] Display renders after API check.
* [x] Enforce pass min/max lengths in dashboard's change password form.
* [ ] Add a copy all links to clipboard when there are more than 2 uploads in homepage's uploads history.
* [x] Update fb_share.png.
* [x] I forsaked all `Promise.all()` in favor of `await-in-for-loop` a while back. I personally think it was fine, considering a lot of them were tasks that required serial processing (continuation be dependant on previous iterations), but maybe I should review the current codes to find any sections that would do just fine, or maybe even great, with `Promise.all()`.
* [x] Black-ish colorscheme.
* [ ] Colorschemes option. Bring back the old dark grey colorscheme, and also add lolisafe's stock light colorscheme.  
I think it may be fair to load the colorscheming JS file before `style.css` gets loaded. Meaning the colorscheme script in particular needs to be in HEAD tag, as opposed to the standard where we put all JS files at the end of BODY tag.  
Once this is implemented, default colorscheme should be the old dark grey.
* [ ] Turn `render.js` into a standalone script (don't use `page` window variable).  
Due to the fact that it needs to have `page` variable defined first, it can't ever be loaded before `home.js`.  
This may prevent proper async load of JS assets, which I'd like to look into, in pursuit of even more speed.
* [ ] Remember last pages of uploads & users lists.  
Consider remembering last pages of each individual albums as well. When deleting an album, properly delete its remembered last page, if any. When listing albums sidebar and/or listing albums in Manage your albums, also delete remembered last pages of any missing albums (assume the albums were deleted from another device).
* [x] Descriptive upload progress, such as upload speed. Also tell user which chunk is currently being uploaded, to avoid confusion when progress "stops" when shifting to the next chunk.
* [ ] Delete own account feature. Since we already have delete user API endpoint, which also already includes the ability to delete uploads associated with the account, it should be easy to expand it a little to allow deleting own account and uploads.
* [ ] Add uploads date filter, possibly with support for range and operators (e.g. less than, more than, etc). Should convert human-readable date inputs locally into unix timestamps, so users can just follow their local timezones, since dates will already be displayed using their browser's timezone.
* [ ] Add uploads sorting feature. Attempt to make this work even when using filters.
* [ ] Add expirydate flags for uploads filter.

Low priority:

* [x] Parallel URL uploads.
* [x] Delete user feature.
* [ ] Bulk delete user feature.
* [ ] Bulk disable user feature.
* [x] Strip EXIF from images. [#51](https://github.com/BobbyWibowo/lolisafe/issues/51)
* [x] DMCA request logs (bare text file will do), and link it in FAQ.  
This should also include list of files that also had to be manually deleted due to triggering Google's SafeSearch (harmful downloads, etc).

Lowest priority:

* [ ] Find a way to detect whether a user had disabled their browser's built-in smooth scrolling capability. We will then use that to decide whether we should use smooth scrolling when auto-scrolling during navigation (for now smooth scrolling is always enabled; and polified if applicable).
* [ ] Support [fragments](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Identifying_resources_on_the_Web#Fragment) for dashboard sidebar menus.
* [ ] When registering a new account, check for existing account(s) with the same username case-insesitively (for people who forgets how exactly they wrote their username). But still forces case-sensitivity when trying to login (cause this is a considerable security layer).  
**Downgraded to lowest priority:** This seems pretty annoying to implement (using either `like` operator or `upper` function seem pretty slow-ish). It seems to be a much better idea to force [nocase collation](https://www.sqlite.org/datatype3.html#collating_sequences) onto username column instead. It'll also improve performance when querying users table by username. But that requires rebuilding existing users table and sacrificing duplicates, which makes it not that good of an idea either.
* [ ] Perhaps consider switching from [Express](https://github.com/expressjs/express) to [Fastify](https://github.com/fastify/fastify)?
* [ ] Multi-level sub dirs for uploads. [#51](https://github.com/BobbyWibowo/lolisafe/issues/51)
* [ ] Mime type blacklist. [#51](https://github.com/BobbyWibowo/lolisafe/issues/51)
* [ ] Cluster mode (multi-core support). [#50](https://github.com/BobbyWibowo/lolisafe/issues/50)
* [ ] Tiered accounts. [#51](https://github.com/BobbyWibowo/lolisafe/issues/51)
