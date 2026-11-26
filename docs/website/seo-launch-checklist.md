# Search launch checklist (owner)

The code side is done (ADR 0047). These steps happen in Google and Cloudflare accounts, which only the owner can do.

## 1. Google Search Console (proves you own the site and gets it crawled)
1. Go to search.google.com/search-console, **Add property** and choose **Domain**, entering `meatsaroundtheworld.site`.
2. Google shows a TXT record. In Cloudflare, DNS, **Add record**: type `TXT`, name `@`, content = the value Google gave. Save, then click **Verify** in Search Console. It can take a few minutes.
3. In Search Console, **Sitemaps**: submit `https://www.meatsaroundtheworld.site/sitemap.xml`.
4. **URL inspection**: enter `https://www.meatsaroundtheworld.site/` and click **Request indexing**. Repeat for `/menu`.

## 2. Google Business Profile (the panel on the right of the search results)
1. Edit the profile and set **Website** to exactly `https://www.meatsaroundtheworld.site`.
2. Make the name, hours (12–8 pm daily) and city match the site. If each location has its own profile, link each one to the same website.
3. When you are ready, send the street address and phone (if any) for each location exactly as on the profile. The site will then publish them in its structured data, which strengthens the match.

## 3. Bing (optional, a few minutes)
Bing Webmaster Tools can import the site straight from Search Console once step 1 is done.

## What to expect
- Google usually crawls a newly submitted site within days; ranking for the exact name usually follows within one to four weeks. No one can guarantee a position.
- Searches for the exact name with a matching Business Profile are the easiest to win. Broader searches ("Brazilian food Provo") take reviews, links from local sites and time.

## How to check
- Search Console, **Pages**: the five public pages should show as indexed.
- Google's Rich Results Test (search.google.com/test/rich-results) on the home page should find the Organization and Restaurant data.
