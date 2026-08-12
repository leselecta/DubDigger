/**
 * Tell the engines that take a ping that the site has changed.
 *
 *   npm run indexnow --workspace web
 *
 * One POST to api.indexnow.org, which fans out to Bing, Yandex, Seznam and
 * Naver. Google does not participate and never has: it finds the sitemap the
 * ordinary way, through Search Console and its own crawl.
 *
 * Run it AFTER the deploy is live, not before. Ownership is proved by fetching
 * the key file off the site itself, so a ping that arrives ahead of the upload
 * is rejected — and the URL list is read from the deployed sitemap for the same
 * reason: whatever is actually being served is what gets submitted.
 */
const ORIGIN = "https://dubdigger.com";
const KEY = "0dcb9138ef98de999623c2ca5f579208";

const sitemap = await fetch(`${ORIGIN}/sitemap.xml`);
if (!sitemap.ok) {
  console.error(`sitemap: ${sitemap.status} ${sitemap.statusText}. Is the deploy live?`);
  process.exit(1);
}

const urlList = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url);
if (urlList.length === 0) {
  console.error("The sitemap is being served but lists nothing. Not pinging.");
  process.exit(1);
}

const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    host: new URL(ORIGIN).host,
    key: KEY,
    keyLocation: `${ORIGIN}/${KEY}.txt`,
    urlList,
  }),
});

// 200 and 202 both mean accepted. 403 is the key file failing to check out and
// 422 is a URL that does not belong to the host, but a 403 on the first ping
// after a new key goes up is worth simply retrying: the run on 2026-08-12 gave
// one, and the identical request succeeded a minute later with nothing changed
// on the site, which reads as validation happening on the back of that first
// request rather than anything being wrong.
console.log(`${response.status} ${response.statusText} — ${urlList.length} URLs submitted`);
process.exit(response.ok ? 0 : 1);
