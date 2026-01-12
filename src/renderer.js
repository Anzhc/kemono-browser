const PAGE_SIZE = 50;
const IMAGE_EXTS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "bmp",
  "svg",
]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv", "avi"]);

const state = {
  dataBase: "",
  thumbBase: "",
  creators: [],
  creatorsSorted: [],
  services: [],
  artistQuery: "",
  serviceFilter: "all",
  artistsPage: 0,
  filteredArtists: [],
  favoriteArtists: new Set(),
  artistView: "search",
  selectedArtist: null,
  artistProfile: null,
  posts: [],
  postsOffset: 0,
  postsQuery: "",
  postsByKey: new Map(),
  postCache: new Map(),
  galleryPosts: [],
  serializePosts: false,
  postsMinMedia: 0,
  postListItems: new Map(),
  postsRequestId: 0,
  postsAll: [],
  postsAllKey: "",
  galleryTimelineVisible: false,
  outputFolder: "",
};

const gifPreviewCache = new Map();
const downloadedImages = new Set();
const memoryMedia = new Map();
const downloadProgress = new Map();
const galleryLoadState = {
  token: 0,
  active: 0,
  queue: [],
};

const MAX_GALLERY_WORKERS = 10;

const elements = {
  statusMessage: document.getElementById("statusMessage"),
  artistSearch: document.getElementById("artistSearch"),
  serviceFilter: document.getElementById("serviceFilter"),
  artistsPrev: document.getElementById("artistsPrev"),
  artistsNext: document.getElementById("artistsNext"),
  artistsPageInfo: document.getElementById("artistsPageInfo"),
  artistsList: document.getElementById("artistsList"),
  artistTabSearch: document.getElementById("artistTabSearch"),
  artistTabFavorites: document.getElementById("artistTabFavorites"),
  artistTitle: document.getElementById("artistTitle"),
  artistSubtitle: document.getElementById("artistSubtitle"),
  postSearch: document.getElementById("postSearch"),
  refreshPosts: document.getElementById("refreshPosts"),
  postsPrev: document.getElementById("postsPrev"),
  postsNext: document.getElementById("postsNext"),
  postsPageInfo: document.getElementById("postsPageInfo"),
  postsList: document.getElementById("postsList"),
  serializePosts: document.getElementById("serializePosts"),
  minMediaFilter: document.getElementById("minMediaFilter"),
  splitterArtistsGallery: document.getElementById("splitterArtistsGallery"),
  splitterGalleryPosts: document.getElementById("splitterGalleryPosts"),
  galleryShell: document.getElementById("galleryShell"),
  gallery: document.getElementById("gallery"),
  gallerySideTimeline: document.getElementById("gallerySideTimeline"),
  timeline: document.getElementById("timeline"),
  refreshGalleryImages: document.getElementById("refreshGalleryImages"),
  clearGallery: document.getElementById("clearGallery"),
  toggleGalleryTimeline: document.getElementById("toggleGalleryTimeline"),
  setOutputFolder: document.getElementById("setOutputFolder"),
};

function setStatus(message, tone = "info") {
  elements.statusMessage.textContent = message;
  elements.statusMessage.dataset.tone = tone;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}

function formatMb(value) {
  if (!Number.isFinite(value)) {
    return "0.0";
  }
  return (value / (1024 * 1024)).toFixed(1);
}

function sanitizeFilename(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDate(value) {
  if (!value) {
    return "Unknown";
  }
  const date = new Date(value);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function capitalize(value) {
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildPostKey(post) {
  return `${post.service}:${post.user}:${post.id}`;
}

function getArtistKey(artist) {
  return `${artist.service}:${artist.id}`;
}

function isArtistFavorite(artist) {
  return state.favoriteArtists.has(getArtistKey(artist));
}

async function persistFavorites() {
  if (!window.kemono.saveFavorites) {
    return;
  }
  try {
    await window.kemono.saveFavorites([...state.favoriteArtists]);
  } catch (error) {
    setStatus(`Failed to save favorites: ${error.message}`, "error");
  }
}

function setArtistView(view) {
  state.artistView = view;
  if (elements.artistTabSearch) {
    elements.artistTabSearch.classList.toggle("is-active", view === "search");
  }
  if (elements.artistTabFavorites) {
    elements.artistTabFavorites.classList.toggle("is-active", view === "favorites");
  }
  applyArtistFilter();
}

function isNumericLabel(text) {
  const trimmed = String(text || "").trim().toLowerCase();
  if (!trimmed) {
    return false;
  }
  if (/^\d+(?:\s*[-–—]\s*\d+)?$/.test(trimmed)) {
    return true;
  }
  if (
    /^\d+(?:\s*[-–—]\s*\d+)?(?:\s*[,&/]\s*\d+(?:\s*[-–—]\s*\d+)?)*$/.test(
      trimmed
    )
  ) {
    return true;
  }
  if (
    /^(?:part|pt|chapter|ch|episode|ep|vol|volume|book|#)\s*\d+(?:\s*[-–—]\s*\d+)?$/.test(
      trimmed
    )
  ) {
    return true;
  }
  return false;
}

function stripSeriesSuffix(title) {
  let text = String(title || "").trim();
  if (!text) {
    return "";
  }
  let suffix = "";
  const bracketMatch = text.match(/\s*([\(\[\{]([^)\]\}]*)[\)\]\}])\s*$/);
  if (bracketMatch) {
    const inner = bracketMatch[2] || "";
    if (isNumericLabel(inner)) {
      text = text.slice(0, text.length - bracketMatch[0].length).trim();
    } else {
      suffix = ` ${bracketMatch[1].trim()}`;
      text = text.slice(0, text.length - bracketMatch[0].length).trim();
    }
  }
  text = text
    .replace(
      /(?:\s*[-:]*\s*(?:part|pt|chapter|ch|episode|ep|vol|volume|book|#)\s*\d+(?:\s*[-–—]\s*\d+)?|\s*[-:]*\s*\d+(?:\s*[-–—]\s*\d+)?)\s*$/i,
      ""
    )
    .trim();
  text = text.replace(/[\s\-–—]+$/u, "").trim();
  if (!text) {
    return String(title || "").trim();
  }
  return `${text}${suffix}`.trim();
}

function getSeriesKey(title) {
  const original = String(title || "").trim().toLowerCase();
  const stripped = stripSeriesSuffix(title).toLowerCase();
  if (!stripped || stripped.length < 3 || stripped === original) {
    return "";
  }
  return stripped;
}

function buildSerializedPosts(posts) {
  const counts = new Map();
  const groups = new Map();

  posts.forEach((post) => {
    const keyBase = getSeriesKey(post.title);
    if (!keyBase) {
      return;
    }
    const key = `${post.service}:${post.user}:${keyBase}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!groups.has(key)) {
      groups.set(key, {
        type: "group",
        key,
        title: stripSeriesSuffix(post.title),
        service: post.service,
        user: post.user,
        posts: [],
      });
    }
    groups.get(key).posts.push(post);
  });

  const seenGroups = new Set();
  const items = [];
  posts.forEach((post) => {
    const keyBase = getSeriesKey(post.title);
    const groupKey = keyBase ? `${post.service}:${post.user}:${keyBase}` : "";
    if (groupKey && counts.get(groupKey) > 1) {
      if (seenGroups.has(groupKey)) {
        return;
      }
      seenGroups.add(groupKey);
      items.push(groups.get(groupKey));
      return;
    }
    items.push({ type: "post", key: buildPostKey(post), post });
  });
  return items;
}

function normalizeBytes(bytes) {
  if (!bytes) {
    return new Uint8Array();
  }
  if (bytes instanceof Uint8Array) {
    return bytes;
  }
  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes);
  }
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer);
  }
  return new Uint8Array(bytes);
}

function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function setPostsEnabled(enabled) {
  elements.postSearch.disabled = !enabled;
  elements.refreshPosts.disabled = !enabled;
  if (!enabled) {
    elements.postsPrev.disabled = true;
    elements.postsNext.disabled = true;
  }
}

function showPostsPlaceholder(message) {
  elements.postsList.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "card post-placeholder";
  empty.textContent = message;
  elements.postsList.appendChild(empty);
}

function getExtension(path) {
  if (!path) {
    return "";
  }
  const parts = path.split(".");
  if (parts.length < 2) {
    return "";
  }
  return parts[parts.length - 1].toLowerCase();
}

function getMediaType(path) {
  const ext = getExtension(path);
  if (IMAGE_EXTS.has(ext)) {
    return "image";
  }
  if (VIDEO_EXTS.has(ext)) {
    return "video";
  }
  return "file";
}

function isGifPath(path) {
  return getExtension(path) === "gif";
}

function buildMediaUrl(path) {
  if (!path) {
    return "";
  }
  return `${state.dataBase}${path}`;
}

function buildThumbUrl(path) {
  if (!path) {
    return "";
  }
  return `${state.thumbBase}${path}`;
}

async function setStaticGifPreview(img, path) {
  try {
    const dataUrl = await getGifPreviewDataUrl(path);
    if (dataUrl) {
      img.src = dataUrl;
    } else {
      img.src = buildThumbUrl(path) || buildMediaUrl(path);
    }
  } catch (error) {
    const parent = img.parentElement;
    if (parent && parent.classList.contains("post-card__thumb")) {
      img.remove();
      const label = document.createElement("div");
      label.className = "post-card__thumb-label";
      label.textContent = "GIF preview unavailable";
      parent.appendChild(label);
    } else {
      img.src = buildThumbUrl(path) || buildMediaUrl(path);
    }
  }
}

async function getGifPreviewDataUrl(path) {
  if (gifPreviewCache.has(path)) {
    return gifPreviewCache.get(path);
  }
  const promise = (async () => {
    try {
      const bytes = await window.kemono.getMediaBytes(path);
      const blob = new Blob([bytes], { type: "image/gif" });
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(bitmap, 0, 0);
        if (typeof bitmap.close === "function") {
          bitmap.close();
        }
        return canvas.toDataURL("image/png");
      }
      if (typeof bitmap.close === "function") {
        bitmap.close();
      }
      return "";
    } catch (error) {
      return "";
    }
  })();
  gifPreviewCache.set(path, promise);
  const result = await promise;
  gifPreviewCache.set(path, result);
  return result;
}

function applyArtistFilter() {
  const query = state.artistQuery.trim().toLowerCase();
  const service = state.serviceFilter;
  const base =
    state.artistView === "favorites"
      ? state.creatorsSorted.filter((artist) => isArtistFavorite(artist))
      : state.creatorsSorted;
  state.filteredArtists = base.filter((artist) => {
    if (service !== "all" && artist.service !== service) {
      return false;
    }
    if (!query) {
      return true;
    }
    const name = (artist.name || "").trim().toLowerCase();
    const id = (artist.id || "").trim().toLowerCase();
    return name.includes(query) || id.includes(query);
  });

  state.artistsPage = 0;
  renderArtists();
}

function renderArtists() {
  const total = state.filteredArtists.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageIndex = Math.min(state.artistsPage, pageCount - 1);
  state.artistsPage = pageIndex;
  const offset = pageIndex * PAGE_SIZE;
  const pageItems = state.filteredArtists.slice(offset, offset + PAGE_SIZE);

  elements.artistsPageInfo.textContent = `Page ${pageIndex + 1} of ${pageCount} - ${formatNumber(
    total
  )} artists`;
  elements.artistsPrev.disabled = pageIndex === 0;
  elements.artistsNext.disabled = offset + PAGE_SIZE >= total;

  elements.artistsList.innerHTML = "";
  if (pageItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.textContent = "No artists found.";
    elements.artistsList.appendChild(empty);
    return;
  }

  pageItems.forEach((artist) => {
    const card = document.createElement("div");
    card.className = "card artist-card";
    card.dataset.service = artist.service;
    card.dataset.id = artist.id;
    card.dataset.name = artist.name || "Unknown";
    const favorite = isArtistFavorite(artist);

    const banner = document.createElement("div");
    banner.className = "artist-card__bg";
    banner.style.backgroundImage = `url(https://img.kemono.cr/banners/${artist.service}/${artist.id})`;

    const shade = document.createElement("div");
    shade.className = "artist-card__shade";

    const body = document.createElement("div");
    body.className = "artist-card__body";

    const titleRow = document.createElement("div");
    titleRow.className = "artist-card__title-row";

    const title = document.createElement("div");
    title.className = "card__title";
    title.textContent = artist.name || "Unknown";

    const favoriteButton = document.createElement("button");
    favoriteButton.type = "button";
    favoriteButton.className = "artist-fav";
    favoriteButton.dataset.action = "favorite";
    favoriteButton.setAttribute("aria-pressed", favorite ? "true" : "false");
    favoriteButton.title = favorite ? "Remove favorite" : "Add favorite";
    if (favorite) {
      favoriteButton.classList.add("is-active");
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      "M12 2l2.9 6.9 7.1.6-5.3 4.7 1.6 7-6.3-3.8-6.3 3.8 1.6-7L2 9.5l7.1-.6L12 2z"
    );
    svg.appendChild(path);
    favoriteButton.appendChild(svg);

    titleRow.appendChild(title);
    titleRow.appendChild(favoriteButton);

    const meta = document.createElement("div");
    meta.className = "card__meta";
    meta.textContent = `${capitalize(artist.service)} - Favorites: ${formatNumber(
      artist.favorited || 0
    )}`;

    const updated = document.createElement("div");
    updated.className = "card__meta";
    updated.textContent = `Updated: ${formatDate(
      artist.updated ? artist.updated * 1000 : null
    )}`;

    body.appendChild(titleRow);
    body.appendChild(meta);
    body.appendChild(updated);

    const avatarWrap = document.createElement("div");
    avatarWrap.className = "artist-card__avatar";
    const avatar = document.createElement("img");
    avatar.src = `https://img.kemono.cr/icons/${artist.service}/${artist.id}`;
    avatar.alt = `${artist.name || "Artist"} avatar`;
    avatar.decoding = "async";
    avatar.fetchPriority = "low";
    avatar.onerror = () => {
      avatarWrap.remove();
    };
    avatarWrap.appendChild(avatar);

    card.appendChild(banner);
    card.appendChild(shade);
    card.appendChild(body);
    card.appendChild(avatarWrap);
    elements.artistsList.appendChild(card);
  });
}

async function selectArtist(artist) {
  state.selectedArtist = artist;
  state.postsOffset = 0;
  state.postsQuery = "";
  elements.postSearch.value = "";
  setPostsEnabled(true);
  setStatus("Loading artist...", "info");

  try {
    state.artistProfile = await window.kemono.getCreatorProfile(
      artist.service,
      artist.id
    );
  } catch (error) {
    state.artistProfile = null;
    setStatus(`Failed to load profile: ${error.message}`, "error");
  }

  const name = (state.artistProfile && state.artistProfile.name) || artist.name;
  elements.artistTitle.textContent = name || "Unknown";
  elements.artistSubtitle.textContent = `${capitalize(artist.service)} - ID ${artist.id}`;

  await loadPosts();
}

function setPostsList(posts) {
  state.posts = posts || [];
  state.postsByKey = new Map();
  state.posts.forEach((post) => {
    state.postsByKey.set(buildPostKey(post), post);
  });
}

async function loadPosts() {
  if (!state.selectedArtist) {
    setPostsEnabled(false);
    elements.postsPageInfo.textContent = "Page 1";
    showPostsPlaceholder("Select an artist to load posts.");
    return;
  }

  const requestId = ++state.postsRequestId;
  setStatus(state.serializePosts ? "Loading all posts..." : "Loading posts...", "info");
  elements.postsList.innerHTML = "";
  setPostsEnabled(true);

  try {
    if (state.serializePosts) {
      await loadSerializedPosts(requestId);
    } else {
      const posts = await window.kemono.getCreatorPosts(
        state.selectedArtist.service,
        state.selectedArtist.id,
        {
          offset: state.postsOffset,
          query: state.postsQuery,
        }
      );
      if (requestId !== state.postsRequestId) {
        return;
      }
      setPostsList(posts);
      renderPosts();
      setStatus("Posts loaded.", "info");
    }
  } catch (error) {
    setStatus(`Failed to load posts: ${error.message}`, "error");
  }
}

async function loadSerializedPosts(requestId) {
  const artistKey = getArtistKey(state.selectedArtist);
  const query = state.postsQuery || "";
  const cacheKey = `${artistKey}|${query}`;
  if (state.postsAllKey === cacheKey && state.postsAll.length > 0) {
    setPostsList(state.postsAll);
    renderPosts();
    setStatus("Posts loaded.", "info");
    return;
  }

  state.postsAllKey = cacheKey;
  state.postsAll = [];
  let offset = 0;
  const totalCount = !query ? state.artistProfile?.post_count || null : null;

  while (true) {
    if (requestId !== state.postsRequestId) {
      return;
    }
    const batch = await window.kemono.getCreatorPosts(
      state.selectedArtist.service,
      state.selectedArtist.id,
      {
        offset,
        query,
      }
    );
    if (requestId !== state.postsRequestId) {
      return;
    }
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }
    state.postsAll.push(...batch);
    offset += batch.length;
    setStatus(`Loaded ${formatNumber(state.postsAll.length)} posts...`, "info");
    if (batch.length < PAGE_SIZE) {
      break;
    }
    if (totalCount !== null && offset >= totalCount) {
      break;
    }
  }

  setPostsList(state.postsAll);
  renderPosts();
  setStatus(`Loaded ${formatNumber(state.postsAll.length)} posts.`, "info");
}

function renderPosts() {
  setPostsEnabled(true);
  const isSerialized = state.serializePosts;
  const totalCount = state.artistProfile?.post_count || null;
  const currentPage = Math.floor(state.postsOffset / PAGE_SIZE) + 1;
  let listItems = isSerialized
    ? buildSerializedPosts(state.posts)
    : state.posts.map((post) => ({
        type: "post",
        key: buildPostKey(post),
        post,
      }));

  if (state.postsMinMedia > 0) {
    listItems = listItems.filter(
      (item) => getPostItemMediaCount(item) > state.postsMinMedia
    );
  }

  let pageItems = listItems;
  if (isSerialized) {
    const totalItems = listItems.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    const maxOffset = Math.max(0, totalItems - PAGE_SIZE);
    const canPrev = state.postsOffset > 0;
    const canNext = state.postsOffset < maxOffset;
    elements.postsPrev.disabled = !canPrev;
    elements.postsNext.disabled = !canNext;
    elements.postsPageInfo.textContent = `Page ${currentPage} of ${totalPages} - ${formatNumber(
      totalItems
    )} entries`;
    pageItems = listItems.slice(
      state.postsOffset,
      state.postsOffset + PAGE_SIZE
    );
  } else {
    const canPrev = state.postsOffset > 0;
    let canNext = state.posts.length === PAGE_SIZE;
    if (!state.postsQuery && totalCount !== null) {
      const maxOffset = Math.max(0, totalCount - PAGE_SIZE);
      canNext = state.postsOffset < maxOffset;
      const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
      elements.postsPageInfo.textContent = `Page ${currentPage} of ${totalPages} - ${formatNumber(
        totalCount
      )} posts`;
    } else {
      elements.postsPageInfo.textContent = `Page ${currentPage}`;
    }
    elements.postsPrev.disabled = !canPrev;
    elements.postsNext.disabled = !canNext;
  }

  elements.postsList.innerHTML = "";
  state.postListItems = new Map(
    pageItems.map((item) => [item.key, item])
  );

  if (pageItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "card post-placeholder";
    empty.textContent = "No posts found.";
    elements.postsList.appendChild(empty);
    return;
  }

  pageItems.forEach((item) => {
    const post =
      item.type === "group" ? item.posts[0] : item.post;
    if (!post) {
      return;
    }
    const card = document.createElement("div");
    card.className = "card post-card";
    card.dataset.itemKey = item.key;
    card.dataset.itemType = item.type;

    const thumb = document.createElement("div");
    thumb.className = "post-card__thumb";
    const thumbData = pickPostThumb(post);
    const hasGif =
      item.type === "group"
        ? item.posts.some((groupPost) => postHasGif(groupPost))
        : postHasGif(post);
    if (thumbData && thumbData.type === "image") {
      const img = document.createElement("img");
      img.alt = post.title || "Post image";
      img.decoding = "async";
      img.fetchPriority = "low";
      thumb.appendChild(img);
      if (thumbData.isGif) {
        setStaticGifPreview(img, thumbData.path);
      } else {
        img.src = buildThumbUrl(thumbData.path);
        img.onerror = () => {
          img.onerror = null;
          img.src = buildMediaUrl(thumbData.path);
        };
      }
    } else {
      thumb.textContent = thumbData?.type === "video" ? "video" : "file";
    }

    if (hasGif) {
      const badge = document.createElement("span");
      badge.className = "post-card__badge";
      badge.textContent = "GIF";
      thumb.appendChild(badge);
    }

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.dataset.action = "add";
    addButton.textContent = "+";
    addButton.className = "post-card__add";
    thumb.appendChild(addButton);

    const footer = document.createElement("div");
    footer.className = "post-card__footer";
    const title = document.createElement("span");
    title.className = "post-card__title";
    title.textContent =
      item.type === "group"
        ? item.title || post.title || "Untitled"
        : post.title || "Untitled";
    const count = document.createElement("span");
    count.className = "post-card__count";
    count.textContent = String(getPostItemMediaCount(item));
    footer.appendChild(title);
    footer.appendChild(count);

    card.appendChild(thumb);
    card.appendChild(footer);
    elements.postsList.appendChild(card);
  });
}

function pickPostThumb(post) {
  const candidates = [];
  if (post.file && post.file.path) {
    candidates.push(post.file);
  }
  if (Array.isArray(post.attachments)) {
    candidates.push(...post.attachments);
  }
  let gifCandidate = null;
  for (const item of candidates) {
    if (!item || !item.path) {
      continue;
    }
    const type = getMediaType(item.path);
    if (type === "image") {
      const isGif = isGifPath(item.path);
      if (!isGif) {
        return { type, path: item.path, isGif };
      }
      if (!gifCandidate) {
        gifCandidate = { type, path: item.path, isGif };
      }
    }
  }
  if (gifCandidate) {
    return gifCandidate;
  }
  if (candidates.length > 0 && candidates[0].path) {
    const type = getMediaType(candidates[0].path);
    return { type, path: candidates[0].path, isGif: isGifPath(candidates[0].path) };
  }
  return null;
}

function postHasGif(post) {
  if (post.file && post.file.path && isGifPath(post.file.path)) {
    return true;
  }
  if (Array.isArray(post.attachments)) {
    return post.attachments.some((item) => item && item.path && isGifPath(item.path));
  }
  return false;
}

function getPostMediaCount(post) {
  const items = [];
  if (post.file && post.file.path) {
    items.push(post.file.path);
  }
  if (Array.isArray(post.attachments)) {
    post.attachments.forEach((item) => {
      if (item && item.path) {
        items.push(item.path);
      }
    });
  }
  return new Set(items).size;
}

async function getPostDetails(service, user, postId) {
  const key = `${service}:${user}:${postId}`;
  if (state.postCache.has(key)) {
    return state.postCache.get(key);
  }
  const post = await window.kemono.getPost(service, user, postId);
  state.postCache.set(key, post);
  return post;
}

function buildMediaEntries(post) {
  const entries = [];
  if (post.file && post.file.path) {
    entries.push(post.file);
  }
  if (Array.isArray(post.attachments)) {
    post.attachments.forEach((item) => {
      if (item && item.path) {
        entries.push(item);
      }
    });
  }
  const seen = new Set();
  return entries.filter((item) => {
    if (!item || !item.path) {
      return false;
    }
    if (seen.has(item.path)) {
      return false;
    }
    seen.add(item.path);
    return true;
  });
}

function buildMediaCollection(post) {
  const entries = buildMediaEntries(post);
  const media = [];
  const files = [];
  entries.forEach((item) => {
    const path = item.path;
    const url = buildMediaUrl(path);
    const type = getMediaType(path);
    const payload = {
      name: item.name || path.split("/").pop(),
      url,
      type,
      path,
      isGif: isGifPath(path),
    };
    if (type === "image" || type === "video") {
      media.push(payload);
    } else {
      files.push(payload);
    }
  });
  return { media, files };
}

function registerGalleryImage(img, src, options = {}) {
  img.dataset.src = src;
  img.dataset.loadState = "queued";
  if (options.memKey) {
    img.dataset.memKey = options.memKey;
  }
  if (options.filename) {
    img.dataset.filename = options.filename;
  }
  img.addEventListener("load", () => {
    img.dataset.loadState = "loaded";
  });
  img.addEventListener("error", () => {
    img.dataset.loadState = "error";
  });
}

function resetGalleryLoadQueue() {
  galleryLoadState.token += 1;
  galleryLoadState.active = 0;
  galleryLoadState.queue = [];
}

function enqueueGalleryImage(img) {
  if (!img || !img.dataset.src) {
    return;
  }
  if (img.dataset.loadQueued === "true") {
    return;
  }
  img.dataset.loadQueued = "true";
  img.dataset.loadToken = String(galleryLoadState.token);
  galleryLoadState.queue.push(img);
  pumpGalleryQueue();
}

function pumpGalleryQueue() {
  while (
    galleryLoadState.active < MAX_GALLERY_WORKERS &&
    galleryLoadState.queue.length > 0
  ) {
    const img = galleryLoadState.queue.shift();
    if (!img) {
      continue;
    }
    if (img.dataset.loadToken !== String(galleryLoadState.token)) {
      continue;
    }
    if (img.dataset.loadState === "loaded") {
      continue;
    }
    const src = img.dataset.src;
    if (!src) {
      continue;
    }
    galleryLoadState.active += 1;
    img.dataset.loadQueued = "false";
    img.dataset.loadState = "loading";
    const token = galleryLoadState.token;
    const onDone = () => {
      if (token === galleryLoadState.token) {
        galleryLoadState.active = Math.max(0, galleryLoadState.active - 1);
        pumpGalleryQueue();
      }
    };
    img.addEventListener("load", onDone, { once: true });
    img.addEventListener("error", onDone, { once: true });
    img.src = src;
  }
}

function attachDownloadProgress(host, requestId) {
  if (!host) {
    return null;
  }
  const existing = host.querySelector(".download-progress");
  if (existing) {
    existing.remove();
  }
  const wrap = document.createElement("div");
  wrap.className = "download-progress";
  wrap.dataset.requestId = requestId;
  const bar = document.createElement("div");
  bar.className = "download-progress__bar";
  const fill = document.createElement("div");
  fill.className = "download-progress__fill";
  bar.appendChild(fill);
  const meta = document.createElement("div");
  meta.className = "download-progress__meta";
  meta.textContent = "Starting download...";
  wrap.appendChild(bar);
  wrap.appendChild(meta);
  host.appendChild(wrap);
  const entry = { wrap, bar, fill, meta };
  downloadProgress.set(requestId, entry);
  return entry;
}

function updateDownloadProgress(data) {
  if (!data || !data.requestId) {
    return;
  }
  const entry = downloadProgress.get(data.requestId);
  if (!entry) {
    return;
  }
  if (!entry.wrap.isConnected) {
    downloadProgress.delete(data.requestId);
    return;
  }
  if (data.error) {
    entry.bar.classList.remove("is-indeterminate");
    entry.fill.style.width = "0%";
    entry.meta.textContent = `Failed: ${data.error}`;
    return;
  }
  const total = Number(data.total) || 0;
  const loaded = Number(data.loaded) || 0;
  const speed = Number(data.speed) || 0;
  const speedText = `${formatMb(speed)} MB/s`;
  if (total > 0) {
    const percent = Math.min(100, (loaded / total) * 100);
    entry.bar.classList.remove("is-indeterminate");
    entry.fill.style.width = `${percent}%`;
    const remaining = Math.max(0, total - loaded);
    entry.meta.textContent = `${formatMb(loaded)}/${formatMb(
      total
    )} MB · ${speedText} · ${formatMb(remaining)} MB left`;
  } else {
    entry.bar.classList.add("is-indeterminate");
    entry.fill.style.width = "40%";
    entry.meta.textContent = `${formatMb(loaded)} MB · ${speedText}`;
  }
  if (data.done) {
    entry.bar.classList.remove("is-indeterminate");
    entry.fill.style.width = "100%";
    entry.meta.textContent = data.doneLabel || "Extracting...";
  }
}

function clearMemoryMedia() {
  memoryMedia.forEach((_entry, url) => {
    URL.revokeObjectURL(url);
    downloadedImages.delete(url);
  });
  memoryMedia.clear();
}

function releaseEntryMemory(entry) {
  if (!entry || !Array.isArray(entry.media)) {
    return;
  }
  entry.media.forEach((item) => {
    const key = item.memoryKey;
    if (!key || !memoryMedia.has(key)) {
      return;
    }
    URL.revokeObjectURL(key);
    memoryMedia.delete(key);
    downloadedImages.delete(key);
  });
}

function refreshFailedGalleryImages() {
  const images = elements.gallery.querySelectorAll("img[data-src]");
  images.forEach((img) => {
    const state = img.dataset.loadState;
    if (state === "loaded") {
      return;
    }
    const src = img.dataset.src;
    if (!src) {
      return;
    }
    img.dataset.loadState = "queued";
    img.dataset.loadQueued = "false";
    enqueueGalleryImage(img);
  });
}

async function ensureOutputFolder() {
  if (state.outputFolder) {
    return state.outputFolder;
  }
  const folder = await window.kemono.selectOutputFolder();
  if (folder) {
    state.outputFolder = folder;
    setStatus("Output folder set.", "info");
    return folder;
  }
  setStatus("Output folder not set.", "error");
  return "";
}

function updateGalleryTimelineVisibility() {
  if (
    !elements.galleryShell ||
    !elements.gallerySideTimeline ||
    !elements.toggleGalleryTimeline
  ) {
    return;
  }
  if (state.galleryTimelineVisible) {
    elements.galleryShell.classList.add("has-side");
    elements.gallerySideTimeline.hidden = false;
    elements.toggleGalleryTimeline.textContent = "Hide timeline";
  } else {
    elements.galleryShell.classList.remove("has-side");
    elements.gallerySideTimeline.hidden = true;
    elements.gallerySideTimeline.innerHTML = "";
    elements.toggleGalleryTimeline.textContent = "Timeline";
  }
}

function renderGallerySideTimeline(items) {
  if (!elements.gallerySideTimeline || !state.galleryTimelineVisible) {
    return;
  }
  elements.gallerySideTimeline.innerHTML = "";
  if (elements.gallerySideTimeline) {
    elements.gallerySideTimeline.dataset.sync = "1";
  }
  if (items.length === 0) {
    return;
  }
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-side__item";
    button.dataset.targetId = item.id;
    if (item.type === "image") {
      const img = document.createElement("img");
      img.alt = item.alt || "Preview";
      img.decoding = "async";
      img.fetchPriority = "low";
      const fullUrl = item.fullUrl || buildMediaUrl(item.path);
      const thumbUrl = item.thumbUrl || buildThumbUrl(item.path);
      img.src = thumbUrl;
      if (downloadedImages.has(fullUrl)) {
        img.classList.add("is-downloaded");
      }
      img.onerror = () => {
        img.onerror = null;
        img.src = buildMediaUrl(item.path) || thumbUrl;
      };
      button.appendChild(img);
    } else {
      const label = document.createElement("div");
      label.className = "gallery-side__label";
      if (item.type === "video") {
        label.textContent = "VID";
      } else if (item.type === "file") {
        label.textContent = (item.fileType || "file").toUpperCase();
      } else {
        label.textContent = "FILE";
      }
      button.appendChild(label);
    }
    button.addEventListener("click", () => {
      const target = document.getElementById(item.id);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    elements.gallerySideTimeline.appendChild(button);
  });
}

function updateSideTimelineActive(targetId) {
  if (!elements.gallerySideTimeline) {
    return;
  }
  const buttons = elements.gallerySideTimeline.querySelectorAll(
    ".gallery-side__item"
  );
  let active = null;
  buttons.forEach((button) => {
    const isMatch = button.dataset.targetId === targetId;
    button.classList.toggle("is-active", isMatch);
    if (isMatch) {
      active = button;
    }
  });
  if (!active) {
    return;
  }
  const container = elements.gallerySideTimeline;
  const containerRect = container.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  if (
    activeRect.top < containerRect.top ||
    activeRect.bottom > containerRect.bottom
  ) {
    active.scrollIntoView({ block: "nearest" });
  }
}

function syncSideTimelineToScroll() {
  if (!elements.gallerySideTimeline || !state.galleryTimelineVisible) {
    return;
  }
  const galleryRect = elements.gallery.getBoundingClientRect();
  const targets = elements.gallery.querySelectorAll(
    ".gallery-media-item, .gallery-file"
  );
  let best = null;
  let bestDelta = Infinity;
  targets.forEach((node) => {
    const rect = node.getBoundingClientRect();
    const delta = Math.abs(rect.top - galleryRect.top);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = node;
    }
  });
  if (!best || !best.id) {
    return;
  }
  updateSideTimelineActive(best.id);
}

let sideTimelineRaf = 0;
function scheduleSideTimelineSync() {
  if (sideTimelineRaf) {
    return;
  }
  sideTimelineRaf = requestAnimationFrame(() => {
    sideTimelineRaf = 0;
    syncSideTimelineToScroll();
  });
}

async function previewZipInGallery(url, label, host, button) {
  const requestId = `zip-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const progress = attachDownloadProgress(host, requestId);
  if (button) {
    button.disabled = true;
  }
  setStatus("Loading zip...", "info");
  try {
    const images = await window.kemono.extractZipImages(url, requestId);
    if (!images || images.length === 0) {
      setStatus("No images found in zip.", "info");
      return;
    }
    const media = images.map((item) => {
      const blob = new Blob([item.bytes], { type: item.mime });
      const objectUrl = URL.createObjectURL(blob);
      memoryMedia.set(objectUrl, { blob, name: item.name });
      return {
        name: item.name,
        url: objectUrl,
        type: "image",
        path: "",
        isGif: item.mime === "image/gif",
        thumbUrl: objectUrl,
        memoryKey: objectUrl,
      };
    });
    const key = `zip:${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const entry = {
      key,
      id: key,
      service: "zip",
      user: "zip",
      title: label,
      published: null,
      media,
      files: [],
    };
    state.galleryPosts = [...state.galleryPosts, entry];
    renderGallery();
    renderTimeline();
    setStatus(`Added ${media.length} images from zip.`, "info");
  } catch (error) {
    setStatus(`Zip preview failed: ${error.message}`, "error");
  } finally {
    if (progress) {
      progress.wrap.remove();
      downloadProgress.delete(requestId);
    }
    if (button) {
      button.disabled = false;
    }
  }
}

async function previewPdfInGallery(url, label, host, button) {
  const requestId = `pdf-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const progress = attachDownloadProgress(host, requestId);
  if (button) {
    button.disabled = true;
  }
  setStatus("Loading PDF...", "info");
  try {
    if (!window.pdfjsLib) {
      throw new Error("PDF renderer is not available.");
    }
    const bytes = window.kemono.fetchFileBytes
      ? await window.kemono.fetchFileBytes(url, requestId)
      : await window.kemono.getMediaBytes(url);
    if (progress) {
      progress.bar.classList.remove("is-indeterminate");
      progress.fill.style.width = "100%";
      progress.meta.textContent = "Rendering pages...";
    }
    const pdfData = normalizeBytes(bytes);
    const loadingTask = window.pdfjsLib.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;
    const pageCount = pdf.numPages || 0;
    const pages = [];
    const rawName = label || "document.pdf";
    const baseName =
      sanitizeFilename(rawName.replace(/\.pdf$/i, "")) || "document";

    for (let i = 1; i <= pageCount; i += 1) {
      if (progress) {
        progress.meta.textContent = `Rendering ${i}/${pageCount}...`;
      }
      const page = await pdf.getPage(i);
      const baseViewport = page.getViewport({ scale: 1 });
      const fullDpi = 300;
      const scale = Math.max(1, fullDpi / 72);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) {
        if (page.cleanup) {
          page.cleanup();
        }
        continue;
      }
      await page.render({ canvasContext: context, viewport }).promise;
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (page.cleanup) {
        page.cleanup();
      }
      if (!blob) {
        continue;
      }
      const pageName = `${baseName}-p${String(i).padStart(3, "0")}.png`;
      const objectUrl = URL.createObjectURL(blob);
      memoryMedia.set(objectUrl, { blob, name: pageName });
      pages.push({
        name: pageName,
        url: objectUrl,
        type: "image",
        path: "",
        isGif: false,
        thumbUrl: objectUrl,
        memoryKey: objectUrl,
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    if (typeof pdf.cleanup === "function") {
      pdf.cleanup();
    }
    if (pages.length === 0) {
      setStatus("No pages rendered from PDF.", "info");
      return;
    }
    const key = `pdf:${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const entry = {
      key,
      id: key,
      service: "pdf",
      user: "pdf",
      title: label || "PDF preview",
      published: null,
      media: pages,
      files: [],
    };
    state.galleryPosts = [...state.galleryPosts, entry];
    renderGallery();
    renderTimeline();
    setStatus(`Added ${pages.length} pages from PDF.`, "info");
  } catch (error) {
    setStatus(`PDF preview failed: ${error.message}`, "error");
  } finally {
    if (progress) {
      progress.wrap.remove();
      downloadProgress.delete(requestId);
    }
    if (button) {
      button.disabled = false;
    }
  }
}

function setupSplitter(splitter, onMove) {
  if (!splitter) {
    return;
  }
  const workspace = splitter.closest(".workspace");
  if (!workspace) {
    return;
  }

  let dragging = false;

  const handleMove = (event) => {
    if (!dragging) {
      return;
    }
    onMove(event, workspace, splitter);
  };

  const stopDrag = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    splitter.classList.remove("is-dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleMove);
    window.removeEventListener("mouseup", stopDrag);
  };

  splitter.addEventListener("mousedown", (event) => {
    dragging = true;
    splitter.classList.add("is-dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", stopDrag);
    event.preventDefault();
  });

  window.addEventListener("blur", stopDrag);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopDrag();
    }
  });
}

function setupSplitters() {
  setupSplitter(elements.splitterArtistsGallery, (event, workspace, splitter) => {
    const rect = workspace.getBoundingClientRect();
    const style = getComputedStyle(workspace);
    const columnGap = parseFloat(style.columnGap) || 0;
    const totalGap = columnGap * 4;
    const available = rect.width - totalGap;
    const splitterWidth = splitter.getBoundingClientRect().width;
    const otherSplitterWidth = elements.splitterGalleryPosts
      ? elements.splitterGalleryPosts.getBoundingClientRect().width
      : 0;
    const minArtists = 220;
    const minGallery = 320;
    const minPosts = 240;
    const maxArtists =
      available - splitterWidth - otherSplitterWidth - minGallery - minPosts;
    const artistsRect = splitter.previousElementSibling?.getBoundingClientRect();
    const raw = event.clientX - (artistsRect?.left || rect.left);
    const next = Math.max(minArtists, Math.min(maxArtists, raw));
    workspace.style.setProperty("--artists-width", `${next}px`);
  });

  setupSplitter(elements.splitterGalleryPosts, (event, workspace, splitter) => {
    const rect = workspace.getBoundingClientRect();
    const style = getComputedStyle(workspace);
    const columnGap = parseFloat(style.columnGap) || 0;
    const totalGap = columnGap * 4;
    const available = rect.width - totalGap;
    const splitterWidth = splitter.getBoundingClientRect().width;
    const otherSplitterWidth = elements.splitterArtistsGallery
      ? elements.splitterArtistsGallery.getBoundingClientRect().width
      : 0;
    const minGallery = 320;
    const minPosts = 240;
    const artistsPanel = elements.splitterArtistsGallery?.previousElementSibling;
    const artistsWidth = artistsPanel?.getBoundingClientRect().width || 0;
    const galleryRect = splitter.previousElementSibling?.getBoundingClientRect();
    const maxGallery =
      available - otherSplitterWidth - splitterWidth - artistsWidth - minPosts;
    const raw = event.clientX - (galleryRect?.left || rect.left);
    const next = Math.max(minGallery, Math.min(maxGallery, raw));
    workspace.style.setProperty("--gallery-width", `${next}px`);
  });
}

function getPostTimestamp(post) {
  if (!post) {
    return 0;
  }
  const raw =
    post.published ?? post.added ?? post.updated ?? post.created ?? 0;
  if (!raw) {
    return 0;
  }
  if (typeof raw === "number") {
    return raw < 1e12 ? raw * 1000 : raw;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function mergeMediaCollections(posts) {
  const media = [];
  const files = [];
  const mediaSeen = new Set();
  const fileSeen = new Set();
  posts.forEach((post) => {
    const collection = buildMediaCollection(post);
    collection.media.forEach((item) => {
      const key = item.path || item.url;
      if (key && mediaSeen.has(key)) {
        return;
      }
      if (key) {
        mediaSeen.add(key);
      }
      media.push(item);
    });
    collection.files.forEach((item) => {
      const key = item.path || item.url || item.name;
      if (key && fileSeen.has(key)) {
        return;
      }
      if (key) {
        fileSeen.add(key);
      }
      files.push(item);
    });
  });
  return { media, files };
}

function getPostItemMediaCount(item) {
  if (!item) {
    return 0;
  }
  if (item.type === "group" && Array.isArray(item.posts)) {
    return item.posts.reduce(
      (sum, post) => sum + getPostMediaCount(post),
      0
    );
  }
  if (item.post) {
    return getPostMediaCount(item.post);
  }
  if (item.type === "post") {
    return getPostMediaCount(item);
  }
  return 0;
}

async function addPostToGallery(postSummary, { append }) {
  if (!postSummary) {
    return;
  }
  const fullPost = await getPostDetails(
    postSummary.service,
    postSummary.user,
    postSummary.id
  );
  const key = `${fullPost.service}:${fullPost.user}:${fullPost.id}`;
  const existingIndex = state.galleryPosts.findIndex(
    (item) => item.key === key
  );

  if (existingIndex !== -1 && append) {
    return;
  }

  const { media, files } = buildMediaCollection(fullPost);
  const entry = {
    key,
    id: fullPost.id,
    service: fullPost.service,
    user: fullPost.user,
    title: fullPost.title || "Untitled",
    published: fullPost.published,
    media,
    files,
  };

  if (append) {
    state.galleryPosts = [...state.galleryPosts, entry];
  } else {
    clearMemoryMedia();
    state.galleryPosts = [entry];
  }

  renderGallery();
  renderTimeline();
}

async function addPostGroupToGallery(group, { append }) {
  if (!group || !Array.isArray(group.posts) || group.posts.length === 0) {
    return;
  }
  const groupKey = `series:${group.key}`;
  const existingIndex = state.galleryPosts.findIndex(
    (item) => item.key === groupKey
  );
  if (existingIndex !== -1 && append) {
    return;
  }

  setStatus("Loading series...", "info");
  const sorted = [...group.posts].sort(
    (a, b) => getPostTimestamp(a) - getPostTimestamp(b)
  );
  const fullPosts = [];
  for (const post of sorted) {
    const full = await getPostDetails(post.service, post.user, post.id);
    if (full) {
      fullPosts.push(full);
    }
  }
  const { media, files } = mergeMediaCollections(fullPosts);
  const entry = {
    key: groupKey,
    id: groupKey,
    service: group.service,
    user: group.user,
    title: group.title || "Series",
    published: sorted[0]?.published || null,
    media,
    files,
  };

  if (append) {
    state.galleryPosts = [...state.galleryPosts, entry];
  } else {
    clearMemoryMedia();
    state.galleryPosts = [entry];
  }

  renderGallery();
  renderTimeline();
  setStatus("Series loaded.", "info");
}

function renderGallery() {
  elements.gallery.innerHTML = "";
  if (elements.gallerySideTimeline) {
    elements.gallerySideTimeline.innerHTML = "";
  }
  resetGalleryLoadQueue();
  if (state.galleryPosts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<h3>No posts selected</h3>";
    elements.gallery.appendChild(empty);
    return;
  }

  const timelineItems = [];

  state.galleryPosts.forEach((entry) => {
    const section = document.createElement("section");
    section.className = "gallery-post";
    section.id = `gallery-post-${entry.key}`;

    const mediaWrap = document.createElement("div");
    mediaWrap.className = "gallery-media";

    if (entry.media.length === 0) {
      const fallback = document.createElement("div");
      fallback.className = "gallery-file";
      fallback.textContent = "No image or video files found.";
      mediaWrap.appendChild(fallback);
    }

    entry.media.forEach((item) => {
      if (item.type === "image") {
    const mediaId = `gallery-media-${entry.key}-${timelineItems.length}`;
    const fullUrl = item.url;
    const mediaItem = document.createElement("div");
    mediaItem.className = "gallery-media-item";
    mediaItem.id = mediaId;
        const img = document.createElement("img");
        registerGalleryImage(img, item.url, {
          memKey: item.memoryKey || "",
          filename: item.name || "",
        });
        img.alt = item.name || entry.title;
        img.decoding = "async";
        if (downloadedImages.has(item.url)) {
          img.classList.add("is-downloaded");
        }
        mediaItem.appendChild(img);
        mediaWrap.appendChild(mediaItem);
        enqueueGalleryImage(img);
        timelineItems.push({
          id: mediaId,
          type: "image",
          path: item.path,
          alt: item.name || entry.title,
          fullUrl,
          thumbUrl: item.thumbUrl || "",
        });
      } else if (item.type === "video") {
        const mediaItem = document.createElement("div");
        mediaItem.className = "gallery-media-item";
        const video = document.createElement("video");
        video.controls = true;
        video.src = item.url;
        video.preload = "metadata";
        mediaItem.appendChild(video);
        mediaWrap.appendChild(mediaItem);
      }
    });

    if (entry.files.length > 0) {
      entry.files.forEach((item) => {
        const fileId = `gallery-file-${entry.key}-${timelineItems.length}`;
        const file = document.createElement("div");
        file.className = "gallery-file";
        file.id = fileId;
        const label = document.createElement("span");
        label.textContent = item.name || "File";
        const actions = document.createElement("div");
        actions.className = "gallery-file__actions";
        const link = document.createElement("button");
        link.className = "ghost";
        link.textContent = "Open";
        link.addEventListener("click", () => {
          window.kemono.openExternal(item.url);
        });
        actions.appendChild(link);

        const lowerName = (item.name || "").toLowerCase();
        const lowerUrl = (item.url || "").toLowerCase();
        const isZip = lowerName.endsWith(".zip") || lowerUrl.includes(".zip");
        const isPdf = lowerName.endsWith(".pdf") || lowerUrl.includes(".pdf");
        if (isPdf) {
          const preview = document.createElement("button");
          preview.className = "ghost";
          preview.textContent = "Preview";
          preview.addEventListener("click", async () => {
            await previewPdfInGallery(
              item.url,
              item.name || "Document",
              file,
              preview
            );
          });
          actions.appendChild(preview);
        }
        if (isZip) {
          const preview = document.createElement("button");
          preview.className = "ghost";
          preview.textContent = "Preview";
          preview.addEventListener("click", async () => {
            await previewZipInGallery(
              item.url,
              item.name || "Archive",
              file,
              preview
            );
          });
          actions.appendChild(preview);
        }

        file.appendChild(label);
        file.appendChild(actions);
        mediaWrap.appendChild(file);

        const fileType = isPdf ? "pdf" : isZip ? "zip" : "file";
        timelineItems.push({
          id: fileId,
          type: "file",
          fileType,
        });
      });
    }

    section.appendChild(mediaWrap);
    elements.gallery.appendChild(section);
  });

  renderGallerySideTimeline(timelineItems);
  syncSideTimelineToScroll();
}

function renderTimeline() {
  elements.timeline.innerHTML = "";
  if (state.galleryPosts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timeline__empty";
    empty.textContent = "Timeline is empty.";
    elements.timeline.appendChild(empty);
    return;
  }

  state.galleryPosts.forEach((entry, index) => {
    const item = document.createElement("div");
    item.className = "timeline-item";
    item.dataset.index = String(index);
    item.dataset.key = entry.key;

    const title = document.createElement("h4");
    title.textContent = entry.title;

    const actions = document.createElement("div");
    actions.className = "timeline-item__actions";

    const left = document.createElement("button");
    left.type = "button";
    left.textContent = "Left";
    left.dataset.action = "left";
    left.disabled = index === 0;

    const right = document.createElement("button");
    right.type = "button";
    right.textContent = "Right";
    right.dataset.action = "right";
    right.disabled = index === state.galleryPosts.length - 1;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.dataset.action = "remove";

    actions.appendChild(left);
    actions.appendChild(right);
    actions.appendChild(remove);

    item.appendChild(title);
    item.appendChild(actions);
    elements.timeline.appendChild(item);
  });
}

function scrollToGalleryPost(key) {
  const target = document.getElementById(`gallery-post-${key}`);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function handleTimelineAction(action, index) {
  if (action === "remove") {
    const [removed] = state.galleryPosts.splice(index, 1);
    releaseEntryMemory(removed);
  } else if (action === "left" && index > 0) {
    const [item] = state.galleryPosts.splice(index, 1);
    state.galleryPosts.splice(index - 1, 0, item);
  } else if (action === "right" && index < state.galleryPosts.length - 1) {
    const [item] = state.galleryPosts.splice(index, 1);
    state.galleryPosts.splice(index + 1, 0, item);
  }
  renderGallery();
  renderTimeline();
}

function setupEventListeners() {
  setupSplitters();
  elements.artistSearch.addEventListener(
    "input",
    debounce((event) => {
      state.artistQuery = event.target.value;
      applyArtistFilter();
    }, 250)
  );

  if (elements.artistTabSearch) {
    elements.artistTabSearch.addEventListener("click", () => {
      setArtistView("search");
    });
  }

  if (elements.artistTabFavorites) {
    elements.artistTabFavorites.addEventListener("click", () => {
      setArtistView("favorites");
    });
  }

  elements.serviceFilter.addEventListener("change", (event) => {
    state.serviceFilter = event.target.value;
    applyArtistFilter();
  });

  elements.artistsPrev.addEventListener("click", () => {
    state.artistsPage = Math.max(0, state.artistsPage - 1);
    renderArtists();
  });

  elements.artistsNext.addEventListener("click", () => {
    state.artistsPage += 1;
    renderArtists();
  });

  elements.artistsList.addEventListener("click", (event) => {
    const card = event.target.closest(".artist-card");
    if (!card) {
      return;
    }
    const favButton = event.target.closest("button[data-action='favorite']");
    if (favButton) {
      const key = `${card.dataset.service}:${card.dataset.id}`;
      if (state.favoriteArtists.has(key)) {
        state.favoriteArtists.delete(key);
      } else {
        state.favoriteArtists.add(key);
      }
      persistFavorites();
      applyArtistFilter();
      event.stopPropagation();
      return;
    }
    selectArtist({
      service: card.dataset.service,
      id: card.dataset.id,
      name: card.dataset.name,
    });
  });

  elements.postSearch.addEventListener(
    "input",
    debounce((event) => {
      if (!state.selectedArtist) {
        return;
      }
      state.postsQuery = event.target.value.trim();
      state.postsOffset = 0;
      loadPosts();
    }, 350)
  );

  elements.refreshPosts.addEventListener("click", () => {
    if (state.selectedArtist) {
      loadPosts();
    }
  });

  if (elements.serializePosts) {
    elements.serializePosts.addEventListener("change", (event) => {
      state.serializePosts = event.target.checked;
      state.postsOffset = 0;
      loadPosts();
    });
  }

  if (elements.minMediaFilter) {
    elements.minMediaFilter.addEventListener("input", (event) => {
      const value = Number.parseInt(event.target.value, 10);
      state.postsMinMedia = Number.isNaN(value) ? 0 : Math.max(0, value);
      state.postsOffset = 0;
      if (state.serializePosts) {
        loadPosts();
      } else {
        renderPosts();
      }
    });
  }

  elements.postsPrev.addEventListener("click", () => {
    if (!state.selectedArtist) {
      return;
    }
    state.postsOffset = Math.max(0, state.postsOffset - PAGE_SIZE);
    if (state.serializePosts) {
      renderPosts();
    } else {
      loadPosts();
    }
  });

  elements.postsNext.addEventListener("click", () => {
    if (!state.selectedArtist) {
      return;
    }
    state.postsOffset += PAGE_SIZE;
    if (state.serializePosts) {
      renderPosts();
    } else {
      loadPosts();
    }
  });

  elements.postsList.addEventListener("click", (event) => {
    const addButton = event.target.closest("button[data-action='add']");
    const card = event.target.closest(".post-card");
    if (!card) {
      return;
    }
    const itemKey = card.dataset.itemKey;
    const item = state.postListItems.get(itemKey);
    if (!item) {
      return;
    }
    const append = Boolean(addButton);
    if (item.type === "group") {
      addPostGroupToGallery(item, { append });
    } else {
      addPostToGallery(item.post, { append });
    }
  });

  elements.postsList.addEventListener("contextmenu", (event) => {
    const card = event.target.closest(".post-card");
    if (!card) {
      return;
    }
    event.preventDefault();
    const itemKey = card.dataset.itemKey;
    const item = state.postListItems.get(itemKey);
    if (!item) {
      return;
    }
    if (item.type === "group") {
      addPostGroupToGallery(item, { append: true });
    } else {
      addPostToGallery(item.post, { append: true });
    }
  });

  elements.timeline.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    const item = event.target.closest(".timeline-item");
    if (!item) {
      return;
    }
    const index = Number(item.dataset.index || 0);
    if (button) {
      handleTimelineAction(button.dataset.action, index);
      return;
    }
    scrollToGalleryPost(item.dataset.key);
  });

  elements.refreshGalleryImages.addEventListener("click", () => {
    refreshFailedGalleryImages();
  });

  elements.toggleGalleryTimeline.addEventListener("click", () => {
    state.galleryTimelineVisible = !state.galleryTimelineVisible;
    updateGalleryTimelineVisibility();
    renderGallery();
  });

  elements.setOutputFolder.addEventListener("click", async () => {
    await ensureOutputFolder();
  });

  elements.clearGallery.addEventListener("click", () => {
    clearMemoryMedia();
    state.galleryPosts = [];
    renderGallery();
    renderTimeline();
  });

  elements.gallery.addEventListener("scroll", () => {
    scheduleSideTimelineSync();
  });

  elements.gallery.addEventListener("contextmenu", async (event) => {
    const img = event.target.closest("img");
    if (!img || !img.dataset.src || img.dataset.loadState !== "loaded") {
      return;
    }
    event.preventDefault();
    const folder = await ensureOutputFolder();
    if (!folder) {
      return;
    }
    try {
      const memKey = img.dataset.memKey;
      const filename = img.dataset.filename || "image";
      let saved = "";
      if (memKey && memoryMedia.has(memKey)) {
        const entry = memoryMedia.get(memKey);
        const buffer = await entry.blob.arrayBuffer();
        saved = await window.kemono.saveBytes(buffer, entry.name || filename, folder);
      } else {
        saved = await window.kemono.downloadImage(img.dataset.src, folder);
      }
      const downloadKey = memKey || img.dataset.src;
      img.classList.add("is-downloaded");
      downloadedImages.add(downloadKey);
      if (elements.gallerySideTimeline) {
        elements.gallerySideTimeline
          .querySelectorAll("img")
          .forEach((thumb) => {
            const parent = thumb.closest(".gallery-side__item");
            if (!parent) {
              return;
            }
            const targetId = parent.dataset.targetId;
            const target = targetId ? document.getElementById(targetId) : null;
            const targetImg = target?.querySelector("img");
            if (targetImg && targetImg.dataset.src === img.dataset.src) {
              thumb.classList.add("is-downloaded");
            }
          });
      }
      setStatus(`Saved to ${saved}`, "info");
    } catch (error) {
      setStatus(`Download failed: ${error.message}`, "error");
    }
  });
}

async function init() {
  setStatus("Loading creators...", "info");
  setupEventListeners();
  if (window.kemono.onZipProgress) {
    window.kemono.onZipProgress((data) => {
      updateDownloadProgress(data);
    });
  }
  if (window.kemono.onFileProgress) {
    window.kemono.onFileProgress((data) => {
      updateDownloadProgress(data);
    });
  }
  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs";
  }
  setPostsEnabled(false);
  showPostsPlaceholder("Select an artist to load posts.");
  elements.artistTitle.textContent = "";
  elements.artistSubtitle.textContent = "";
  updateGalleryTimelineVisibility();

  try {
    if (window.kemono.getFavorites) {
      const saved = await window.kemono.getFavorites();
      state.favoriteArtists = new Set(Array.isArray(saved) ? saved : []);
    }
    state.dataBase = await window.kemono.getDataBase();
    state.thumbBase = await window.kemono.getThumbBase();
    state.outputFolder = (await window.kemono.getOutputFolder()) || "";
    state.creators = await window.kemono.getCreators();
    state.creatorsSorted = [...state.creators].sort(
      (a, b) => (b.favorited || 0) - (a.favorited || 0)
    );
    state.services = Array.from(
      new Set(state.creators.map((creator) => creator.service))
    ).sort();

    state.services.forEach((service) => {
      const option = document.createElement("option");
      option.value = service;
      option.textContent = capitalize(service);
      elements.serviceFilter.appendChild(option);
    });

    applyArtistFilter();
    setStatus("Ready.", "info");
  } catch (error) {
    setStatus(`Failed to load creators: ${error.message}`, "error");
  }
}

init();
