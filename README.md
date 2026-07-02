# Expedia Car GraphQL Inspector

**Version 2.5** — A browser tool that captures Expedia car rental data quickly and reliably.

---

## Overview

When you search for rental cars on Expedia, your browser asks Expedia's servers for data, then formats it into a nice-looking page. This script **intercepts that raw data** before it gets formatted, collects every single car listing across all pages in seconds, and exports it to a spreadsheet-ready CSV file.

**Think of it like this:** Instead of manually copying each page of results (taking screenshots, typing out prices), you're getting the original data file that Expedia sent to your browser — complete, structured, and instant.

---

## Prerequisites

This script is a **userscript** — a small program that runs inside your browser on top of specific websites. To run it, you need a userscript manager extension.

### Install a Userscript Manager

Choose **one** of these free extensions:

| Extension | Chrome Web Store Link |
|---|---|
| **Tampermonkey** (recommended) | [Install Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) |
| **Violentmonkey** (alternative) | [Install Violentmonkey](https://chromewebstore.google.com/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag) |

Both are free, open-source, and trusted by millions of users.

> **What is a userscript manager?** It's like a "plugin system" for your browser. It lets you install custom scripts that add features to websites. Just like how you install an ad blocker, you install Tampermonkey, then give it scripts to run.

---

## Installation

### Step 1: Create a New Script

Click the Tampermonkey icon in your browser toolbar and select **"Create a new script..."**

### Step 2: Replace the Default Code

A new tab will open with some default template code. **Delete everything** in the editor and paste the entire contents of `Expedia Data Extractor.js`.

### Step 3: Save

Press **Ctrl + S** (Windows) or **Cmd + S** (Mac) to save. Tampermonkey will now run this script whenever you visit `expedia.com`.

### Step 4: Use It

1. Go to [Expedia Car Rentals](https://www.expedia.com/carsearch)
2. Search for a location and dates
3. A dark floating panel labeled **"Expedia GraphQL Inspector"** will appear in the top-right corner of the page
4. The script starts **automatically** — you'll see the page counter go up as it captures results

---

## How It Works

**In simple terms:**

1. When you search for cars, Expedia's server sends a data packet (called a GraphQL response) to your browser
2. This script copies that data packet before your browser turns it into the visual page
3. It automatically requests the next page of results, and the next, until all cars are collected
4. When finished, it exports everything to a **CSV file** that you can open in Excel or Google Sheets

**No clicking "Load More" manually.** No copy-pasting. No waiting for pages to render.

A **live progress bar** shows you exactly where you are — page count, percentage complete, and elapsed time — so you always know how the auto-load is progressing.

---

## Features

| Feature | What It Does |
|---|---|
| **Auto Capture** | Captures every car listing automatically while you browse |
| **Auto Load All Pages** | Clicks through all paginated results — no manual clicking |
| **3 Speed Settings** | Slow (4s), Medium (1.5s), Fast (0.6s) — pick your pace |
| **Speed Memory** | Your speed choice is saved in your browser — stays across page refreshes |
| **Resume Support** | If you refresh the page, your captured data is restored (up to 200 pages) |
| **Auto CSV Export** | When auto-load finishes, a CSV downloads automatically |
| **CSV Export** | Exports to a clean spreadsheet with columns for price, supplier, dates, etc. |
| **Smart Retry** | Exponential backoff with Retry-After header support when the server asks you to slow down |
| **Deduplication** | Won't capture the same car listing twice across pages or sessions |
| **Progress Bar** | Live visual progress with percentage, page count, and elapsed time during auto-load |
| **Collapsible Panel** | Minimize or collapse sections to keep your screen clean |

---

## Button Guide — When to Click What

The panel has **6 buttons**. Here's exactly when to use each one:

| Button | Color | When to Click |
|---|---|---|
| **▶ Start** | Green | The script starts automatically. Only click this if you pressed **Stop** and want to resume capturing. |
| **■ Stop** | Red | Click to **pause** capturing. New page loads won't be recorded. Your existing data stays. |
| **↻ Auto** | Gold | **The main button.** Click this after your initial search results load. It will automatically load ALL remaining pages of car listings. A CSV downloads automatically when done. |
| **◼ Stop Auto** | Red | Click to stop the auto-load process mid-way. The data captured so far is kept. |
| **✕ Clear** | Gold | Removes **all captured data** from memory and clears the log. Start fresh without refreshing the page. |
| **⊞ CSV** | Blue | Downloads all captured data as a CSV file — **open this in Excel or Google Sheets**. |

### Typical Workflow

```
1. Search for cars on Expedia
   → Script starts capturing automatically

2. Click "↻ Auto" (the gold button)
   → Progress bar appears showing page count, percentage, and elapsed time
   → The first page is already captured — auto-load starts from page 2

3. When done, a CSV file downloads automatically
   → Open it in Excel — you're done!

4. (Optional) Click "✕ Clear" before a new search
   → Ready for the next run
```

---

## Speed Comparison: Why This Script Is Different

Traditional web scrapers (Python-based, Puppeteer, Playwright) work by **opening a hidden browser, loading each page, waiting for images and ads, locating the "Load More" button, clicking it, waiting again...** It's slow and fragile.

This script takes a completely different approach: it **speaks directly to Expedia's internal API** from within your real browser session.

| Aspect | Traditional Web Scraper | This Script |
|---|---|---|
| **Time for 700+ cars** | ~15 minutes | **~30 seconds** |
| **Approach** | Opens invisible browser, loads each HTML page, clicks buttons | Intercepts raw API data directly |
| **Reliability** | Breaks if Expedia changes button colors/positions | Works as long as the internal API structure stays the same |
| **CAPTCHA Risk** | High — headless browsers trigger CAPTCHAs | Zero — runs in **your** real logged-in browser |
| **Data Quality** | Parsed from HTML (messy, may miss fields) | Raw structured data (complete, accurate) |
| **You Need To** | Install Python, setup Playwright, manage proxies | Just install a browser extension |

> **30 seconds vs 15 minutes — that's the difference between tapping the source directly vs. copying it by hand.**

---

## Challenges & Benefits

### Challenges Solved

- **Pagination:** Expedia loads results page-by-page. This script navigates all pages automatically.
- **Deduplication:** Same car appearing in multiple pages or sessions? Skipped automatically.
- **Network Errors:** Temporary glitches? The script retries intelligently with exponential backoff.
- **Rate Limiting:** If Expedia asks you to slow down via Retry-After headers, the script listens and backs off to whatever the server requests.
- **Speed Control:** Too fast (rate limiting)? Too slow (wasting time)? Three speed presets let you tune it.

### Benefits Over Other Methods

- **Zero setup cost** — just install Tampermonkey and paste the script
- **No coding skills needed** — once installed, it's point-and-click
- **No external dependencies** — no Python, no Node.js, no Docker
- **Transparent** — you can see exactly what data is being captured in the log
- **Free & Open Source** — inspect, modify, share

---

## Limitations

- **Expedia Car Rentals Only** — Only captures the `CarSearchV3` query. Hotels, flights, and packages are not supported.
- **Requires a Userscript Manager** — Must have Tampermonkey or Violentmonkey installed.
- **Browser Dependent** — Runs in your browser. Closing the tab stops everything.
- **Data Structure Sensitivity** — If Expedia changes their internal API format significantly, the script may need updating.
- **First Page Required** — You must perform a search manually first; the auto-loader starts from the first page.

---

## FAQ

### Q: Is this against Expedia's Terms of Service?
Reading data from a website you are already visiting is generally acceptable. This script does **not** bypass login requirements, does **not** send automated requests faster than a human could, and does **not** access non-public data. Use responsibly.

### Q: Will I get banned or rate-limited?
No. The script adds delays between requests and respects Retry-After headers if the server asks you to slow down. It acts like a fast but reasonable user.

### Q: What does the progress bar show?
When you click **↻ Auto**, a progress bar appears below the speed selector. It reads the total number of cars from the Expedia page banner (like "102 Cars"), calculates how many pages remain, and shows:
- **Page X of Y** — which page is being loaded (starting from 1, the already-captured first page)
- **Percentage** — how far along the entire job is
- **⏱ MM:SS** — elapsed time since auto-load started

### Q: The panel doesn't appear. What's wrong?
1. Make sure Tampermonkey is enabled (click its icon → "Enabled")
2. Make sure you're on `https://www.expedia.com/*` (the URL must start with `https://www.expedia.com/`)
3. Refresh the page and wait 2-3 seconds
4. Check Tampermonkey's dashboard to confirm the script is listed and active

### Q: Can I use this on other websites (Kayak, Priceline, etc.)?
Not right now. This script is specifically written for Expedia's car rental GraphQL API. However, the same technique could be adapted for other sites.

### Q: How do I update the script to a new version?
1. Open the Tampermonkey Dashboard
2. Click on "Expedia GraphQL Inspector" in the list
3. Replace the code with the new version
4. Press **Ctrl + S** to save

### Q: Does it work with ad blockers?
Yes. Ad blockers (uBlock Origin, AdBlock) do not interfere with this script.

### Q: Which button do I click first?
After your initial search results load on Expedia, just click **↻ Auto** (the gold button). That's all you need — a CSV will download automatically when it finishes.

### Q: Can I run this in the background while I do other things?
Yes. Once you click **↻ Auto**, the script runs on its own. You can switch tabs or minimize the window. The data will be captured and the CSV will download automatically when finished.

### Q: The data didn't capture everything. What went wrong?
- **Make sure you're on the search results page** (after clicking "Search", not the homepage)
- **Check the speed setting** — if set to Fast, some requests might fail; try Medium
- **Look at the output log** — error messages (in red) will indicate what happened
- **Ensure the total car count is visible** on the results page for the progress bar to estimate correctly

---

*Expedia GraphQL Inspector v2.5 — Free and Open Source*
