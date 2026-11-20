(function () {
  const SITE_URL = "https://folio-bookshop.onrender.com";
  const DEFAULT_IMAGE = SITE_URL + "/assets/logo.png";
  const DEFAULT_DESCRIPTION =
    "Folio is a bookshop and online school — buy and sell books, join courses, teach as a tutor, and share on Social.";

  function absoluteUrl(pathOrUrl) {
    if (!pathOrUrl) return SITE_URL + "/";
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    if (pathOrUrl.startsWith("/")) return SITE_URL + pathOrUrl;
    return SITE_URL + "/" + pathOrUrl.replace(/^\.\//, "");
  }

  function upsertMeta(selectorAttr, key, content) {
    if (!content) return;
    let el = document.head.querySelector(`meta[${selectorAttr}="${key}"]`);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(selectorAttr, key);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  }

  function upsertLink(rel, href) {
    if (!href) return;
    let el = document.head.querySelector(`link[rel="${rel}"]`);
    if (!el) {
      el = document.createElement("link");
      el.setAttribute("rel", rel);
      document.head.appendChild(el);
    }
    el.setAttribute("href", href);
  }

  function upsertJsonLd(id, data) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("script");
      el.type = "application/ld+json";
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(data);
  }

  function settingsSeo() {
    try {
      if (window.FolioAuth && typeof FolioAuth.getSettings === "function") {
        return FolioAuth.getSettings() || {};
      }
    } catch (_) {}
    return {};
  }

  function applyPage(options) {
    const opts = options || {};
    const s = settingsSeo();
    const title =
      opts.title ||
      s.seoTitle ||
      (s.storeName ? s.storeName + " — Books for every chapter" : "Folio — Books for every chapter");
    const description = opts.description || s.seoDescription || DEFAULT_DESCRIPTION;
    const keywords =
      opts.keywords ||
      s.seoKeywords ||
      "Folio, bookstore, online courses, tutors, buy books, sell books, learning";
    const image = absoluteUrl(opts.image || s.seoOgImage || DEFAULT_IMAGE);
    const path = opts.path || location.pathname.replace(/^\//, "") || "index.html";
    const canonical = absoluteUrl(opts.canonical || path);
    const type = opts.type || "website";

    document.title = title;
    upsertMeta("name", "description", description);
    upsertMeta("name", "keywords", keywords);
    upsertMeta("name", "author", s.storeName || "Folio");
    upsertMeta("name", "theme-color", "#1f6b4a");
    upsertMeta("property", "og:site_name", s.storeName || "Folio");
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:type", type);
    upsertMeta("property", "og:url", canonical);
    upsertMeta("property", "og:image", image);
    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);
    upsertMeta("name", "twitter:image", image);
    upsertLink("canonical", canonical);
    upsertLink("icon", absoluteUrl("/assets/logo.png"));

    if (opts.noindex) {
      upsertMeta("name", "robots", "noindex, nofollow");
    } else {
      upsertMeta("name", "robots", "index, follow, max-image-preview:large");
    }

    if (opts.jsonLd) {
      upsertJsonLd("folio-jsonld", opts.jsonLd);
    }

    return { title, description, canonical, image };
  }

  function applyHome() {
    const s = settingsSeo();
    return applyPage({
      title: s.seoTitle || "Folio — Books for every chapter",
      description: s.seoDescription || DEFAULT_DESCRIPTION,
      path: "index.html",
      image: s.seoOgImage || "/assets/hero-books.jpg",
      jsonLd: {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Organization",
            name: s.storeName || "Folio",
            url: SITE_URL,
            logo: absoluteUrl("/assets/logo.png"),
            email: s.supportEmail || "help@folio.com",
            sameAs: [SITE_URL + "/social.html"],
          },
          {
            "@type": "WebSite",
            name: s.storeName || "Folio",
            url: SITE_URL,
            description: s.seoDescription || DEFAULT_DESCRIPTION,
            potentialAction: {
              "@type": "SearchAction",
              target: SITE_URL + "/index.html?q={search_term_string}",
              "query-input": "required name=search_term_string",
            },
          },
        ],
      },
    });
  }

  function applyCourses() {
    const s = settingsSeo();
    const courses =
      window.FolioAuth && FolioAuth.getLiveCourses
        ? FolioAuth.getLiveCourses()
        : window.FolioAuth && FolioAuth.getCourses
          ? FolioAuth.getCourses().filter((c) => c.status === "live")
          : [];
    return applyPage({
      title: "Courses — " + (s.storeName || "Folio"),
      description:
        "Browse Folio courses from approved tutors. Learn at your pace with lessons, chapter videos, and class tests.",
      path: "courses.html",
      image: "/assets/path-courses.jpg",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "Folio courses",
        itemListElement: (courses || []).slice(0, 20).map((c, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: absoluteUrl("course.html?id=" + encodeURIComponent(c.id)),
          name: c.title,
        })),
      },
    });
  }

  function applySocialPost(post) {
    if (!post) {
      return applyPage({
        title: "Post — Folio Social",
        description: "Read community updates on Folio Social.",
        path: "social-post.html",
        noindex: true,
      });
    }
    const body = String(post.body || post.excerpt || post.title || "").trim();
    return applyPage({
      title: (body.slice(0, 60) || "Post") + " — Folio Social",
      description: body.slice(0, 160) || "A Folio Social update.",
      path: "social-post.html?id=" + encodeURIComponent(post.id),
      canonical: "social-post.html?id=" + encodeURIComponent(post.id),
      image: post.coverImage || "/assets/logo.png",
      type: "article",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "SocialMediaPosting",
        headline: post.title || body.slice(0, 80),
        articleBody: body,
        datePublished: post.createdAt,
        author: {
          "@type": "Person",
          name: post.authorName || "Folio member",
        },
        image: post.coverImage ? [post.coverImage] : undefined,
        url: absoluteUrl("social-post.html?id=" + encodeURIComponent(post.id)),
      },
    });
  }

  window.FolioSEO = {
    SITE_URL,
    absoluteUrl,
    applyPage,
    applyHome,
    applyCourses,
    applySocialPost,
    defaults: {
      description: DEFAULT_DESCRIPTION,
      image: DEFAULT_IMAGE,
    },
  };
})();
