import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type Platform = "instagram" | "facebook" | "tiktok" | "youtube" | "other";

type ContentType = "profile" | "reel" | "video" | "post" | "website" | "unknown";

type MetaResult = {
  platform: Platform;
  contentType: ContentType;
  url: string;
  ogTitle: string | null;
  ogDescription: string | null;
  ogSiteName: string | null;
  pageTitle: string | null;
  metaDescription: string | null;
  jsonLd: string | null;
  handle: string | null;
  rawText: string | null;
  oembedTitle: string | null;
  oembedAuthor: string | null;
  oembedHtml: string | null;
  fetched: boolean;
};

function detectPlatform(url: string): Platform {
  const lower = url.toLowerCase();
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("facebook.com") || lower.includes("fb.com")) return "facebook";
  if (lower.includes("tiktok.com")) return "tiktok";
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  return "other";
}

function detectContentType(url: string, platform: Platform): ContentType {
  const lower = url.toLowerCase();
  if (platform === "instagram") {
    if (lower.includes("/reel/") || lower.includes("/reels/")) return "reel";
    if (lower.includes("/p/")) return "post";
    if (lower.includes("/tv/")) return "video";
    return "profile";
  }
  if (platform === "facebook") {
    if (lower.includes("/watch") || lower.includes("/video") || lower.includes("/videos")) return "video";
    if (lower.includes("/reel")) return "reel";
    if (lower.includes("/posts/")) return "post";
    return "profile";
  }
  if (platform === "tiktok") {
    if (lower.includes("/video/")) return "video";
    return "profile";
  }
  if (platform === "youtube") return "video";
  return "website";
}

// Extract creator handle from Instagram og:title patterns like:
//   "PMC Cafe on Instagram"
//   "Brazico Brazilian Churrasco on Instagram: \"...\""
// Returns the username/venue name portion, or null.
function extractHandleFromOgTitle(ogTitle: string | null): string | null {
  if (!ogTitle) return null;
  const m = ogTitle.match(/^(.+?)\s+on\s+Instagram\b/i);
  return m ? m[1].trim() : null;
}

function extractHandle(url: string, platform: Platform): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;

    if (platform === "instagram") {
      if (["p", "reel", "reels", "tv", "stories"].includes(parts[0])) return null;
      return parts[0];
    }
    if (platform === "facebook") {
      if (parts[0] === "pages" && parts.length >= 3) return parts[2];
      if (["profile.php", "groups", "events", "watch"].includes(parts[0])) return null;
      return parts[0];
    }
    if (platform === "tiktok") {
      if (parts[0].startsWith("@")) return parts[0].slice(1);
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

function extractMeta(html: string): {
  ogTitle: string | null;
  ogDescription: string | null;
  ogSiteName: string | null;
  pageTitle: string | null;
  metaDescription: string | null;
  jsonLd: string | null;
  rawText: string | null;
} {
  const getMeta = (property: string): string | null => {
    const re = new RegExp(
      `<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
      "i"
    );
    const m = html.match(re);
    if (m) return m[1];
    // Try reversed order: content before property
    const re2 = new RegExp(
      `<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`,
      "i"
    );
    const m2 = html.match(re2);
    return m2 ? m2[1] : null;
  };

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const pageTitle = titleMatch ? titleMatch[1].trim() : null;

  const ogTitle = getMeta("og:title");
  const ogDescription = getMeta("og:description");
  const ogSiteName = getMeta("og:site_name");
  const metaDescription = getMeta("description");

  // Extract JSON-LD blocks
  const jsonLdMatches = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  const jsonLdBlocks: string[] = [];
  for (const m of jsonLdMatches) {
    jsonLdBlocks.push(m[1].trim());
  }
  const jsonLd = jsonLdBlocks.length > 0 ? jsonLdBlocks.join("\n") : null;

  // Extract visible text (strip scripts, styles, tags)
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  // Cap to avoid huge payloads — higher for video/reel content which needs more context
  if (text.length > 6000) text = text.slice(0, 6000);
  const rawText = text || null;

  return { ogTitle, ogDescription, ogSiteName, pageTitle, metaDescription, jsonLd, rawText };
}

async function fetchWithHeaders(
  url: string,
  mobile: boolean
): Promise<string | null> {
  try {
    const ua = mobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1"
      : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    const res = await fetch(url, {
      headers: {
        "User-Agent": ua,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html;
  } catch {
    return null;
  }
}

// Parse caption text and author from Instagram/Facebook oEmbed HTML.
// The embed HTML is a static blockquote — the caption is NOT in it (it's
// loaded by Instagram's embed.js script at runtime). But the embed HTML
// DOES contain the permalink URL, which the AI can use for web search.
function parseMetaOEmbedHtml(
  html: string,
  platform: Platform
): { title: string | null; author: string | null } {
  let title: string | null = null;
  let author: string | null = null;

  // Extract permalink from embed HTML — this is the canonical post URL
  const permalinkMatch = html.match(
    /data-instgrm-permalink=["'](https?:\/\/[^"']+)["']/i
  );
  if (permalinkMatch) {
    const permalink = permalinkMatch[1];
    // For Facebook, the author username is in the permalink path
    if (platform === "facebook") {
      try {
        const parts = new URL(permalink).pathname.split("/").filter(Boolean);
        if (parts.length >= 1) author = parts[0];
      } catch {
        // ignore
      }
    }
    // Use the permalink as the "title" so the AI has a searchable URL
    // when the HTML scrape returned nothing useful
    title = permalink;
  }

  return { title: title || null, author: author || null };
}

// Convert Instagram reel URL to post URL for oEmbed API compatibility
function instagramReelToPostUrl(url: string): string {
  // /reel/CODE/ -> /p/CODE/  (oEmbed only accepts /p/ URLs)
  return url.replace(/\/reel\//i, "/p/").replace(/\/reels\//i, "/p/");
}

async function fetchMetaOEmbed(
  url: string,
  platform: Platform,
  contentType: ContentType
): Promise<{ title: string | null; author: string | null; html: string | null } | null> {
  try {
    let endpoint: string;
    let oembedUrl: string;

    if (platform === "instagram") {
      // Instagram oEmbed only accepts /p/ URLs, not /reel/ URLs
      const postUrl = contentType === "reel" ? instagramReelToPostUrl(url) : url;
      // Only works for posts and reels, not profiles
      if (contentType === "profile") return null;
      endpoint = "instagram_oembed";
      oembedUrl = `https://graph.facebook.com/v21.0/${endpoint}?url=${encodeURIComponent(postUrl)}`;
    } else if (platform === "facebook") {
      // Facebook oEmbed — posts and videos
      if (contentType === "profile") return null;
      if (contentType === "video") {
        endpoint = "oembed_video";
      } else {
        endpoint = "oembed_post";
      }
      oembedUrl = `https://graph.facebook.com/v21.0/${endpoint}?url=${encodeURIComponent(url)}`;
    } else {
      return null;
    }

    const res = await fetch(oembedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;

    const embedHtml = typeof data.html === "string" ? data.html : null;
    const parsed = embedHtml ? parseMetaOEmbedHtml(embedHtml, platform) : { title: null, author: null };

    return {
      title: parsed.title,
      author: parsed.author,
      html: embedHtml,
    };
  } catch {
    return null;
  }
}

async function fetchTikTokOEmbed(
  videoUrl: string
): Promise<{ title: string | null; author: string | null } | null> {
  try {
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`;
    const res = await fetch(oembedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.message || data.code) return null;
    const title = typeof data.title === "string" ? data.title.trim() : null;
    const author =
      typeof data.author_name === "string" ? data.author_name.trim() : null;
    return { title: title || null, author: author || null };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const platform = detectPlatform(url);
    const contentType = detectContentType(url, platform);
    const handle = extractHandle(url, platform);

    // Kick off oEmbed and HTML scrape in parallel for maximum speed
    const oembedPromises: Promise<{ title: string | null; author: string | null; html: string | null } | null>[] = [];

    // Meta oEmbed for Instagram posts/reels and Facebook posts/videos
    if (
      (platform === "instagram" && (contentType === "post" || contentType === "reel")) ||
      (platform === "facebook" && (contentType === "post" || contentType === "video" || contentType === "reel"))
    ) {
      oembedPromises.push(fetchMetaOEmbed(url, platform, contentType));
    } else {
      oembedPromises.push(Promise.resolve(null));
    }

    // TikTok oEmbed for TikTok videos
    if (platform === "tiktok" && contentType === "video") {
      oembedPromises.push(
        fetchTikTokOEmbed(url).then((r) =>
          r ? { ...r, html: null } : null
        )
      );
    } else {
      oembedPromises.push(Promise.resolve(null));
    }

    // HTML scrape — try mobile UA first for Instagram reels, desktop for everything else
    const scrapePromise = (async () => {
      if (platform === "instagram" && contentType === "reel") {
        let h = await fetchWithHeaders(url, true);
        if (!h) h = await fetchWithHeaders(url, false);
        if (!h) {
          const variant = url.includes("?") ? url + "&__d=1" : url + "?__d=1";
          h = await fetchWithHeaders(variant, true);
        }
        return h;
      } else {
        return await fetchWithHeaders(url, false);
      }
    })();

    const [metaOembed, tiktokOembed, html] = await Promise.all([
      oembedPromises[0],
      oembedPromises[1],
      scrapePromise,
    ]);

    // Merge oEmbed data
    let oembedTitle: string | null = null;
    let oembedAuthor: string | null = null;
    let oembedHtml: string | null = null;

    if (metaOembed) {
      oembedTitle = metaOembed.title;
      oembedAuthor = metaOembed.author;
      oembedHtml = metaOembed.html;
    }
    if (tiktokOembed) {
      oembedTitle = tiktokOembed.title || oembedTitle;
      oembedAuthor = tiktokOembed.author || oembedAuthor;
    }

    // If HTML scrape failed, return whatever we have from oEmbed
    if (!html) {
      const result: MetaResult = {
        platform,
        contentType,
        url,
        ogTitle: null,
        ogDescription: null,
        ogSiteName: null,
        pageTitle: null,
        metaDescription: null,
        jsonLd: null,
        handle,
        rawText: null,
        oembedTitle,
        oembedAuthor,
        oembedHtml,
        fetched: oembedTitle !== null || oembedAuthor !== null,
      };
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const meta = extractMeta(html);

    // Prefer oEmbed title/author if HTML scrape returned generic data
    // (e.g. Instagram returns just "Instagram" as page title).
    // But don't override with a permalink URL — that's not a real title.
    const isGenericTitle =
      !meta.ogTitle ||
      meta.ogTitle === "Instagram" ||
      meta.ogTitle === "Facebook" ||
      meta.ogTitle === "TikTok" ||
      meta.ogTitle === "TikTok - Make Your Day" ||
      meta.ogTitle === "YouTube";

    const oembedIsUrl = oembedTitle ? /^https?:\/\//.test(oembedTitle) : false;

    const finalOgTitle =
      isGenericTitle && oembedTitle && !oembedIsUrl ? oembedTitle : meta.ogTitle;
    const finalOgDescription =
      (!meta.ogDescription || meta.ogDescription === meta.ogTitle) && oembedTitle && !oembedIsUrl
        ? oembedTitle
        : meta.ogDescription;

    // For Instagram reels/posts, the URL-based handle is null (the path is /reel/CODE/).
    // Try to recover the creator name from og:title ("Venue Name on Instagram").
    const ogTitleHandle =
      platform === "instagram" && !handle
        ? extractHandleFromOgTitle(meta.ogTitle)
        : null;

    const result: MetaResult = {
      platform,
      contentType,
      url,
      ogTitle: finalOgTitle,
      ogDescription: finalOgDescription,
      ogSiteName: meta.ogSiteName,
      pageTitle: meta.pageTitle,
      metaDescription: meta.metaDescription,
      jsonLd: meta.jsonLd,
      handle: handle || oembedAuthor || ogTitleHandle,
      rawText: meta.rawText,
      oembedTitle,
      oembedAuthor,
      oembedHtml,
      fetched: true,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
