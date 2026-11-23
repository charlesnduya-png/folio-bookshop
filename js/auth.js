(function () {
  const USERS_KEY = "folio_users";
  const SESSION_KEY = "folio_session";
  const LISTINGS_KEY = "folio_listings";
  const COLLECTION_KEY = "folio_collections";
  const ARCHIVES_KEY = "folio_archives";
  const ORDERS_KEY = "folio_orders";
  const NOTIFICATIONS_KEY = "folio_notifications";
  const REVIEWS_KEY = "folio_reviews";
  const WITHDRAWALS_KEY = "folio_withdrawals";
  const SETTINGS_KEY = "folio_settings";
  const COURSES_KEY = "folio_courses";
  const ENROLLMENTS_KEY = "folio_enrollments";
  const BLOG_KEY = "folio_blog_posts";
  const FOLLOWS_KEY = "folio_follows";
  const RATE_LIMIT_KEY = "folio_rate_limits";
  const DISPLAY_CURRENCY_KEY = "folio_display_currency";
  const DEFAULT_SETTINGS = {
    storeName: "Folio",
    supportEmail: "help@folio.com",
    feePercent: 12,
    tutorFeePercent: 25,
    currency: "USD",
    autoApproveBooks: "no",
    minWithdrawal: 10,
    tutorAnnualFee: 99,
    seoTitle: "Folio — Books for every chapter",
    seoDescription:
      "Folio is a bookshop and online school — buy and sell books, join courses, teach as a tutor, and share on Social.",
    seoKeywords: "Folio, bookstore, online courses, tutors, buy books, sell books, learning, Social",
    seoOgImage: "/assets/hero-books.jpg",
  };
  const PLATFORM_FEE_RATE = 0.12;
  const TUTOR_FEE_RATE = 0.25;
  const VIDEO_DB_NAME = "folio_course_videos";
  const VIDEO_STORE = "blobs";
  const MAX_VIDEO_BYTES = 80 * 1024 * 1024; // 80MB demo limit

  /** Sliding-window rate limits: action -> { limit, windowMs } */
  const RATE_LIMIT_RULES = {
    login: { limit: 5, windowMs: 15 * 60 * 1000 },
    register: { limit: 5, windowMs: 60 * 60 * 1000 },
    social_post: { limit: 12, windowMs: 60 * 60 * 1000 },
    social_comment: { limit: 40, windowMs: 60 * 60 * 1000 },
    follow: { limit: 60, windowMs: 60 * 60 * 1000 },
    profile_image: { limit: 10, windowMs: 60 * 60 * 1000 },
    book_listing: { limit: 20, windowMs: 60 * 60 * 1000 },
  };

  const memoryCache = new Map();
  let cacheEpoch = 0;

  function openVideoDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(VIDEO_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(VIDEO_STORE)) {
          db.createObjectStore(VIDEO_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Could not open video storage."));
    });
  }

  async function putVideoBlob(id, blob) {
    const db = await openVideoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VIDEO_STORE, "readwrite");
      tx.objectStore(VIDEO_STORE).put(blob, id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("Could not save video."));
    });
  }

  async function getVideoBlob(id) {
    const db = await openVideoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VIDEO_STORE, "readonly");
      const req = tx.objectStore(VIDEO_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error("Could not load video."));
    });
  }

  async function deleteVideoBlob(id) {
    const db = await openVideoDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VIDEO_STORE, "readwrite");
      tx.objectStore(VIDEO_STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error("Could not delete video."));
    });
  }

  // Approximate demo rates vs 1 USD (base store currency)
  const CURRENCIES = {
    USD: { code: "USD", label: "US Dollar", country: "us", symbol: "$", rate: 1, decimals: 2 },
    EUR: { code: "EUR", label: "Euro", country: "eu", symbol: "€", rate: 0.92, decimals: 2 },
    GBP: { code: "GBP", label: "British Pound", country: "gb", symbol: "£", rate: 0.79, decimals: 2 },
    CAD: { code: "CAD", label: "Canadian Dollar", country: "ca", symbol: "C$", rate: 1.36, decimals: 2 },
    AUD: { code: "AUD", label: "Australian Dollar", country: "au", symbol: "A$", rate: 1.53, decimals: 2 },
    KES: { code: "KES", label: "Kenyan Shilling", country: "ke", symbol: "KSh", rate: 129, decimals: 2 },
    UGX: { code: "UGX", label: "Ugandan Shilling", country: "ug", symbol: "USh", rate: 3700, decimals: 0 },
    NGN: { code: "NGN", label: "Nigerian Naira", country: "ng", symbol: "₦", rate: 1550, decimals: 2 },
    INR: { code: "INR", label: "Indian Rupee", country: "in", symbol: "₹", rate: 83, decimals: 2 },
    JPY: { code: "JPY", label: "Japanese Yen", country: "jp", symbol: "¥", rate: 150, decimals: 0 },
    ZAR: { code: "ZAR", label: "South African Rand", country: "za", symbol: "R", rate: 18.5, decimals: 2 },
  };

  function flagUrl(country) {
    return "https://flagcdn.com/w40/" + country + ".png";
  }

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    if (
      key === USERS_KEY ||
      key === BLOG_KEY ||
      key === FOLLOWS_KEY ||
      key === SESSION_KEY ||
      key === COURSES_KEY ||
      key === ENROLLMENTS_KEY ||
      key === LISTINGS_KEY ||
      key === ORDERS_KEY ||
      key === SETTINGS_KEY
    ) {
      invalidateCache();
    }
  }

  function invalidateCache() {
    cacheEpoch += 1;
    memoryCache.clear();
  }

  function cacheGet(key) {
    const hit = memoryCache.get(key);
    if (!hit) return null;
    if (hit.epoch !== cacheEpoch || hit.expiresAt <= Date.now()) {
      memoryCache.delete(key);
      return null;
    }
    return hit.value;
  }

  function cacheSet(key, value, ttlMs) {
    memoryCache.set(key, {
      value,
      epoch: cacheEpoch,
      expiresAt: Date.now() + Math.max(250, Number(ttlMs) || 5000),
    });
    return value;
  }

  function getRateBuckets() {
    const raw = read(RATE_LIMIT_KEY, {});
    return raw && typeof raw === "object" ? raw : {};
  }

  function saveRateBuckets(buckets) {
    localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(buckets));
  }

  function pruneTimestamps(list, windowMs, now) {
    return (Array.isArray(list) ? list : []).filter((ts) => now - ts < windowMs);
  }

  function checkRateLimit(action, subject) {
    const rule = RATE_LIMIT_RULES[action];
    if (!rule) return { ok: true, remaining: Infinity };
    const now = Date.now();
    const key = action + "::" + String(subject || "anon");
    const buckets = getRateBuckets();
    const stamps = pruneTimestamps(buckets[key], rule.windowMs, now);
    if (stamps.length >= rule.limit) {
      const retryAfterMs = Math.max(0, rule.windowMs - (now - stamps[0]));
      const mins = Math.ceil(retryAfterMs / 60000);
      return {
        ok: false,
        remaining: 0,
        retryAfterMs,
        error:
          action === "login"
            ? `Too many sign-in attempts. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`
            : `Rate limit reached. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`,
      };
    }
    return {
      ok: true,
      remaining: rule.limit - stamps.length,
      retryAfterMs: 0,
    };
  }

  function hitRateLimit(action, subject) {
    const rule = RATE_LIMIT_RULES[action];
    if (!rule) return { ok: true, remaining: Infinity };
    const now = Date.now();
    const key = action + "::" + String(subject || "anon");
    const buckets = getRateBuckets();
    const stamps = pruneTimestamps(buckets[key], rule.windowMs, now);
    stamps.push(now);
    buckets[key] = stamps;
    // Drop stale keys to keep storage small
    Object.keys(buckets).forEach((k) => {
      const actionName = k.split("::")[0];
      const r = RATE_LIMIT_RULES[actionName];
      buckets[k] = pruneTimestamps(buckets[k], r ? r.windowMs : 60 * 60 * 1000, now);
      if (!buckets[k].length) delete buckets[k];
    });
    saveRateBuckets(buckets);
    return {
      ok: stamps.length <= rule.limit,
      remaining: Math.max(0, rule.limit - stamps.length),
    };
  }

  function consumeRateLimit(action, subject) {
    const gate = checkRateLimit(action, subject);
    if (!gate.ok) return gate;
    hitRateLimit(action, subject);
    return { ok: true, remaining: Math.max(0, (gate.remaining || 1) - 1) };
  }

  function normalizeUserRecord(u) {
    if (!u || typeof u !== "object") return u;
    const next = {
      ...u,
      id: u.id || "u_" + Date.now(),
      name: String(u.name || "").trim() || "Member",
      email: String(u.email || "").trim().toLowerCase(),
      password: String(u.password || ""),
      role: u.role === "admin" ? "admin" : "customer",
      accountStatus: u.accountStatus === "suspended" ? "suspended" : "active",
      profileImage: typeof u.profileImage === "string" ? u.profileImage : "",
      sellerStatus: u.sellerStatus || "none",
      instructorStatus: u.instructorStatus || "none",
    };
    if (
      next.email === "tutor@folio.com" &&
      next.instructorStatus === "approved" &&
      typeof u.instructorMembershipExpiresAt === "undefined"
    ) {
      next.instructorMembershipPaidAt = new Date().toISOString();
      next.instructorMembershipExpiresAt = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000
      ).toISOString();
    }
    return next;
  }

  function normalizeSocialPost(p) {
    if (!p || typeof p !== "object") return null;
    const comments = Array.isArray(p.comments)
      ? p.comments
          .filter((c) => c && c.id && c.authorId && String(c.body || "").trim())
          .map((c) => ({
            id: c.id,
            authorId: c.authorId,
            authorName: c.authorName || "Member",
            body: String(c.body || "").trim(),
            createdAt: c.createdAt || new Date().toISOString(),
          }))
      : [];
    const body = String(p.body || "").trim();
    const coverImage = String(p.coverImage || "").trim();
    return {
      ...p,
      id: p.id || "blog_" + Date.now(),
      title: String(p.title || "").trim() || (body ? body.slice(0, 80) : "Photo update"),
      excerpt: String(p.excerpt || "").trim() || body.slice(0, 160),
      body,
      coverImage,
      authorId: p.authorId || "",
      authorName: p.authorName || "Folio",
      authorRole: p.authorRole || "",
      comments,
      status: p.status === "published" ? "published" : String(p.status || "published"),
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || p.createdAt || new Date().toISOString(),
    };
  }

  function normalizeFollow(f) {
    if (!f || !f.followerId || !f.followingId || f.followerId === f.followingId) return null;
    return {
      id: f.id || "fol_" + Date.now(),
      followerId: f.followerId,
      followingId: f.followingId,
      createdAt: f.createdAt || new Date().toISOString(),
    };
  }

  function normalizeSchema() {
    const users = read(USERS_KEY, []).map(normalizeUserRecord).filter(Boolean);
    write(USERS_KEY, users);
    const userIds = new Set(users.map((u) => u.id));

    const posts = read(BLOG_KEY, [])
      .map(normalizeSocialPost)
      .filter(Boolean)
      .map((p) => ({
        ...p,
        comments: (p.comments || []).filter((c) => userIds.has(c.authorId) || !c.authorId),
      }));
    write(BLOG_KEY, posts);

    const follows = read(FOLLOWS_KEY, [])
      .map(normalizeFollow)
      .filter(Boolean)
      .filter((f) => userIds.has(f.followerId) && userIds.has(f.followingId));
    write(FOLLOWS_KEY, follows);
  }

  function seed() {
    const users = read(USERS_KEY, null);
    if (!users) {
      write(USERS_KEY, [
        {
          id: "u_admin",
          name: "Folio Admin",
          email: "admin@folio.com",
          password: "admin123",
          role: "admin",
          accountStatus: "active",
          profileImage: "",
        },
        {
          id: "u_reader",
          name: "Maya Reader",
          email: "reader@folio.com",
          password: "reader123",
          role: "customer",
          accountStatus: "active",
          profileImage: "",
          sellerStatus: "approved",
          instructorStatus: "none",
        },
        {
          id: "u_teacher",
          name: "Sam Tutor",
          email: "tutor@folio.com",
          password: "tutor123",
          role: "customer",
          accountStatus: "active",
          profileImage: "",
          sellerStatus: "none",
          instructorStatus: "approved",
          instructorBio: "Literature and creative writing educator.",
          instructorMembershipPaidAt: new Date().toISOString(),
          instructorMembershipExpiresAt: new Date(
            Date.now() + 365 * 24 * 60 * 60 * 1000
          ).toISOString(),
        },
      ]);
    }
    if (!read(LISTINGS_KEY, null)) write(LISTINGS_KEY, []);
    if (!read(COLLECTION_KEY, null)) write(COLLECTION_KEY, {});
    if (!read(ARCHIVES_KEY, null)) write(ARCHIVES_KEY, {});
    if (!read(ORDERS_KEY, null)) write(ORDERS_KEY, []);
    if (!read(NOTIFICATIONS_KEY, null)) {
      write(NOTIFICATIONS_KEY, [
        {
          id: "n1",
          title: "Welcome to Folio Admin",
          body: "Review pending books and approve new vendors from this dashboard.",
          read: false,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
    if (!read(REVIEWS_KEY, null)) {
      write(REVIEWS_KEY, [
        {
          id: "r1",
          bookTitle: "Circe",
          reviewer: "Amina T.",
          rating: 5,
          comment: "Beautiful edition and fast delivery.",
          status: "published",
          createdAt: new Date().toISOString(),
        },
        {
          id: "r2",
          bookTitle: "Dune",
          reviewer: "Jonas K.",
          rating: 4,
          comment: "Great condition, packaging could be stronger.",
          status: "published",
          createdAt: new Date().toISOString(),
        },
      ]);
    }
    if (!read(WITHDRAWALS_KEY, null)) write(WITHDRAWALS_KEY, []);
    if (!read(SETTINGS_KEY, null)) write(SETTINGS_KEY, DEFAULT_SETTINGS);
    {
      const users = read(USERS_KEY, []);
      if (!users.some((u) => u.email === "tutor@folio.com")) {
        users.push({
          id: "u_teacher",
          name: "Sam Tutor",
          email: "tutor@folio.com",
          password: "tutor123",
          role: "customer",
          sellerStatus: "none",
          instructorStatus: "approved",
          instructorBio: "Literature and creative writing educator.",
          instructorMembershipPaidAt: new Date().toISOString(),
          instructorMembershipExpiresAt: new Date(
            Date.now() + 365 * 24 * 60 * 60 * 1000
          ).toISOString(),
        });
        write(USERS_KEY, users);
      }
    }
    {
      const settings = read(SETTINGS_KEY, DEFAULT_SETTINGS);
      if (settings.tutorAnnualFee == null || settings.tutorFeePercent == null) {
        write(SETTINGS_KEY, {
          ...settings,
          tutorAnnualFee:
            settings.tutorAnnualFee == null
              ? DEFAULT_SETTINGS.tutorAnnualFee
              : settings.tutorAnnualFee,
          tutorFeePercent:
            settings.tutorFeePercent == null
              ? DEFAULT_SETTINGS.tutorFeePercent
              : settings.tutorFeePercent,
        });
      }
    }
    {
      const seedCourses = [
        {
          id: "course_1",
          title: "Reading with Intention",
          description: "A guided course on deep reading, annotation, and keeping a personal reading journal.",
          instructorId: "u_teacher",
          instructorName: "Sam Tutor",
          price: 49,
          durationDays: 14,
          status: "live",
        },
        {
          id: "course_2",
          title: "Write Your First Short Story",
          description: "Structure, voice, and revision — finish one short story in three weeks.",
          instructorId: "u_teacher",
          instructorName: "Sam Tutor",
          price: 79,
          durationDays: 21,
          status: "live",
        },
        {
          id: "course_3",
          title: "Poetry for Everyday Life",
          description: "Find your voice through short poems, prompts, and gentle peer feedback.",
          instructorId: "u_teacher",
          instructorName: "Sam Tutor",
          price: 39,
          durationDays: 10,
          status: "live",
        },
        {
          id: "course_4",
          title: "Book Club Facilitation",
          description: "Learn how to host lively discussions, pick strong titles, and keep readers coming back.",
          instructorId: "u_teacher",
          instructorName: "Sam Tutor",
          price: 59,
          durationDays: 14,
          status: "live",
        },
        {
          id: "course_5",
          title: "Children’s Storytime Skills",
          description: "Voice, pacing, and engagement techniques for reading aloud to young listeners.",
          instructorId: "u_teacher",
          instructorName: "Sam Tutor",
          price: 45,
          durationDays: 12,
          status: "live",
        },
        {
          id: "course_6",
          title: "Nonfiction That Hooks",
          description: "Outline essays and reported pieces that stay clear, vivid, and readable.",
          instructorId: "u_teacher",
          instructorName: "Sam Tutor",
          price: 69,
          durationDays: 18,
          status: "live",
        },
        {
          id: "course_7",
          title: "Build a Reading Habit",
          description: "Practical systems for reading more without burnout — tracking, goals, and recovery days.",
          instructorId: "u_teacher",
          instructorName: "Sam Tutor",
          price: 29,
          durationDays: 7,
          status: "live",
        },
        {
          id: "course_8",
          title: "Classic Literature, Fresh Eyes",
          description: "Revisit major classics with modern context, discussion guides, and close-reading drills.",
          instructorId: "u_teacher",
          instructorName: "Sam Tutor",
          price: 89,
          durationDays: 28,
          status: "live",
        },
      ];
      const existing = read(COURSES_KEY, null) || [];
      const byId = new Map(existing.map((c) => [c.id, c]));
      seedCourses.forEach((course) => {
        if (!byId.has(course.id)) {
          byId.set(course.id, { ...course, createdAt: new Date().toISOString() });
        }
      });
      write(COURSES_KEY, [...byId.values()]);
    }
    if (!read(ENROLLMENTS_KEY, null)) write(ENROLLMENTS_KEY, []);
    if (!read(BLOG_KEY, null)) write(BLOG_KEY, []);
    if (!read(FOLLOWS_KEY, null)) write(FOLLOWS_KEY, []);
    normalizeSchema();
  }

  seed();

  window.FolioAuth = {
    getUsers() {
      const cached = cacheGet("users");
      if (cached) return cached;
      return cacheSet("users", read(USERS_KEY, []), 4000);
    },

    invalidateCache() {
      invalidateCache();
    },

    checkRateLimit(action, subject) {
      return checkRateLimit(action, subject);
    },

    getRateLimitRules() {
      return { ...RATE_LIMIT_RULES };
    },

    getSession() {
      return read(SESSION_KEY, null);
    },

    getCurrentUser() {
      const session = this.getSession();
      if (!session) return null;
      const user = this.getUsers().find((u) => u.id === session.userId) || null;
      if (user && this.isAccountSuspended(user)) {
        this.logout();
        return null;
      }
      return user;
    },

    isAccountSuspended(user) {
      return !!(user && user.accountStatus === "suspended");
    },

    canPostToSocial(user) {
      if (!user || this.isAccountSuspended(user)) return false;
      if (user.role === "admin") return true;
      if (user.role !== "customer") return false;
      return true;
    },

    socialRoleLabel(user) {
      if (!user) return "Member";
      if (user.role === "admin") return "Admin";
      if (user.instructorStatus === "approved") return "Tutor";
      return "Student";
    },

    register({
      name,
      email,
      password,
      asInstructor,
      instructorBio,
      instructorPhone,
      instructorSubjects,
      instructorExperience,
      instructorCredentials,
      instructorMotivation,
      instructorWebsite,
    }) {
      const users = this.getUsers();
      const cleanEmail = String(email || "").trim().toLowerCase();
      if (!name || !cleanEmail || !password) {
        return { ok: false, error: "Please fill in all fields." };
      }
      const rate = consumeRateLimit("register", "browser");
      if (!rate.ok) return { ok: false, error: rate.error };
      if (users.some((u) => u.email === cleanEmail)) {
        return { ok: false, error: "That email is already registered." };
      }

      if (asInstructor) {
        const bio = String(instructorBio || "").trim();
        const subjects = String(instructorSubjects || "").trim();
        const experience = String(instructorExperience || "").trim();
        const credentials = String(instructorCredentials || "").trim();
        const motivation = String(instructorMotivation || "").trim();
        const phone = String(instructorPhone || "").trim();
        if (!bio || !subjects || !experience || !credentials || !motivation || !phone) {
          return {
            ok: false,
            error: "Tutor signup needs phone, subjects, experience, credentials, bio, and motivation.",
          };
        }
      }

      const user = {
        id: "u_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        name: String(name).trim(),
        email: cleanEmail,
        password: String(password),
        role: "customer",
        accountStatus: "active",
        profileImage: "",
        sellerStatus: "none",
        instructorStatus: asInstructor ? "pending" : "none",
        instructorBio: asInstructor ? String(instructorBio || "").trim() : "",
        instructorPhone: asInstructor ? String(instructorPhone || "").trim() : "",
        instructorSubjects: asInstructor ? String(instructorSubjects || "").trim() : "",
        instructorExperience: asInstructor ? String(instructorExperience || "").trim() : "",
        instructorCredentials: asInstructor ? String(instructorCredentials || "").trim() : "",
        instructorMotivation: asInstructor ? String(instructorMotivation || "").trim() : "",
        instructorWebsite: asInstructor ? String(instructorWebsite || "").trim() : "",
      };
      users.push(user);
      write(USERS_KEY, users);
      write(SESSION_KEY, { userId: user.id });
      return { ok: true, user };
    },

    updateUser(id, patch) {
      const users = this.getUsers().map((u) => (u.id === id ? { ...u, ...patch } : u));
      write(USERS_KEY, users);
      return this.getUsers().find((u) => u.id === id) || null;
    },

    applyAsTutor({
      userId,
      instructorPhone,
      instructorSubjects,
      instructorExperience,
      instructorCredentials,
      instructorBio,
      instructorMotivation,
      instructorWebsite,
    }) {
      const user = this.getUsers().find((u) => u.id === userId);
      if (!user || user.role !== "customer") {
        return { ok: false, error: "Sign in to a customer account to apply." };
      }
      if (this.isTutorBanned(user)) {
        return { ok: false, error: "Your tutor account is banned. Contact support." };
      }
      if (user.instructorStatus === "pending") {
        return { ok: false, error: "Your tutor application is already pending review." };
      }
      if (user.instructorStatus === "approved") {
        return { ok: false, error: "You are already approved as a tutor." };
      }

      const phone = String(instructorPhone || "").trim();
      const subjects = String(instructorSubjects || "").trim();
      const experience = String(instructorExperience || "").trim();
      const credentials = String(instructorCredentials || "").trim();
      const bio = String(instructorBio || "").trim();
      const motivation = String(instructorMotivation || "").trim();
      const website = String(instructorWebsite || "").trim();
      if (!phone || !subjects || !experience || !credentials || !bio || !motivation) {
        return {
          ok: false,
          error: "Add phone, subjects, experience, credentials, bio, and motivation.",
        };
      }

      const next = this.updateUser(userId, {
        instructorStatus: "pending",
        instructorPhone: phone,
        instructorSubjects: subjects,
        instructorExperience: experience,
        instructorCredentials: credentials,
        instructorBio: bio,
        instructorMotivation: motivation,
        instructorWebsite: website,
        instructorAppliedAt: new Date().toISOString(),
      });

      this.addNotification({
        title: "Tutor application received",
        body: `${next.name} applied to teach on Folio.`,
        audience: "admin",
      });
      this.addNotification({
        title: "Tutor application submitted",
        body: "Thanks — Folio admin will review your teaching profile soon.",
        userId,
        audience: "user",
        fromUserName: "Folio",
      });

      return { ok: true, user: next };
    },

    getTutorRankOptions() {
      return [
        { value: "none", label: "No medal" },
        { value: "bronze", label: "Bronze" },
        { value: "silver", label: "Silver" },
        { value: "gold", label: "Gold" },
        { value: "platinum", label: "Platinum" },
      ];
    },

    getTutorRankLabel(rank) {
      const found = this.getTutorRankOptions().find((r) => r.value === rank);
      return found ? found.label : "No medal";
    },

    setTutorRank(tutorId, rank) {
      const user = this.getUsers().find((u) => u.id === tutorId);
      if (!user || user.role !== "customer") {
        return { ok: false, error: "Tutor not found." };
      }
      if (!(user.instructorStatus === "pending" || user.instructorStatus === "approved")) {
        return { ok: false, error: "That account is not a tutor." };
      }
      const allowed = this.getTutorRankOptions().map((r) => r.value);
      const nextRank = allowed.includes(rank) ? rank : "none";
      this.updateUser(tutorId, {
        tutorRank: nextRank,
        tutorRankUpdatedAt: new Date().toISOString(),
      });
      if (nextRank !== "none") {
        this.addNotification({
          title: "Rank medal awarded",
          body: `You received a ${this.getTutorRankLabel(nextRank)} tutor medal from Folio admin.`,
          userId: tutorId,
          audience: "user",
        });
      }
      return { ok: true, user: this.getUsers().find((u) => u.id === tutorId) };
    },

    getTutorLeaderboard(limit) {
      const tutors = this.getUsers().filter(
        (u) => u.role === "customer" && (u.instructorStatus === "pending" || u.instructorStatus === "approved")
      );
      const rows = tutors.map((u) => {
        const dash = this.getTutorDashboard(u.id);
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          profileImage: u.profileImage || "",
          instructorStatus: u.instructorStatus,
          tutorRank: u.tutorRank || "none",
          totalStudents: dash.totalStudents,
          totalCourses: dash.totalCourses,
          lifetimeCourseEarnings: dash.lifetimeCourseEarnings,
          walletBalance: dash.walletBalance,
        };
      });
      rows.sort((a, b) => {
        if (b.totalStudents !== a.totalStudents) return b.totalStudents - a.totalStudents;
        return b.lifetimeCourseEarnings - a.lifetimeCourseEarnings;
      });
      const cap = Math.max(1, Number(limit) || 5);
      return rows.slice(0, cap);
    },

    async saveProfileImage(userId, file) {
      const user = this.getUsers().find((u) => u.id === userId);
      if (!user) return { ok: false, error: "Account not found." };
      const rate = consumeRateLimit("profile_image", userId);
      if (!rate.ok) return { ok: false, error: rate.error };
      if (!file) return { ok: false, error: "Choose a profile image." };
      if (!String(file.type || "").startsWith("image/")) {
        return { ok: false, error: "Upload an image file (JPG, PNG, or WebP)." };
      }
      if (file.size > 5 * 1024 * 1024) {
        return { ok: false, error: "Image must be 5MB or smaller." };
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const max = 480;
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL("image/jpeg", 0.86));
          };
          img.onerror = () => reject(new Error("Could not read that image."));
          img.src = String(reader.result || "");
        };
        reader.onerror = () => reject(new Error("Could not read that image."));
        reader.readAsDataURL(file);
      }).catch((err) => ({ __error: err.message || "Could not process image." }));

      if (dataUrl && dataUrl.__error) {
        return { ok: false, error: dataUrl.__error };
      }

      this.updateUser(userId, {
        profileImage: dataUrl,
        profileImageUpdatedAt: new Date().toISOString(),
      });
      return { ok: true, user: this.getUsers().find((u) => u.id === userId) };
    },

    removeProfileImage(userId) {
      const user = this.getUsers().find((u) => u.id === userId);
      if (!user) return { ok: false, error: "Account not found." };
      this.updateUser(userId, { profileImage: "", profileImageUpdatedAt: new Date().toISOString() });
      return { ok: true };
    },

    login(email, password) {
      const cleanEmail = String(email || "").trim().toLowerCase();
      const gate = checkRateLimit("login", cleanEmail || "anon");
      if (!gate.ok) return { ok: false, error: gate.error };

      const user = this.getUsers().find(
        (u) => u.email === cleanEmail && u.password === String(password || "")
      );
      if (!user) {
        hitRateLimit("login", cleanEmail || "anon");
        return { ok: false, error: "Invalid email or password." };
      }
      if (this.isAccountSuspended(user)) {
        hitRateLimit("login", cleanEmail || "anon");
        return {
          ok: false,
          error: "This account is suspended. Contact Folio support.",
        };
      }
      // Clear failed attempts after a successful sign-in
      const buckets = getRateBuckets();
      delete buckets["login::" + cleanEmail];
      saveRateBuckets(buckets);
      write(SESSION_KEY, { userId: user.id });
      return { ok: true, user };
    },

    logout() {
      localStorage.removeItem(SESSION_KEY);
    },

    requireRole(role, redirectTo) {
      const user = this.getCurrentUser();
      if (!user || (role && user.role !== role)) {
        window.location.href = redirectTo || "login.html";
        return null;
      }
      return user;
    },

    requireAuth(redirectTo) {
      const user = this.getCurrentUser();
      if (!user) {
        window.location.href = redirectTo || "login.html";
        return null;
      }
      return user;
    },

    getListings() {
      return read(LISTINGS_KEY, []);
    },

    saveListing(listing) {
      const settings = this.getSettings();
      if (settings.autoApproveBooks === "yes") {
        listing.status = "live";
      }
      const listings = this.getListings();
      listings.unshift(listing);
      write(LISTINGS_KEY, listings);

      const seller = this.getUsers().find((u) => u.id === listing.sellerId);
      if (seller && seller.role === "customer" && (!seller.sellerStatus || seller.sellerStatus === "none")) {
        this.updateUser(seller.id, {
          sellerStatus: settings.autoApproveBooks === "yes" ? "approved" : "pending",
        });
      }

      return listing;
    },

    getLiveMarketplaceListings() {
      return this.getListings()
        .filter((item) => item.status === "live")
        .slice()
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    },

    async createBookListing({
      sellerId,
      title,
      author,
      price,
      condition,
      notes,
      coverFile,
      coverImage,
    }) {
      const seller = this.getUsers().find((u) => u.id === sellerId);
      if (!seller || seller.role !== "customer") {
        return { ok: false, error: "Sign in with a customer account to sell books." };
      }
      if (this.isAccountSuspended(seller)) {
        return { ok: false, error: "Your account is suspended." };
      }
      const rate = consumeRateLimit("book_listing", sellerId);
      if (!rate.ok) return { ok: false, error: rate.error };

      const cleanTitle = String(title || "").trim();
      const cleanAuthor = String(author || "").trim();
      const amount = Number(price);
      const cleanCondition = String(condition || "").trim() || "Good";
      const cleanNotes = String(notes || "").trim();
      if (!cleanTitle || !cleanAuthor) {
        return { ok: false, error: "Add the book title and author." };
      }
      if (!Number.isFinite(amount) || amount < 1) {
        return { ok: false, error: "Set a price of at least $1." };
      }

      let cover = String(coverImage || "").trim();
      if (coverFile) {
        const prepared = await this.prepareSocialImage(coverFile);
        if (!prepared.ok) return prepared;
        cover = prepared.dataUrl;
      }
      if (!cover) {
        return { ok: false, error: "Upload a cover photo of the book." };
      }

      const listing = this.saveListing({
        id: "list_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        sellerId: seller.id,
        sellerName: seller.name,
        sellerEmail: seller.email,
        title: cleanTitle,
        author: cleanAuthor,
        price: Number(amount.toFixed(2)),
        condition: cleanCondition,
        notes: cleanNotes,
        coverImage: cover,
        status: "pending",
        createdAt: new Date().toISOString(),
      });

      this.addNotification({
        title: "Book listing submitted",
        body: `“${cleanTitle}” was uploaded and is waiting for admin review.`,
        userId: seller.id,
        audience: "user",
        fromUserName: "Folio",
      });
      this.addNotification({
        title: "New book listing",
        body: `${seller.name} uploaded “${cleanTitle}” for sale.`,
        audience: "admin",
      });

      return { ok: true, listing };
    },

    updateListing(id, patch) {
      const listings = this.getListings().map((item) =>
        item.id === id ? { ...item, ...patch } : item
      );
      write(LISTINGS_KEY, listings);
    },

    deleteListing(id) {
      write(
        LISTINGS_KEY,
        this.getListings().filter((item) => item.id !== id)
      );
    },

    getListingsBySeller(userId) {
      return this.getListings().filter((item) => item.sellerId === userId);
    },

    getOrders() {
      return read(ORDERS_KEY, []);
    },

    saveOrder(order) {
      const orders = this.getOrders();
      orders.unshift(order);
      write(ORDERS_KEY, orders);
      return order;
    },

    updateOrder(id, patch) {
      write(
        ORDERS_KEY,
        this.getOrders().map((o) => (o.id === id ? { ...o, ...patch } : o))
      );
    },

    markSold(id, soldPrice) {
      const amount = Number(soldPrice) || 0;
      const listing = this.getListings().find((l) => l.id === id);
      this.updateListing(id, {
        status: "sold",
        soldPrice: amount,
        soldAt: new Date().toISOString(),
      });

      if (listing) {
        const fee = Number((amount * this.getFeeRate()).toFixed(2));
        this.saveOrder({
          id: "ord_" + Date.now(),
          listingId: listing.id,
          title: listing.title,
          sellerId: listing.sellerId,
          sellerName: listing.sellerName,
          amount,
          platformFee: fee,
          sellerPayout: Number((amount - fee).toFixed(2)),
          deliveryStatus: "completed",
          refundStatus: "none",
          createdAt: new Date().toISOString(),
        });
      }
    },

    getAdminStats() {
      const listings = this.getListings();
      const users = this.getUsers();
      const orders = this.getOrders();
      const customers = users.filter((u) => u.role === "customer");

      const totalRevenue = orders.reduce((sum, o) => sum + Number(o.amount || 0), 0);
      const platformEarnings = orders.reduce((sum, o) => sum + Number(o.platformFee || 0), 0);

      return {
        totalRevenue,
        platformEarnings,
        totalOrders: orders.length,
        totalBooks: listings.length,
        totalProducts: listings.length,
        activeSellers: customers.filter((u) => u.sellerStatus === "approved").length,
        pendingSellers: customers.filter((u) => u.sellerStatus === "pending").length,
        pendingBooks: listings.filter((l) => l.status === "pending").length,
        totalCustomers: customers.length,
        completedDeliveries: orders.filter((o) => o.deliveryStatus === "completed").length,
        refundRequests: orders.filter((o) => o.refundStatus === "requested" || o.refundStatus === "pending").length,
        feeRate: this.getFeeRate(),
        topVendors: this.getTopVendors(5),
      };
    },

    getTopVendors(limit) {
      const orders = this.getOrders();
      const map = {};
      orders.forEach((o) => {
        const id = o.sellerId || "unknown";
        if (!map[id]) {
          map[id] = {
            sellerId: id,
            sellerName: o.sellerName || "Unknown",
            sales: 0,
            revenue: 0,
            payout: 0,
          };
        }
        map[id].sales += 1;
        map[id].revenue += Number(o.amount || 0);
        map[id].payout += Number(o.sellerPayout || 0);
      });
      return Object.values(map)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, limit || 5);
    },

    getProfitAnalytics(period, range) {
      const mode = ["daily", "weekly", "monthly", "yearly"].includes(period) ? period : "monthly";
      const fromRaw = range && range.from ? String(range.from).trim() : "";
      const toRaw = range && range.to ? String(range.to).trim() : "";
      const fromDate = fromRaw ? new Date(fromRaw + (fromRaw.length <= 10 ? "T00:00:00" : "")) : null;
      const toDate = toRaw ? new Date(toRaw + (toRaw.length <= 10 ? "T23:59:59.999" : "")) : null;
      const hasFrom = fromDate && !Number.isNaN(fromDate.getTime());
      const hasTo = toDate && !Number.isNaN(toDate.getTime());

      const orders = this.getOrders()
        .filter((o) => {
          const d = new Date(o.createdAt || "");
          if (Number.isNaN(d.getTime())) return false;
          if (hasFrom && d < fromDate) return false;
          if (hasTo && d > toDate) return false;
          return true;
        })
        .slice()
        .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));

      const pad = (n) => String(n).padStart(2, "0");
      const startOfWeek = (d) => {
        const x = new Date(d);
        const day = x.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        x.setDate(x.getDate() + diff);
        x.setHours(0, 0, 0, 0);
        return x;
      };
      const bucketKey = (iso) => {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return null;
        if (mode === "daily") {
          return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
        }
        if (mode === "weekly") {
          const start = startOfWeek(d);
          return start.getFullYear() + "-W" + pad(start.getMonth() + 1) + "-" + pad(start.getDate());
        }
        if (mode === "yearly") return String(d.getFullYear());
        return d.getFullYear() + "-" + pad(d.getMonth() + 1);
      };
      const labelFor = (key) => {
        if (!key) return "";
        if (mode === "daily") {
          const d = new Date(key + "T00:00:00");
          return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        }
        if (mode === "weekly") {
          const parts = key.split("-W")[1];
          if (!parts) return key;
          const [mm, dd] = parts.split("-");
          const year = key.slice(0, 4);
          const d = new Date(Number(year), Number(mm) - 1, Number(dd));
          return "Week of " + d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        }
        if (mode === "yearly") return key;
        const [y, m] = key.split("-");
        const d = new Date(Number(y), Number(m) - 1, 1);
        return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
      };

      const buckets = {};
      let totalProfit = 0;
      let tutorProfit = 0;
      let bookProfit = 0;
      let totalRevenue = 0;
      let tutorRevenue = 0;
      let bookRevenue = 0;

      orders.forEach((o) => {
        const key = bucketKey(o.createdAt || "");
        if (!key) return;
        if (!buckets[key]) {
          buckets[key] = {
            key,
            label: labelFor(key),
            profit: 0,
            tutorProfit: 0,
            bookProfit: 0,
            revenue: 0,
            orders: 0,
          };
        }
        const fee = Number(o.platformFee || 0);
        const amount = Number(o.amount || 0);
        const isCourse = o.type === "course";
        buckets[key].profit += fee;
        buckets[key].revenue += amount;
        buckets[key].orders += 1;
        if (isCourse) {
          buckets[key].tutorProfit += fee;
          tutorProfit += fee;
          tutorRevenue += amount;
        } else {
          buckets[key].bookProfit += fee;
          bookProfit += fee;
          bookRevenue += amount;
        }
        totalProfit += fee;
        totalRevenue += amount;
      });

      const series = Object.values(buckets).sort((a, b) => String(a.key).localeCompare(String(b.key)));
      const latest = series.length ? series[series.length - 1] : null;
      const previous = series.length > 1 ? series[series.length - 2] : null;
      const latestProfit = latest ? latest.profit : 0;
      const previousProfit = previous ? previous.profit : 0;
      const changePct =
        previousProfit > 0
          ? Number((((latestProfit - previousProfit) / previousProfit) * 100).toFixed(1))
          : latestProfit > 0
            ? 100
            : 0;

      return {
        period: mode,
        from: hasFrom ? fromDate.toISOString() : null,
        to: hasTo ? toDate.toISOString() : null,
        totalProfit: Number(totalProfit.toFixed(2)),
        tutorProfit: Number(tutorProfit.toFixed(2)),
        bookProfit: Number(bookProfit.toFixed(2)),
        totalRevenue: Number(totalRevenue.toFixed(2)),
        tutorRevenue: Number(tutorRevenue.toFixed(2)),
        bookRevenue: Number(bookRevenue.toFixed(2)),
        orderCount: orders.length,
        tutorFeePercent: Number((this.getTutorFeeRate() * 100).toFixed(1)),
        bookFeePercent: Number((this.getFeeRate() * 100).toFixed(1)),
        latestProfit: Number(latestProfit.toFixed(2)),
        changePct,
        series: series.map((row) => ({
          ...row,
          profit: Number(row.profit.toFixed(2)),
          tutorProfit: Number(row.tutorProfit.toFixed(2)),
          bookProfit: Number(row.bookProfit.toFixed(2)),
          revenue: Number(row.revenue.toFixed(2)),
        })),
      };
    },

    getProfitCalendarMonth(year, month) {
      const y = Number(year);
      const m = Number(month); // 1-12
      if (!y || !m || m < 1 || m > 12) {
        const now = new Date();
        return this.getProfitCalendarMonth(now.getFullYear(), now.getMonth() + 1);
      }
      const pad = (n) => String(n).padStart(2, "0");
      const daysInMonth = new Date(y, m, 0).getDate();
      const firstDow = new Date(y, m - 1, 1).getDay(); // 0 Sun
      const byDay = {};
      for (let day = 1; day <= daysInMonth; day++) {
        const key = y + "-" + pad(m) + "-" + pad(day);
        byDay[key] = {
          date: key,
          day,
          profit: 0,
          tutorProfit: 0,
          bookProfit: 0,
          revenue: 0,
          orders: 0,
        };
      }

      this.getOrders().forEach((o) => {
        const d = new Date(o.createdAt || "");
        if (Number.isNaN(d.getTime())) return;
        if (d.getFullYear() !== y || d.getMonth() + 1 !== m) return;
        const key = y + "-" + pad(m) + "-" + pad(d.getDate());
        if (!byDay[key]) return;
        const fee = Number(o.platformFee || 0);
        const amount = Number(o.amount || 0);
        byDay[key].profit += fee;
        byDay[key].revenue += amount;
        byDay[key].orders += 1;
        if (o.type === "course") byDay[key].tutorProfit += fee;
        else byDay[key].bookProfit += fee;
      });

      const days = Object.values(byDay)
        .sort((a, b) => a.day - b.day)
        .map((row) => ({
          ...row,
          profit: Number(row.profit.toFixed(2)),
          tutorProfit: Number(row.tutorProfit.toFixed(2)),
          bookProfit: Number(row.bookProfit.toFixed(2)),
          revenue: Number(row.revenue.toFixed(2)),
        }));
      const totalProfit = days.reduce((sum, d) => sum + d.profit, 0);
      const maxDayProfit = Math.max(...days.map((d) => d.profit), 0);

      return {
        year: y,
        month: m,
        monthLabel: new Date(y, m - 1, 1).toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        }),
        firstDow,
        daysInMonth,
        days,
        totalProfit: Number(totalProfit.toFixed(2)),
        maxDayProfit: Number(maxDayProfit.toFixed(2)),
      };
    },

    getNotifications() {
      return read(NOTIFICATIONS_KEY, []);
    },

    saveNotifications(items) {
      write(NOTIFICATIONS_KEY, items);
    },

    addNotification(item) {
      const items = this.getNotifications();
      items.unshift({
        id: item.id || "n_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9),
        title: String(item.title || "").trim() || "Notification",
        body: String(item.body || "").trim(),
        userId: item.userId || null,
        audience: item.audience || (item.userId ? "user" : "admin"),
        targetGroup: item.targetGroup || null,
        fromUserId: item.fromUserId || null,
        fromUserName: item.fromUserName || null,
        courseId: item.courseId || null,
        courseTitle: item.courseTitle || null,
        read: !!item.read,
        createdAt: item.createdAt || new Date().toISOString(),
      });
      this.saveNotifications(items);
    },

    getNotificationsForUser(userId) {
      return this.getNotifications().filter((n) => n.userId === userId);
    },

    getAdminNotifications() {
      return this.getNotifications().filter(
        (n) => !n.userId || n.audience === "admin" || n.targetGroup === "admin"
      );
    },

    isAgentUser(user) {
      return !!(
        user &&
        user.role === "customer" &&
        (user.sellerStatus === "approved" || user.sellerStatus === "pending")
      );
    },

    isTutorUser(user) {
      return !!(
        user &&
        user.role === "customer" &&
        (user.instructorStatus === "approved" || user.instructorStatus === "pending")
      );
    },

    notifyAgents({ adminId, title, body }) {
      const admin = this.getUsers().find((u) => u.id === adminId);
      if (!admin || admin.role !== "admin") {
        return { ok: false, error: "Only admins can notify agents." };
      }
      const cleanTitle = String(title || "").trim();
      const cleanBody = String(body || "").trim();
      if (!cleanTitle || !cleanBody) {
        return { ok: false, error: "Add a title and message." };
      }
      const agents = this.getUsers().filter((u) => this.isAgentUser(u));
      if (!agents.length) {
        return { ok: false, error: "No agent accounts to notify yet." };
      }
      agents.forEach((agent) => {
        this.addNotification({
          title: cleanTitle,
          body: cleanBody,
          userId: agent.id,
          audience: "user",
          targetGroup: "agents",
          fromUserId: adminId,
          fromUserName: "Folio",
        });
      });
      this.addNotification({
        title: cleanTitle,
        body: `Pushed to ${agents.length} agent account${agents.length === 1 ? "" : "s"}: ${cleanBody}`,
        audience: "admin",
        targetGroup: "agents",
        fromUserId: adminId,
        fromUserName: "Folio",
      });
      return { ok: true, count: agents.length };
    },

    notifyTutors({ adminId, title, body }) {
      const admin = this.getUsers().find((u) => u.id === adminId);
      if (!admin || admin.role !== "admin") {
        return { ok: false, error: "Only admins can notify tutors." };
      }
      const cleanTitle = String(title || "").trim();
      const cleanBody = String(body || "").trim();
      if (!cleanTitle || !cleanBody) {
        return { ok: false, error: "Add a title and message." };
      }
      const tutors = this.getUsers().filter((u) => this.isTutorUser(u));
      if (!tutors.length) {
        return { ok: false, error: "No tutor accounts to notify yet." };
      }
      tutors.forEach((tutor) => {
        this.addNotification({
          title: cleanTitle,
          body: cleanBody,
          userId: tutor.id,
          audience: "user",
          targetGroup: "tutors",
          fromUserId: adminId,
          fromUserName: "Folio",
        });
      });
      this.addNotification({
        title: cleanTitle,
        body: `Pushed to ${tutors.length} tutor account${tutors.length === 1 ? "" : "s"}: ${cleanBody}`,
        audience: "admin",
        targetGroup: "tutors",
        fromUserId: adminId,
        fromUserName: "Folio",
      });
      return { ok: true, count: tutors.length };
    },

    getUnreadNotificationCount(userId) {
      return this.getNotificationsForUser(userId).filter((n) => !n.read).length;
    },

    markNotificationRead(id) {
      this.saveNotifications(
        this.getNotifications().map((n) => (n.id === id ? { ...n, read: true } : n))
      );
    },

    deleteNotification(id) {
      this.saveNotifications(this.getNotifications().filter((n) => n.id !== id));
    },

    getTutorStudents(instructorId) {
      const enrollments = this.getEnrollments().filter((e) => e.instructorId === instructorId);
      const byUser = {};
      enrollments.forEach((e) => {
        if (!byUser[e.userId]) {
          byUser[e.userId] = {
            userId: e.userId,
            userName: e.userName,
            userEmail: e.userEmail,
            courses: [],
          };
        }
        byUser[e.userId].courses.push({
          enrollmentId: e.id,
          courseId: e.courseId,
          courseTitle: e.courseTitle,
          status: e.status,
          paidAt: e.paidAt,
        });
      });
      return Object.values(byUser).sort((a, b) =>
        String(a.userName || "").localeCompare(String(b.userName || ""))
      );
    },

    notifyStudent({ tutorId, studentId, title, body, courseId, courseTitle }) {
      const tutor = this.getUsers().find((u) => u.id === tutorId);
      if (!tutor || !this.canAccessTeachSection(tutor)) {
        return { ok: false, error: "Only active tutors can send student notifications." };
      }
      const students = this.getTutorStudents(tutorId);
      const student = students.find((s) => s.userId === studentId);
      if (!student) {
        return { ok: false, error: "That student is not enrolled in your courses." };
      }
      const cleanTitle = String(title || "").trim();
      const cleanBody = String(body || "").trim();
      if (!cleanTitle || !cleanBody) {
        return { ok: false, error: "Add a title and message." };
      }
      this.addNotification({
        title: cleanTitle,
        body: cleanBody,
        userId: studentId,
        audience: "user",
        fromUserId: tutorId,
        fromUserName: tutor.name,
        courseId: courseId || null,
        courseTitle: courseTitle || null,
      });
      return { ok: true };
    },

    notifyTutorStudents({ tutorId, title, body, courseId }) {
      const tutor = this.getUsers().find((u) => u.id === tutorId);
      if (!tutor || !this.canAccessTeachSection(tutor)) {
        return { ok: false, error: "Only active tutors can send student notifications." };
      }
      const cleanTitle = String(title || "").trim();
      const cleanBody = String(body || "").trim();
      if (!cleanTitle || !cleanBody) {
        return { ok: false, error: "Add a title and message." };
      }
      let students = this.getTutorStudents(tutorId);
      if (courseId) {
        students = students.filter((s) => s.courses.some((c) => c.courseId === courseId));
      }
      if (!students.length) {
        return { ok: false, error: "No students to notify yet." };
      }
      students.forEach((student) => {
        const matched = courseId
          ? student.courses.find((c) => c.courseId === courseId)
          : student.courses[0];
        this.addNotification({
          title: cleanTitle,
          body: cleanBody,
          userId: student.userId,
          audience: "user",
          fromUserId: tutorId,
          fromUserName: tutor.name,
          courseId: matched ? matched.courseId : null,
          courseTitle: matched ? matched.courseTitle : null,
        });
      });
      return { ok: true, count: students.length };
    },

    getReviews() {
      return read(REVIEWS_KEY, []);
    },

    saveReviews(items) {
      write(REVIEWS_KEY, items);
    },

    updateReview(id, patch) {
      this.saveReviews(this.getReviews().map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },

    deleteReview(id) {
      this.saveReviews(this.getReviews().filter((r) => r.id !== id));
    },

    getWithdrawals() {
      return read(WITHDRAWALS_KEY, []);
    },

    saveWithdrawals(items) {
      write(WITHDRAWALS_KEY, items);
    },

    requestWithdrawal({ sellerId, sellerName, sellerEmail, amount, method, source }) {
      const value = Number(amount) || 0;
      if (value <= 0) return { ok: false, error: "Enter a valid amount." };
      const available =
        source === "tutor"
          ? this.getTutorWalletBalance(sellerId)
          : this.getSellerAvailableBalance(sellerId);
      const min = Number(this.getSettings().minWithdrawal) || 0;
      if (min > 0 && value < min) {
        return { ok: false, error: `Minimum withdrawal is ${this.formatMoney(min)}.` };
      }
      if (value > available) {
        return { ok: false, error: "Amount exceeds available balance." };
      }
      const item = {
        id: "wd_" + Date.now(),
        sellerId,
        sellerName,
        sellerEmail,
        amount: value,
        method: method || "Bank transfer",
        status: "pending",
        source: source === "tutor" ? "tutor" : "seller",
        createdAt: new Date().toISOString(),
      };
      const items = this.getWithdrawals();
      items.unshift(item);
      this.saveWithdrawals(items);
      this.addNotification({
        title: "Withdrawal requested",
        body: `${sellerName || "A user"} requested ${this.formatMoney(value)} (${item.method}).`,
        audience: "admin",
      });
      return { ok: true, item };
    },

    updateWithdrawal(id, patch) {
      this.saveWithdrawals(
        this.getWithdrawals().map((w) => (w.id === id ? { ...w, ...patch } : w))
      );
    },

    getSettings() {
      return { ...DEFAULT_SETTINGS, ...read(SETTINGS_KEY, {}) };
    },

    saveSettings(patch) {
      const next = { ...this.getSettings(), ...patch };
      write(SETTINGS_KEY, next);
      return next;
    },

    getFeeRate() {
      const fee = Number(this.getSettings().feePercent);
      return Number.isFinite(fee) ? fee / 100 : PLATFORM_FEE_RATE;
    },

    getTutorFeeRate() {
      const fee = Number(this.getSettings().tutorFeePercent);
      return Number.isFinite(fee) && fee >= 0 ? fee / 100 : TUTOR_FEE_RATE;
    },

    getCurrencies() {
      return CURRENCIES;
    },

    getCurrencyMeta(code) {
      return CURRENCIES[code] || CURRENCIES.USD;
    },

    getDisplayCurrency() {
      const saved = localStorage.getItem(DISPLAY_CURRENCY_KEY);
      if (saved && CURRENCIES[saved]) return saved;
      const store = this.getSettings().currency;
      return CURRENCIES[store] ? store : "USD";
    },

    setDisplayCurrency(code) {
      const next = CURRENCIES[code] ? code : "USD";
      localStorage.setItem(DISPLAY_CURRENCY_KEY, next);
      window.dispatchEvent(new CustomEvent("folio:currency", { detail: { currency: next } }));
      return next;
    },

    convertFromUsd(amountUsd, toCode) {
      const meta = this.getCurrencyMeta(toCode || this.getDisplayCurrency());
      return Number(amountUsd || 0) * meta.rate;
    },

    formatMoney(amountUsd, code) {
      const currency = code || this.getDisplayCurrency();
      const meta = this.getCurrencyMeta(currency);
      const value = this.convertFromUsd(amountUsd, currency);
      const fixed = value.toFixed(meta.decimals);
      if (meta.code === "USD") return meta.symbol + fixed;
      if (meta.symbol.length > 1) return meta.symbol + " " + fixed;
      return meta.symbol + fixed;
    },

    mountCurrencySelect(selectEl, onChange) {
      if (!selectEl) return;
      const host = selectEl.closest(".currency-picker") || selectEl.parentElement;
      if (!host || host.dataset.currencyReady === "1") return;
      host.dataset.currencyReady = "1";
      host.classList.add("is-custom");

      const renderButton = (code) => {
        const meta = this.getCurrencyMeta(code);
        return `
          <img class="currency-flag" src="${flagUrl(meta.country)}" alt="" width="18" height="12" loading="lazy" />
          <span class="currency-code">${meta.code}</span>
          <span class="currency-caret" aria-hidden="true">▾</span>`;
      };

      const menuHtml = Object.values(CURRENCIES)
        .map(
          (c) => `
          <button type="button" class="currency-option" role="option" data-code="${c.code}" aria-label="${c.label}">
            <img class="currency-flag" src="${flagUrl(c.country)}" alt="" width="18" height="12" loading="lazy" />
            <span>${c.code}</span>
          </button>`
        )
        .join("");

      host.innerHTML = `
        <button type="button" class="currency-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="Display currency">
          ${renderButton(this.getDisplayCurrency())}
        </button>
        <div class="currency-menu" role="listbox" hidden>${menuHtml}</div>`;

      const btn = host.querySelector(".currency-btn");
      const menu = host.querySelector(".currency-menu");

      const close = () => {
        menu.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      };

      const open = () => {
        menu.hidden = false;
        btn.setAttribute("aria-expanded", "true");
      };

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (menu.hidden) open();
        else close();
      });

      menu.querySelectorAll(".currency-option").forEach((opt) => {
        opt.addEventListener("click", (e) => {
          e.stopPropagation();
          const code = opt.dataset.code;
          this.setDisplayCurrency(code);
          btn.innerHTML = renderButton(code);
          close();
          if (typeof onChange === "function") onChange(code);
        });
      });

      document.addEventListener("click", (e) => {
        if (!host.contains(e.target)) close();
      });

      window.addEventListener("folio:currency", (e) => {
        const code = e.detail?.currency || this.getDisplayCurrency();
        btn.innerHTML = renderButton(code);
      });
    },

    getSellerAvailableBalance(sellerId) {
      const earned = this.getOrders()
        .filter((o) => o.sellerId === sellerId)
        .reduce((sum, o) => sum + Number(o.sellerPayout || 0), 0);
      const withdrawn = this.getWithdrawals()
        .filter((w) => w.sellerId === sellerId && (w.status === "pending" || w.status === "paid"))
        .reduce((sum, w) => sum + Number(w.amount || 0), 0);
      return Math.max(0, Number((earned - withdrawn).toFixed(2)));
    },

    getSellerStats(sellerId) {
      const listings = this.getListingsBySeller(sellerId);
      const orders = this.getOrders().filter((o) => o.sellerId === sellerId);
      const sold = listings.filter((l) => l.status === "sold");
      const revenueFromOrders = orders.reduce((sum, o) => sum + Number(o.sellerPayout || 0), 0);
      const revenueFromListings = sold.reduce(
        (sum, l) => sum + Number(l.soldPrice || l.price || 0),
        0
      );
      const salesOverview = revenueFromOrders || revenueFromListings;
      const titleMap = {};
      orders.forEach((o) => {
        const key = o.listingId || o.title || "item";
        if (!titleMap[key]) {
          titleMap[key] = { title: o.title || "Untitled", sales: 0, revenue: 0, payout: 0 };
        }
        titleMap[key].sales += 1;
        titleMap[key].revenue += Number(o.amount || 0);
        titleMap[key].payout += Number(o.sellerPayout || 0);
      });
      if (!orders.length) {
        sold.forEach((l) => {
          titleMap[l.id] = {
            title: l.title,
            sales: 1,
            revenue: Number(l.soldPrice || l.price || 0),
            payout: Number(l.soldPrice || l.price || 0),
          };
        });
      }
      const topProducts = Object.values(titleMap)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);
      return {
        salesOverview,
        totalProducts: listings.length,
        topProducts,
        topProductsCount: topProducts.length,
        totalCustomers: orders.length || sold.length,
        booksSold: sold.length || orders.length,
        available: this.getSellerAvailableBalance(sellerId),
        avgSale:
          (orders.length || sold.length)
            ? salesOverview / (orders.length || sold.length)
            : 0,
      };
    },

    getCollection(userId) {
      const all = read(COLLECTION_KEY, {});
      return all[userId] || [];
    },

    saveCollection(userId, items) {
      const all = read(COLLECTION_KEY, {});
      all[userId] = items;
      write(COLLECTION_KEY, all);
    },

    addToCollection(userId, item) {
      const items = this.getCollection(userId);
      items.unshift(item);
      this.saveCollection(userId, items);
    },

    removeFromCollection(userId, id) {
      this.saveCollection(
        userId,
        this.getCollection(userId).filter((item) => item.id !== id)
      );
    },

    getArchives(userId) {
      const all = read(ARCHIVES_KEY, {});
      return all[userId] || [];
    },

    saveArchives(userId, items) {
      const all = read(ARCHIVES_KEY, {});
      all[userId] = items;
      write(ARCHIVES_KEY, all);
    },

    addArchive(userId, item) {
      const items = this.getArchives(userId);
      items.unshift(item);
      this.saveArchives(userId, items);
    },

    removeArchive(userId, id) {
      this.saveArchives(
        userId,
        this.getArchives(userId).filter((item) => item.id !== id)
      );
    },

    getCourses() {
      return read(COURSES_KEY, []);
    },

    saveCourses(items) {
      write(COURSES_KEY, items);
    },

    getLiveCourses() {
      return this.getCourses().filter((c) => {
        if (c.status !== "live") return false;
        const tutor = this.getUsers().find((u) => u.id === c.instructorId);
        return !this.isTutorBanned(tutor);
      });
    },

    getCourseById(id) {
      return this.getCourses().find((c) => c.id === id) || null;
    },

    getCoursesByInstructor(instructorId) {
      return this.getCourses().filter((c) => c.instructorId === instructorId);
    },

    getTutorAnnualFee() {
      const fee = Number(this.getSettings().tutorAnnualFee);
      return fee > 0 ? fee : DEFAULT_SETTINGS.tutorAnnualFee;
    },

    hasActiveTutorMembership(user) {
      if (!user || user.instructorStatus !== "approved") return false;
      const expires = user.instructorMembershipExpiresAt
        ? new Date(user.instructorMembershipExpiresAt).getTime()
        : 0;
      return Number.isFinite(expires) && expires > Date.now();
    },

    isTutorBanned(user) {
      return !!(user && user.tutorBanned);
    },

    canAccessTeachSection(user) {
      return (
        this.isInstructorApproved(user) &&
        this.hasActiveTutorMembership(user) &&
        !this.isTutorBanned(user)
      );
    },

    banTutor({ adminId, tutorId, reason }) {
      const admin = this.getUsers().find((u) => u.id === adminId);
      if (!admin || admin.role !== "admin") {
        return { ok: false, error: "Only admins can ban tutors." };
      }
      const tutor = this.getUsers().find((u) => u.id === tutorId);
      if (!tutor || tutor.role !== "customer") {
        return { ok: false, error: "Tutor not found." };
      }
      if (!(tutor.instructorStatus === "pending" || tutor.instructorStatus === "approved")) {
        return { ok: false, error: "That account is not a tutor." };
      }
      const cleanReason = String(reason || "").trim() || "Violated Folio tutor rules.";
      this.updateUser(tutorId, {
        tutorBanned: true,
        tutorBanReason: cleanReason,
        tutorBannedAt: new Date().toISOString(),
        tutorBannedBy: adminId,
      });
      this.addNotification({
        title: "Tutor account banned",
        body: `Your tutor access was banned. Reason: ${cleanReason}`,
        userId: tutorId,
        audience: "user",
      });
      return { ok: true, user: this.getUsers().find((u) => u.id === tutorId) };
    },

    unbanTutor({ adminId, tutorId }) {
      const admin = this.getUsers().find((u) => u.id === adminId);
      if (!admin || admin.role !== "admin") {
        return { ok: false, error: "Only admins can unban tutors." };
      }
      const tutor = this.getUsers().find((u) => u.id === tutorId);
      if (!tutor) return { ok: false, error: "Tutor not found." };
      this.updateUser(tutorId, {
        tutorBanned: false,
        tutorBanReason: "",
        tutorBannedAt: "",
        tutorBannedBy: "",
        tutorUnbannedAt: new Date().toISOString(),
      });
      this.addNotification({
        title: "Tutor ban lifted",
        body: "Your tutor access ban was removed. You can teach again if your membership is active.",
        userId: tutorId,
        audience: "user",
      });
      return { ok: true, user: this.getUsers().find((u) => u.id === tutorId) };
    },

    getTutorWalletBalance(instructorId) {
      const earned = this.getOrders()
        .filter((o) => o.sellerId === instructorId && o.type === "course")
        .reduce((sum, o) => sum + Number(o.sellerPayout || 0), 0);
      const withdrawn = this.getWithdrawals()
        .filter((w) => w.sellerId === instructorId && (w.status === "pending" || w.status === "paid"))
        .reduce((sum, w) => sum + Number(w.amount || 0), 0);
      return Math.max(0, Number((earned - withdrawn).toFixed(2)));
    },

    getTutorDashboard(instructorId) {
      const courses = this.getCoursesByInstructor(instructorId);
      const enrollments = this.getEnrollments().filter((e) => e.instructorId === instructorId);
      const courseRows = courses.map((course) => {
        const students = enrollments.filter((e) => e.courseId === course.id);
        const activeStudents = students.filter((e) => e.status === "active" || e.status === "completed").length;
        return {
          ...course,
          studentCount: students.length,
          activeStudentCount: activeStudents,
        };
      });
      return {
        courses: courseRows,
        totalCourses: courseRows.length,
        liveCourses: courseRows.filter((c) => c.status === "live").length,
        totalStudents: enrollments.length,
        walletBalance: this.getTutorWalletBalance(instructorId),
        lifetimeCourseEarnings: this.getOrders()
          .filter((o) => o.sellerId === instructorId && o.type === "course")
          .reduce((sum, o) => sum + Number(o.sellerPayout || 0), 0),
      };
    },

    payTutorAnnualMembership(userId) {
      const user = this.getUsers().find((u) => u.id === userId);
      if (!user) return { ok: false, error: "Account not found." };
      if (user.instructorStatus !== "approved") {
        return { ok: false, error: "Your tutor application must be approved first." };
      }
      if (this.hasActiveTutorMembership(user)) {
        return { ok: false, error: "Your annual teach access is already active." };
      }

      const amount = this.getTutorAnnualFee();
      const paidAt = new Date();
      const expiresAt = new Date(paidAt.getTime() + 365 * 24 * 60 * 60 * 1000);

      this.saveOrder({
        id: "ord_tutor_" + Date.now(),
        listingId: "tutor_membership",
        title: "Tutor annual membership",
        sellerId: "folio",
        sellerName: "Folio",
        amount,
        platformFee: amount,
        sellerPayout: 0,
        deliveryStatus: "completed",
        refundStatus: "none",
        type: "tutor_membership",
        buyerId: user.id,
        buyerName: user.name,
        createdAt: paidAt.toISOString(),
      });

      this.updateUser(user.id, {
        instructorMembershipPaidAt: paidAt.toISOString(),
        instructorMembershipExpiresAt: expiresAt.toISOString(),
      });

      return {
        ok: true,
        user: this.getUsers().find((u) => u.id === userId),
        amount,
        expiresAt: expiresAt.toISOString(),
      };
    },

    createCourse({ instructorId, instructorName, title, description, price, durationDays }) {
      const instructor = this.getUsers().find((u) => u.id === instructorId);
      if (!instructor || instructor.instructorStatus !== "approved") {
        return { ok: false, error: "Only approved instructors can publish courses." };
      }
      if (!this.hasActiveTutorMembership(instructor)) {
        return {
          ok: false,
          error: "Pay the annual tutor membership to access Teach courses.",
        };
      }
      const cleanTitle = String(title || "").trim();
      const days = Number(durationDays) || 0;
      const amount = Number(price) || 0;
      if (!cleanTitle || amount <= 0) {
        return { ok: false, error: "Add a title and price." };
      }
      if (days < 30) {
        return { ok: false, error: "Learning duration must be at least 30 days." };
      }
      const course = {
        id: "course_" + Date.now(),
        title: cleanTitle,
        description: String(description || "").trim(),
        instructorId,
        instructorName: instructorName || instructor.name,
        price: amount,
        durationDays: days,
        status: "pending",
        deliveryType: "unset",
        chapters: [],
        videoStatus: "none",
        videoId: "",
        videoFileName: "",
        videoFileSize: 0,
        videoMime: "",
        videoUrl: "",
        zoomUrl: "",
        liveAt: "",
        classSchedule: "",
        createdAt: new Date().toISOString(),
      };
      const items = this.getCourses();
      items.unshift(course);
      this.saveCourses(items);
      return { ok: true, course };
    },

    updateCourse(id, patch) {
      this.saveCourses(this.getCourses().map((c) => (c.id === id ? { ...c, ...patch } : c)));
    },

    formatLiveAt(iso) {
      if (!iso) return "";
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return d.toLocaleString(undefined, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    },

    toDatetimeLocalValue(iso) {
      if (!iso) return "";
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      const pad = (n) => String(n).padStart(2, "0");
      return (
        d.getFullYear() +
        "-" +
        pad(d.getMonth() + 1) +
        "-" +
        pad(d.getDate()) +
        "T" +
        pad(d.getHours()) +
        ":" +
        pad(d.getMinutes())
      );
    },

    getCourseChapters(course) {
      if (!course) return [];
      if (Array.isArray(course.chapters) && course.chapters.length) {
        return course.chapters
          .slice()
          .sort((a, b) => (a.order || 0) - (b.order || 0));
      }
      // Migrate legacy single-video courses into one chapter for display.
      if (course.videoId || course.videoStatus === "pending" || course.videoStatus === "approved" || course.videoStatus === "rejected") {
        return [
          {
            id: "ch_legacy_" + course.id,
            title: "Chapter 1",
            order: 1,
            videoStatus: course.videoStatus || "none",
            videoId: course.videoId || "",
            videoFileName: course.videoFileName || "",
            videoFileSize: course.videoFileSize || 0,
            videoMime: course.videoMime || "",
            videoRejectReason: course.videoRejectReason || "",
            videoApprovedAt: course.videoApprovedAt || "",
            legacy: true,
          },
        ];
      }
      return [];
    },

    getMaxVideoBytes() {
      return MAX_VIDEO_BYTES;
    },

    formatFileSize(bytes) {
      const n = Number(bytes) || 0;
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    },

    async saveVideoBlob(id, blob) {
      await putVideoBlob(id, blob);
      return true;
    },

    async getVideoBlob(id) {
      if (!id) return null;
      return getVideoBlob(id);
    },

    async deleteVideoBlob(id) {
      if (!id) return true;
      await deleteVideoBlob(id);
      return true;
    },

    async saveCourseDelivery({
      instructorId,
      courseId,
      deliveryType,
      zoomUrl,
      liveAt,
      classSchedule,
      notifyStudents,
    }) {
      const instructor = this.getUsers().find((u) => u.id === instructorId);
      if (!instructor || !this.canAccessTeachSection(instructor)) {
        return { ok: false, error: "Only active tutors can update class delivery." };
      }
      const course = this.getCourses().find((c) => c.id === courseId && c.instructorId === instructorId);
      if (!course) return { ok: false, error: "Course not found." };

      const type = String(deliveryType || "unset");
      if (!["video", "live", "both", "unset"].includes(type)) {
        return { ok: false, error: "Choose recorded chapters, live class, or both." };
      }
      const zoom = String(zoomUrl || "").trim();
      const schedule = String(classSchedule || "").trim();
      const needsVideo = type === "video" || type === "both";
      const needsLive = type === "live" || type === "both";
      const chapters = this.getCourseChapters(course).filter((ch) => !ch.legacy);
      let liveIso = "";

      if (needsLive) {
        if (!zoom) {
          return { ok: false, error: "Add a Zoom / live class link." };
        }
        const liveRaw = String(liveAt || "").trim();
        if (!liveRaw) {
          return { ok: false, error: "Pick a date and time for the live class." };
        }
        const liveDate = new Date(liveRaw);
        if (Number.isNaN(liveDate.getTime())) {
          return { ok: false, error: "Live class date/time is invalid." };
        }
        liveIso = liveDate.toISOString();
      }

      const patch = {
        deliveryType: type,
        zoomUrl: needsLive ? zoom : "",
        liveAt: needsLive ? liveIso : "",
        classSchedule: schedule,
        chapters: Array.isArray(course.chapters) ? course.chapters : chapters,
      };

      if (!needsVideo) {
        // Keep chapter files stored, but students won't see them unless format includes video.
      }

      this.updateCourse(courseId, patch);
      const updated = this.getCourseById(courseId);

      let notified = 0;
      if (needsLive && liveIso && notifyStudents) {
        const when = this.formatLiveAt(liveIso);
        const result = this.notifyTutorStudents({
          tutorId: instructorId,
          courseId,
          title: "Live class scheduled",
          body: `“${course.title}” goes live on ${when}. Join with the Zoom link from your course page.${
            schedule ? " Note: " + schedule : ""
          }`,
        });
        if (result.ok) notified = result.count || 0;
      }

      return { ok: true, course: updated, notified };
    },

    addCourseChapter({ instructorId, courseId, title }) {
      const instructor = this.getUsers().find((u) => u.id === instructorId);
      if (!instructor || !this.canAccessTeachSection(instructor)) {
        return { ok: false, error: "Only active tutors can add chapters." };
      }
      const course = this.getCourses().find((c) => c.id === courseId && c.instructorId === instructorId);
      if (!course) return { ok: false, error: "Course not found." };

      const cleanTitle = String(title || "").trim();
      if (!cleanTitle) return { ok: false, error: "Add a chapter title." };

      let chapters = Array.isArray(course.chapters) ? course.chapters.slice() : [];
      if (!chapters.length) {
        const migrated = this.getCourseChapters(course).filter((ch) => ch.legacy);
        if (migrated.length) {
          chapters = migrated.map((ch, idx) => ({
            id: "ch_" + courseId + "_" + Date.now() + "_" + idx,
            title: ch.title || "Chapter 1",
            order: idx + 1,
            videoStatus: ch.videoStatus || "none",
            videoId: ch.videoId || "",
            videoFileName: ch.videoFileName || "",
            videoFileSize: ch.videoFileSize || 0,
            videoMime: ch.videoMime || "",
            videoRejectReason: ch.videoRejectReason || "",
            videoApprovedAt: ch.videoApprovedAt || "",
          }));
        }
      }

      const chapter = {
        id: "ch_" + courseId + "_" + Date.now(),
        title: cleanTitle,
        order: chapters.length + 1,
        videoStatus: "none",
        videoId: "",
        videoFileName: "",
        videoFileSize: 0,
        videoMime: "",
        videoRejectReason: "",
        videoApprovedAt: "",
        test: { passScore: 70, questions: [] },
      };
      chapters.push(chapter);
      this.updateCourse(courseId, {
        chapters,
        deliveryType:
          course.deliveryType === "unset" || !course.deliveryType
            ? "video"
            : course.deliveryType,
      });
      return { ok: true, chapter, course: this.getCourseById(courseId) };
    },

    async uploadChapterVideo({ instructorId, courseId, chapterId, videoFile }) {
      const instructor = this.getUsers().find((u) => u.id === instructorId);
      if (!instructor || !this.canAccessTeachSection(instructor)) {
        return { ok: false, error: "Only active tutors can upload chapter videos." };
      }
      const course = this.getCourses().find((c) => c.id === courseId && c.instructorId === instructorId);
      if (!course) return { ok: false, error: "Course not found." };
      if (!videoFile) return { ok: false, error: "Choose a video file to upload." };
      if (!String(videoFile.type || "").startsWith("video/")) {
        return { ok: false, error: "Upload a video file (MP4, WebM, etc.)." };
      }
      if (videoFile.size > MAX_VIDEO_BYTES) {
        return { ok: false, error: "Video must be 80MB or smaller for this demo upload." };
      }

      let chapters = Array.isArray(course.chapters) ? course.chapters.slice() : [];
      if (!chapters.length) {
        const migrated = this.getCourseChapters(course);
        chapters = migrated.map((ch, idx) => ({
          id: ch.legacy ? "ch_" + courseId + "_legacy" : ch.id,
          title: ch.title || "Chapter " + (idx + 1),
          order: idx + 1,
          videoStatus: ch.videoStatus || "none",
          videoId: ch.videoId || "",
          videoFileName: ch.videoFileName || "",
          videoFileSize: ch.videoFileSize || 0,
          videoMime: ch.videoMime || "",
          videoRejectReason: ch.videoRejectReason || "",
          videoApprovedAt: ch.videoApprovedAt || "",
        }));
      }

      const idx = chapters.findIndex((ch) => ch.id === chapterId);
      if (idx < 0) return { ok: false, error: "Chapter not found." };

      const videoId = chapters[idx].videoId || "vid_" + courseId + "_" + chapterId + "_" + Date.now();
      await putVideoBlob(videoId, videoFile);
      chapters[idx] = {
        ...chapters[idx],
        videoId,
        videoFileName: videoFile.name || "lesson.mp4",
        videoFileSize: videoFile.size,
        videoMime: videoFile.type || "video/mp4",
        videoStatus: "pending",
        videoRejectReason: "",
        videoApprovedAt: "",
      };

      this.updateCourse(courseId, {
        chapters,
        deliveryType:
          course.deliveryType === "unset" || !course.deliveryType
            ? "video"
            : course.deliveryType === "live"
              ? "both"
              : course.deliveryType,
        // Clear legacy single-video fields once chapters exist.
        videoStatus: "none",
        videoId: "",
        videoFileName: "",
        videoFileSize: 0,
        videoMime: "",
        videoUrl: "",
      });

      this.addNotification({
        title: "Chapter video awaiting approval",
        body: `${instructor.name} uploaded “${chapters[idx].title}” for “${course.title}”.`,
        audience: "admin",
      });

      return { ok: true, chapter: chapters[idx], course: this.getCourseById(courseId) };
    },

    removeCourseChapter({ instructorId, courseId, chapterId }) {
      const instructor = this.getUsers().find((u) => u.id === instructorId);
      if (!instructor || !this.canAccessTeachSection(instructor)) {
        return { ok: false, error: "Only active tutors can remove chapters." };
      }
      const course = this.getCourses().find((c) => c.id === courseId && c.instructorId === instructorId);
      if (!course) return { ok: false, error: "Course not found." };
      const chapters = Array.isArray(course.chapters) ? course.chapters.slice() : [];
      const target = chapters.find((ch) => ch.id === chapterId);
      if (!target) return { ok: false, error: "Chapter not found." };
      if (target.videoId) deleteVideoBlob(target.videoId).catch(() => {});
      const next = chapters
        .filter((ch) => ch.id !== chapterId)
        .map((ch, i) => ({ ...ch, order: i + 1 }));
      this.updateCourse(courseId, { chapters: next });
      return { ok: true, course: this.getCourseById(courseId) };
    },

    getPendingCourseVideos() {
      const pending = [];
      this.getCourses().forEach((course) => {
        const chapters = this.getCourseChapters(course);
        chapters.forEach((ch) => {
          if (ch.videoStatus !== "pending") return;
          pending.push({
            id: course.id + "::" + ch.id,
            courseId: course.id,
            chapterId: ch.id,
            title: course.title,
            chapterTitle: ch.title,
            instructorName: course.instructorName,
            videoId: ch.videoId,
            videoFileName: ch.videoFileName,
            videoFileSize: ch.videoFileSize,
          });
        });
      });
      return pending;
    },

    approveCourseVideo(courseId, chapterId) {
      const course = this.getCourseById(courseId);
      if (!course) return { ok: false, error: "Course not found." };

      // Legacy single-video approval
      if (!chapterId || String(chapterId).startsWith("ch_legacy_")) {
        if (course.videoStatus === "pending" && (!Array.isArray(course.chapters) || !course.chapters.length)) {
          this.updateCourse(courseId, {
            videoStatus: "approved",
            videoApprovedAt: new Date().toISOString(),
            videoRejectReason: "",
          });
          this.addNotification({
            title: "Course video approved",
            body: `Your video for “${course.title}” was approved and is now available to enrolled students.`,
            userId: course.instructorId,
            audience: "user",
          });
          return { ok: true };
        }
      }

      const chapters = Array.isArray(course.chapters) ? course.chapters.slice() : [];
      const idx = chapters.findIndex((ch) => ch.id === chapterId);
      if (idx < 0 || chapters[idx].videoStatus !== "pending") {
        return { ok: false, error: "No pending video for this chapter." };
      }
      chapters[idx] = {
        ...chapters[idx],
        videoStatus: "approved",
        videoApprovedAt: new Date().toISOString(),
        videoRejectReason: "",
      };
      this.updateCourse(courseId, { chapters });
      this.addNotification({
        title: "Chapter video approved",
        body: `“${chapters[idx].title}” in “${course.title}” was approved and is available to enrolled students.`,
        userId: course.instructorId,
        audience: "user",
      });
      return { ok: true };
    },

    rejectCourseVideo(courseId, chapterId, reason) {
      const course = this.getCourseById(courseId);
      if (!course) return { ok: false, error: "Course not found." };
      const note = String(reason || "Needs changes").trim();

      if (!chapterId || String(chapterId).startsWith("ch_legacy_")) {
        if (course.videoStatus === "pending" && (!Array.isArray(course.chapters) || !course.chapters.length)) {
          this.updateCourse(courseId, {
            videoStatus: "rejected",
            videoRejectReason: note,
          });
          this.addNotification({
            title: "Course video rejected",
            body: `Your video for “${course.title}” was rejected. ${note}`.trim(),
            userId: course.instructorId,
            audience: "user",
          });
          return { ok: true };
        }
      }

      const chapters = Array.isArray(course.chapters) ? course.chapters.slice() : [];
      const idx = chapters.findIndex((ch) => ch.id === chapterId);
      if (idx < 0 || chapters[idx].videoStatus !== "pending") {
        return { ok: false, error: "No pending video for this chapter." };
      }
      chapters[idx] = {
        ...chapters[idx],
        videoStatus: "rejected",
        videoRejectReason: note,
      };
      this.updateCourse(courseId, { chapters });
      this.addNotification({
        title: "Chapter video rejected",
        body: `“${chapters[idx].title}” in “${course.title}” was rejected. ${note}`.trim(),
        userId: course.instructorId,
        audience: "user",
      });
      return { ok: true };
    },

    deleteCourse(id) {
      const course = this.getCourseById(id);
      if (course) {
        if (course.videoId) deleteVideoBlob(course.videoId).catch(() => {});
        (course.chapters || []).forEach((ch) => {
          if (ch.videoId) deleteVideoBlob(ch.videoId).catch(() => {});
        });
      }
      this.saveCourses(this.getCourses().filter((c) => c.id !== id));
    },

    getEnrollments() {
      return read(ENROLLMENTS_KEY, []);
    },

    saveEnrollments(items) {
      write(ENROLLMENTS_KEY, items);
    },

    getEnrollmentsByUser(userId) {
      return this.getEnrollments().filter((e) => e.userId === userId);
    },

    getEnrollment(courseId, userId) {
      return this.getEnrollments().find((e) => e.courseId === courseId && e.userId === userId) || null;
    },

    enrollInCourse({ courseId, userId, userName, userEmail }) {
      const course = this.getCourses().find((c) => c.id === courseId && c.status === "live");
      if (!course) return { ok: false, error: "Course is not available." };
      const tutor = this.getUsers().find((u) => u.id === course.instructorId);
      if (this.isTutorBanned(tutor)) {
        return { ok: false, error: "This tutor is currently banned. Enrollment is unavailable." };
      }
      if (this.getEnrollment(courseId, userId)) {
        return { ok: false, error: "You are already enrolled in this course." };
      }
      const amount = Number(course.price) || 0;
      if (amount <= 0) return { ok: false, error: "Invalid course price." };

      const feeRate = this.getTutorFeeRate();
      const fee = Number((amount * feeRate).toFixed(2));
      const paidAt = new Date();
      const endAt = new Date(paidAt.getTime() + course.durationDays * 24 * 60 * 60 * 1000);

      // Payment must succeed before enrollment is created
      this.saveOrder({
        id: "ord_course_" + Date.now(),
        listingId: course.id,
        title: "Course: " + course.title,
        sellerId: course.instructorId,
        sellerName: course.instructorName,
        amount,
        platformFee: fee,
        feePercent: Number((feeRate * 100).toFixed(2)),
        sellerPayout: Number((amount - fee).toFixed(2)),
        deliveryStatus: "completed",
        refundStatus: "none",
        type: "course",
        createdAt: paidAt.toISOString(),
      });

      const enrollment = {
        id: "enroll_" + Date.now(),
        courseId: course.id,
        courseTitle: course.title,
        instructorId: course.instructorId,
        instructorName: course.instructorName,
        userId,
        userName,
        userEmail,
        amount,
        paid: true,
        paidAt: paidAt.toISOString(),
        startAt: paidAt.toISOString(),
        endAt: endAt.toISOString(),
        durationDays: course.durationDays,
        status: "active",
        certStatus: "none",
        certRequestedAt: null,
        certIssuedAt: null,
        chapterProgress: {},
        lastChapterId: "",
        lastVideoTime: 0,
        lastMaxWatched: 0,
        lastOpenedAt: paidAt.toISOString(),
      };
      const items = this.getEnrollments();
      items.unshift(enrollment);
      this.saveEnrollments(items);
      return { ok: true, enrollment };
    },

    saveLearningResume({ userId, courseId, chapterId, videoTime, maxWatched }) {
      const enrollment = this.getEnrollment(courseId, userId);
      if (!enrollment) return { ok: false, error: "Enrollment not found." };
      const time = Math.max(0, Number(videoTime) || 0);
      const max = Math.max(time, Number(maxWatched) || 0, Number(enrollment.lastMaxWatched) || 0);
      this.updateEnrollment(enrollment.id, {
        lastChapterId: String(chapterId || enrollment.lastChapterId || ""),
        lastVideoTime: Number(time.toFixed(2)),
        lastMaxWatched: Number(max.toFixed(2)),
        lastOpenedAt: new Date().toISOString(),
      });
      return { ok: true, enrollment: this.getEnrollment(courseId, userId) };
    },

    getResumeTarget(course, enrollment) {
      if (!course || !enrollment) return null;
      const access = this.getStudentChapterAccess(course, enrollment);
      if (!access.length) return null;
      const savedId = enrollment.lastChapterId || "";
      let chapter = access.find((ch) => ch.id === savedId && ch.unlocked) || null;
      if (!chapter) {
        chapter = access.find((ch) => ch.unlocked && !ch.passed) || access.find((ch) => ch.unlocked) || access[0];
      }
      if (!chapter || !chapter.unlocked) return null;
      const sameChapter = chapter.id === savedId;
      return {
        chapterId: chapter.id,
        videoId: chapter.videoId || "",
        title: chapter.title || "Lesson",
        videoTime: sameChapter ? Math.max(0, Number(enrollment.lastVideoTime) || 0) : 0,
        maxWatched: sameChapter
          ? Math.max(
              Number(enrollment.lastMaxWatched) || 0,
              Number(enrollment.lastVideoTime) || 0
            )
          : 0,
      };
    },

    refreshEnrollmentProgress(enrollment) {
      if (!enrollment) return enrollment;
      const now = Date.now();
      const end = new Date(enrollment.endAt).getTime();
      if (enrollment.status === "active" && now >= end) {
        const next = { ...enrollment, status: "completed" };
        this.saveEnrollments(
          this.getEnrollments().map((e) => (e.id === enrollment.id ? next : e))
        );
        return next;
      }
      return enrollment;
    },

    requestCertificate(enrollmentId, userId) {
      let enrollment = this.getEnrollments().find((e) => e.id === enrollmentId && e.userId === userId);
      if (!enrollment) return { ok: false, error: "Enrollment not found." };
      enrollment = this.refreshEnrollmentProgress(enrollment);
      if (enrollment.status !== "completed") {
        return { ok: false, error: "Finish the learning duration before requesting a certificate." };
      }
      if (enrollment.certStatus === "requested" || enrollment.certStatus === "issued") {
        return { ok: false, error: "Certificate already requested or issued." };
      }
      const next = {
        ...enrollment,
        certStatus: "requested",
        certRequestedAt: new Date().toISOString(),
      };
      this.saveEnrollments(this.getEnrollments().map((e) => (e.id === enrollmentId ? next : e)));
      return { ok: true, enrollment: next };
    },

    updateEnrollment(id, patch) {
      this.saveEnrollments(this.getEnrollments().map((e) => (e.id === id ? { ...e, ...patch } : e)));
    },

    issueCertificate(enrollmentId) {
      const enrollment = this.getEnrollments().find((e) => e.id === enrollmentId);
      if (!enrollment) return { ok: false, error: "Enrollment not found." };
      this.updateEnrollment(enrollmentId, {
        certStatus: "issued",
        certIssuedAt: new Date().toISOString(),
        status: "completed",
      });
      return { ok: true };
    },

    getChapterTest(course, chapterId) {
      const chapters = this.getCourseChapters(course);
      const chapter = chapters.find((ch) => ch.id === chapterId);
      if (!chapter) return null;
      const test = chapter.test || { passScore: 70, questions: [] };
      return {
        passScore: Number(test.passScore) || 70,
        questions: Array.isArray(test.questions) ? test.questions : [],
      };
    },

    saveChapterTest({ instructorId, courseId, chapterId, passScore, questions }) {
      const instructor = this.getUsers().find((u) => u.id === instructorId);
      if (!instructor || !this.canAccessTeachSection(instructor)) {
        return { ok: false, error: "Only active tutors can edit chapter tests." };
      }
      const course = this.getCourses().find((c) => c.id === courseId && c.instructorId === instructorId);
      if (!course) return { ok: false, error: "Course not found." };

      let chapters = Array.isArray(course.chapters) ? course.chapters.slice() : [];
      if (!chapters.length) {
        return { ok: false, error: "Add real chapters before creating tests." };
      }
      const idx = chapters.findIndex((ch) => ch.id === chapterId);
      if (idx < 0) return { ok: false, error: "Chapter not found." };

      const score = Math.max(1, Math.min(100, Number(passScore) || 70));
      const cleanQuestions = (Array.isArray(questions) ? questions : [])
        .map((q, i) => {
          const prompt = String(q.prompt || "").trim();
          const options = (Array.isArray(q.options) ? q.options : [])
            .map((o) => String(o || "").trim())
            .filter(Boolean);
          const answerIndex = Number(q.answerIndex);
          if (!prompt || options.length < 2) return null;
          if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) {
            return null;
          }
          return {
            id: q.id || "q_" + Date.now() + "_" + i,
            prompt,
            options,
            answerIndex,
          };
        })
        .filter(Boolean);

      if (!cleanQuestions.length) {
        return { ok: false, error: "Add at least one question with 2+ options and a correct answer." };
      }

      chapters[idx] = {
        ...chapters[idx],
        test: { passScore: score, questions: cleanQuestions },
      };
      this.updateCourse(courseId, { chapters });
      return { ok: true, course: this.getCourseById(courseId), chapter: chapters[idx] };
    },

    hasPassedChapter(enrollment, chapterId) {
      if (!enrollment || !chapterId) return false;
      const progress = enrollment.chapterProgress || {};
      return !!(progress[chapterId] && progress[chapterId].passed);
    },

    isChapterUnlocked(course, enrollment, chapterId) {
      const chapters = this.getCourseChapters(course).filter(
        (ch) => ch.videoStatus === "approved" && ch.videoId
      );
      const idx = chapters.findIndex((ch) => ch.id === chapterId);
      if (idx < 0) return false;
      if (idx === 0) return true;
      const prev = chapters[idx - 1];
      return this.hasPassedChapter(enrollment, prev.id);
    },

    getStudentChapterAccess(course, enrollment) {
      const chapters = this.getCourseChapters(course).filter(
        (ch) => ch.videoStatus === "approved" && ch.videoId
      );
      return chapters.map((ch, idx) => {
        const test = this.getChapterTest(course, ch.id);
        const progress = (enrollment && enrollment.chapterProgress && enrollment.chapterProgress[ch.id]) || null;
        const unlocked = idx === 0 || this.hasPassedChapter(enrollment, chapters[idx - 1].id);
        const hasTest = !!(test && test.questions.length);
        return {
          ...ch,
          unlocked,
          hasTest,
          passScore: test ? test.passScore : 70,
          questionCount: test ? test.questions.length : 0,
          passed: !!(progress && progress.passed),
          score: progress ? progress.score : null,
          attempts: progress ? progress.attempts || 0 : 0,
        };
      });
    },

    submitChapterTest({ userId, courseId, chapterId, answers }) {
      const course = this.getCourseById(courseId);
      if (!course || course.status !== "live") {
        return { ok: false, error: "Course not available." };
      }
      let enrollment = this.getEnrollment(courseId, userId);
      if (!enrollment) return { ok: false, error: "You are not enrolled in this course." };
      enrollment = this.refreshEnrollmentProgress(enrollment);

      if (!this.isChapterUnlocked(course, enrollment, chapterId)) {
        return { ok: false, error: "Pass the previous chapter test before taking this one." };
      }

      const test = this.getChapterTest(course, chapterId);
      if (!test || !test.questions.length) {
        return { ok: false, error: "This chapter does not have a test yet." };
      }

      const answerMap = answers && typeof answers === "object" ? answers : {};
      let correct = 0;
      test.questions.forEach((q) => {
        if (Number(answerMap[q.id]) === q.answerIndex) correct += 1;
      });
      const score = Math.round((correct / test.questions.length) * 100);
      const passed = score >= test.passScore;
      const prev = (enrollment.chapterProgress && enrollment.chapterProgress[chapterId]) || {};
      const entry = {
        passed: passed || !!prev.passed,
        score: Math.max(Number(prev.score) || 0, score),
        attempts: (Number(prev.attempts) || 0) + 1,
        lastAttemptAt: new Date().toISOString(),
        passedAt: passed || prev.passed ? prev.passedAt || new Date().toISOString() : null,
      };

      const chapterProgress = { ...(enrollment.chapterProgress || {}), [chapterId]: entry };
      this.updateEnrollment(enrollment.id, { chapterProgress });

      if (passed) {
        const chapter = this.getCourseChapters(course).find((ch) => ch.id === chapterId);
        this.addNotification({
          title: "Chapter test passed",
          body: `${enrollment.userName} passed “${chapter ? chapter.title : "a chapter"}” in “${course.title}” (${score}%).`,
          userId: course.instructorId,
          audience: "user",
        });
      }

      return {
        ok: true,
        passed,
        score,
        passScore: test.passScore,
        correct,
        total: test.questions.length,
        enrollment: this.getEnrollment(courseId, userId),
      };
    },

    getChapterProgressSheet(instructorId, courseId) {
      const course = this.getCourses().find((c) => c.id === courseId && c.instructorId === instructorId);
      if (!course) return { ok: false, error: "Course not found." };
      const chapters = this.getCourseChapters(course);
      const enrollments = this.getEnrollments()
        .filter((e) => e.courseId === courseId && e.instructorId === instructorId)
        .map((e) => this.refreshEnrollmentProgress(e));

      const rows = enrollments.map((e) => {
        const cells = {};
        chapters.forEach((ch) => {
          const progress = (e.chapterProgress && e.chapterProgress[ch.id]) || null;
          cells[ch.id] = {
            passed: !!(progress && progress.passed),
            score: progress ? progress.score : null,
            attempts: progress ? progress.attempts || 0 : 0,
            passedAt: progress ? progress.passedAt : null,
          };
        });
        return {
          userId: e.userId,
          userName: e.userName || "Student",
          userEmail: e.userEmail || "",
          status: e.status,
          cells,
        };
      });

      return {
        ok: true,
        course,
        chapters: chapters.map((ch) => ({
          id: ch.id,
          title: ch.title,
          hasTest: !!(ch.test && Array.isArray(ch.test.questions) && ch.test.questions.length),
        })),
        rows,
      };
    },

    getBlogPosts() {
      return read(BLOG_KEY, [])
        .slice()
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    },

    getSocialPosts() {
      return this.getBlogPosts();
    },

    saveBlogPosts(items) {
      write(BLOG_KEY, items);
    },

    getBlogPostById(id) {
      return this.getBlogPosts().find((p) => p.id === id) || null;
    },

    getSocialPostById(id) {
      return this.getBlogPostById(id);
    },

    getVisibleSocialPosts({ followingOnly = false, viewerId = null } = {}) {
      const cacheKey =
        "social_feed:" + (followingOnly ? "1" : "0") + ":" + (viewerId || "anon");
      const cached = cacheGet(cacheKey);
      if (cached) return cached;

      const usersById = new Map(this.getUsers().map((u) => [u.id, u]));
      let posts = this.getSocialPosts().filter((p) => {
        if (p.status !== "published") return false;
        const author = usersById.get(p.authorId);
        if (author && this.isAccountSuspended(author)) return false;
        return true;
      });
      if (followingOnly && viewerId) {
        const following = new Set(this.getFollowingIds(viewerId));
        posts = posts.filter((p) => p.authorId === viewerId || following.has(p.authorId));
      }
      const enriched = posts.map((p) => {
        const author = usersById.get(p.authorId);
        const comments = (Array.isArray(p.comments) ? p.comments : [])
          .map((c) => {
            const cAuthor = usersById.get(c.authorId);
            if (cAuthor && this.isAccountSuspended(cAuthor)) return null;
            return {
              ...c,
              authorName: (cAuthor && cAuthor.name) || c.authorName || "Member",
              authorRole: this.socialRoleLabel(cAuthor),
              authorImage: (cAuthor && cAuthor.profileImage) || "",
            };
          })
          .filter(Boolean)
          .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
        return {
          ...p,
          authorName: (author && author.name) || p.authorName || "Folio",
          authorRole: this.socialRoleLabel(author),
          authorImage: (author && author.profileImage) || "",
          comments,
          commentCount: comments.length,
        };
      });
      return cacheSet(cacheKey, enriched, 3000);
    },

    async prepareSocialImage(file) {
      if (!file) return { ok: false, error: "Choose an image." };
      if (!String(file.type || "").startsWith("image/")) {
        return { ok: false, error: "Upload an image file (JPG, PNG, or WebP)." };
      }
      if (file.size > 8 * 1024 * 1024) {
        return { ok: false, error: "Image must be 8MB or smaller." };
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const max = 1200;
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL("image/jpeg", 0.82));
          };
          img.onerror = () => reject(new Error("Could not read that image."));
          img.src = String(reader.result || "");
        };
        reader.onerror = () => reject(new Error("Could not read that image."));
        reader.readAsDataURL(file);
      }).catch((err) => ({ __error: err.message || "Could not process image." }));

      if (dataUrl && dataUrl.__error) {
        return { ok: false, error: dataUrl.__error };
      }
      return { ok: true, dataUrl };
    },

    createBlogPost({ authorId, authorName, title, excerpt, body, coverImage }) {
      const author = this.getUsers().find((u) => u.id === authorId);
      if (!this.canPostToSocial(author)) {
        return {
          ok: false,
          error: author && this.isAccountSuspended(author)
            ? "Your account is suspended."
            : "Sign in as a student or tutor to post.",
        };
      }
      const rate = consumeRateLimit("social_post", authorId);
      if (!rate.ok) return { ok: false, error: rate.error };
      const cleanBody = String(body || "").trim();
      const image = String(coverImage || "").trim();
      if (!cleanBody && !image) {
        return { ok: false, error: "Add a message or photo to post." };
      }
      const cleanTitle =
        String(title || "").trim() ||
        (cleanBody ? cleanBody.slice(0, 80) : "Photo update");
      const post = {
        id: "blog_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        title: cleanTitle,
        excerpt: String(excerpt || "").trim() || cleanBody.slice(0, 160),
        body: cleanBody,
        coverImage: image,
        authorId,
        authorName: authorName || author.name || "Folio",
        authorRole: this.socialRoleLabel(author),
        comments: [],
        status: "published",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const items = this.getBlogPosts();
      items.unshift(post);
      this.saveBlogPosts(items);
      return { ok: true, post };
    },

    createSocialPost(payload) {
      return this.createBlogPost(payload);
    },

    async createSocialPostWithImage({ authorId, authorName, body, file }) {
      let coverImage = "";
      if (file) {
        const prepared = await this.prepareSocialImage(file);
        if (!prepared.ok) return prepared;
        coverImage = prepared.dataUrl;
      }
      return this.createBlogPost({
        authorId,
        authorName,
        body,
        coverImage,
      });
    },

    addSocialComment({ postId, authorId, body }) {
      const author = this.getUsers().find((u) => u.id === authorId);
      if (!this.canPostToSocial(author)) {
        return {
          ok: false,
          error: author && this.isAccountSuspended(author)
            ? "Your account is suspended."
            : "Sign in to comment.",
        };
      }
      const rate = consumeRateLimit("social_comment", authorId);
      if (!rate.ok) return { ok: false, error: rate.error };
      const cleanBody = String(body || "").trim();
      if (!cleanBody) return { ok: false, error: "Write a comment first." };
      if (cleanBody.length > 1000) {
        return { ok: false, error: "Comments can be up to 1000 characters." };
      }
      const items = this.getBlogPosts();
      const idx = items.findIndex((p) => p.id === postId);
      if (idx < 0) return { ok: false, error: "Post not found." };
      const comment = {
        id: "cmt_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        authorId,
        authorName: author.name || "Member",
        body: cleanBody,
        createdAt: new Date().toISOString(),
      };
      const comments = Array.isArray(items[idx].comments) ? items[idx].comments.slice() : [];
      comments.push(comment);
      items[idx] = {
        ...items[idx],
        comments,
        updatedAt: new Date().toISOString(),
      };
      this.saveBlogPosts(items);
      return { ok: true, comment, post: items[idx] };
    },

    deleteSocialComment({ postId, commentId, actorId }) {
      const actor = this.getUsers().find((u) => u.id === actorId);
      if (!actor) return { ok: false, error: "Sign in to delete a comment." };
      const items = this.getBlogPosts();
      const idx = items.findIndex((p) => p.id === postId);
      if (idx < 0) return { ok: false, error: "Post not found." };
      const comments = Array.isArray(items[idx].comments) ? items[idx].comments.slice() : [];
      const comment = comments.find((c) => c.id === commentId);
      if (!comment) return { ok: false, error: "Comment not found." };
      const allowed =
        actor.role === "admin" ||
        comment.authorId === actorId ||
        items[idx].authorId === actorId;
      if (!allowed) {
        return { ok: false, error: "You cannot delete this comment." };
      }
      items[idx] = {
        ...items[idx],
        comments: comments.filter((c) => c.id !== commentId),
        updatedAt: new Date().toISOString(),
      };
      this.saveBlogPosts(items);
      return { ok: true, post: items[idx] };
    },

    deleteBlogPost(postId, actorId) {
      const actor = this.getUsers().find((u) => u.id === actorId);
      if (!actor) return { ok: false, error: "Sign in to delete a post." };
      const items = this.getBlogPosts();
      const post = items.find((p) => p.id === postId);
      if (!post) return { ok: false, error: "Post not found." };
      const isAdmin = actor.role === "admin";
      const isAuthor = post.authorId === actorId;
      if (!isAdmin && !isAuthor) {
        return { ok: false, error: "Only the author or an admin can delete this post." };
      }
      this.saveBlogPosts(items.filter((p) => p.id !== postId));
      return { ok: true };
    },

    deleteSocialPost(postId, actorId) {
      return this.deleteBlogPost(postId, actorId);
    },

    getFollows() {
      return read(FOLLOWS_KEY, []);
    },

    saveFollows(items) {
      write(FOLLOWS_KEY, items);
    },

    getFollowingIds(userId) {
      return this.getFollows()
        .filter((f) => f.followerId === userId)
        .map((f) => f.followingId);
    },

    getFollowerIds(userId) {
      return this.getFollows()
        .filter((f) => f.followingId === userId)
        .map((f) => f.followerId);
    },

    isFollowing(followerId, followingId) {
      if (!followerId || !followingId || followerId === followingId) return false;
      return this.getFollows().some(
        (f) => f.followerId === followerId && f.followingId === followingId
      );
    },

    getFollowCounts(userId) {
      return {
        followers: this.getFollowerIds(userId).length,
        following: this.getFollowingIds(userId).length,
      };
    },

    followUser({ followerId, followingId }) {
      const follower = this.getUsers().find((u) => u.id === followerId);
      const target = this.getUsers().find((u) => u.id === followingId);
      if (!follower || this.isAccountSuspended(follower)) {
        return { ok: false, error: "Sign in to follow people." };
      }
      if (!target || target.role === "admin") {
        return { ok: false, error: "That profile cannot be followed." };
      }
      if (this.isAccountSuspended(target)) {
        return { ok: false, error: "That account is unavailable." };
      }
      if (followerId === followingId) {
        return { ok: false, error: "You cannot follow yourself." };
      }
      if (this.isFollowing(followerId, followingId)) {
        return { ok: true, following: true };
      }
      const rate = consumeRateLimit("follow", followerId);
      if (!rate.ok) return { ok: false, error: rate.error };
      const items = this.getFollows();
      items.push({
        id: "fol_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
        followerId,
        followingId,
        createdAt: new Date().toISOString(),
      });
      this.saveFollows(items);
      return { ok: true, following: true };
    },

    unfollowUser({ followerId, followingId }) {
      const follower = this.getUsers().find((u) => u.id === followerId);
      if (!follower) return { ok: false, error: "Sign in to unfollow." };
      this.saveFollows(
        this.getFollows().filter(
          (f) => !(f.followerId === followerId && f.followingId === followingId)
        )
      );
      return { ok: true, following: false };
    },

    toggleFollow({ followerId, followingId }) {
      if (this.isFollowing(followerId, followingId)) {
        return this.unfollowUser({ followerId, followingId });
      }
      return this.followUser({ followerId, followingId });
    },

    suspendAccount({ adminId, userId, reason }) {
      const admin = this.getUsers().find((u) => u.id === adminId);
      if (!admin || admin.role !== "admin") {
        return { ok: false, error: "Only admins can suspend accounts." };
      }
      const target = this.getUsers().find((u) => u.id === userId);
      if (!target || target.role === "admin") {
        return { ok: false, error: "Account not found." };
      }
      const cleanReason = String(reason || "").trim() || "Violated Folio community rules.";
      this.updateUser(userId, {
        accountStatus: "suspended",
        suspendReason: cleanReason,
        suspendedAt: new Date().toISOString(),
        suspendedBy: adminId,
      });
      const session = this.getSession();
      if (session && session.userId === userId) {
        this.logout();
      }
      this.addNotification({
        title: "Account suspended",
        body: `Your Folio account was suspended. Reason: ${cleanReason}`,
        userId,
        audience: "user",
      });
      return { ok: true, user: this.getUsers().find((u) => u.id === userId) };
    },

    unsuspendAccount({ adminId, userId }) {
      const admin = this.getUsers().find((u) => u.id === adminId);
      if (!admin || admin.role !== "admin") {
        return { ok: false, error: "Only admins can unsuspend accounts." };
      }
      const target = this.getUsers().find((u) => u.id === userId);
      if (!target) return { ok: false, error: "Account not found." };
      this.updateUser(userId, {
        accountStatus: "active",
        suspendReason: "",
        suspendedAt: "",
        suspendedBy: "",
        unsuspendedAt: new Date().toISOString(),
      });
      this.addNotification({
        title: "Account restored",
        body: "Your Folio account suspension was lifted. You can sign in again.",
        userId,
        audience: "user",
      });
      return { ok: true, user: this.getUsers().find((u) => u.id === userId) };
    },

    deleteAccount({ adminId, userId }) {
      const admin = this.getUsers().find((u) => u.id === adminId);
      if (!admin || admin.role !== "admin") {
        return { ok: false, error: "Only admins can delete accounts." };
      }
      const target = this.getUsers().find((u) => u.id === userId);
      if (!target || target.role === "admin") {
        return { ok: false, error: "Account not found." };
      }
      write(
        USERS_KEY,
        this.getUsers().filter((u) => u.id !== userId)
      );
      this.saveBlogPosts(
        this.getBlogPosts()
          .filter((p) => p.authorId !== userId)
          .map((p) => ({
            ...p,
            comments: (Array.isArray(p.comments) ? p.comments : []).filter(
              (c) => c.authorId !== userId
            ),
          }))
      );
      this.saveFollows(
        this.getFollows().filter(
          (f) => f.followerId !== userId && f.followingId !== userId
        )
      );
      this.saveNotifications(
        this.getNotifications().filter((n) => n.userId !== userId)
      );
      const session = this.getSession();
      if (session && session.userId === userId) {
        this.logout();
      }
      normalizeSchema();
      return { ok: true };
    },

    auditSocialData() {
      const users = this.getUsers();
      const userIds = new Set(users.map((u) => u.id));
      const posts = this.getBlogPosts();
      const follows = this.getFollows();
      const issues = [];

      users.forEach((u) => {
        if (!u.id || !u.email) issues.push(`User missing id/email: ${u.name || "?"}`);
        if (!["active", "suspended"].includes(u.accountStatus || "active")) {
          issues.push(`Bad accountStatus on ${u.email}`);
        }
        if (u.role === "customer" && !u.instructorStatus) {
          issues.push(`Missing instructorStatus on ${u.email}`);
        }
      });

      posts.forEach((p) => {
        if (!Array.isArray(p.comments)) issues.push(`Post ${p.id} missing comments[]`);
        if (p.authorId && !userIds.has(p.authorId)) {
          issues.push(`Orphan post author ${p.authorId} on ${p.id}`);
        }
        (p.comments || []).forEach((c) => {
          if (c.authorId && !userIds.has(c.authorId)) {
            issues.push(`Orphan comment author ${c.authorId} on ${p.id}`);
          }
        });
      });

      follows.forEach((f) => {
        if (!userIds.has(f.followerId) || !userIds.has(f.followingId)) {
          issues.push(`Orphan follow ${f.id || f.followerId + "->" + f.followingId}`);
        }
      });

      return {
        ok: issues.length === 0,
        issues,
        counts: {
          users: users.length,
          posts: posts.length,
          follows: follows.length,
          comments: posts.reduce((n, p) => n + (p.comments || []).length, 0),
          suspended: users.filter((u) => u.accountStatus === "suspended").length,
        },
      };
    },

    isInstructorApproved(user) {
      return !!(user && user.instructorStatus === "approved");
    },
  };
})();

