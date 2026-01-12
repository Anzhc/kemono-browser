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
  creators: [],
  creatorsSorted: [],
  services: [],
  artistQuery: "",
  serviceFilter: "all",
  artistsPage: 0,
  filteredArtists: [],
  selectedArtist: null,
  artistProfile: null,
  posts: [],
  postsOffset: 0,
  postsQuery: "",
  postsByKey: new Map(),
  postCache: new Map(),
  galleryPosts: [],
};

const elements = {
  statusMessage: document.getElementById("statusMessage"),
  artistSearch: document.getElementById("artistSearch"),
  serviceFilter: document.getElementById("serviceFilter"),
  artistsPrev: document.getElementById("artistsPrev"),
  artistsNext: document.getElementById("artistsNext"),
  artistsPageInfo: document.getElementById("artistsPageInfo"),
  artistsList: document.getElementById("artistsList"),
  artistTitle: document.getElementById("artistTitle"),
  artistSubtitle: document.getElementById("artistSubtitle"),
  postSearch: document.getElementById("postSearch"),
  refreshPosts: document.getElementById("refreshPosts"),
  postsPrev: document.getElementById("postsPrev"),
  postsNext: document.getElementById("postsNext"),
  postsPageInfo: document.getElementById("postsPageInfo"),
  postsList: document.getElementById("postsList"),
  splitter: document.getElementById("splitter"),
  gallery: document.getElementById("gallery"),
  timeline: document.getElementById("timeline"),
  clearGallery: document.getElementById("clearGallery"),
};

function setStatus(message, tone = "info") {
  elements.statusMessage.textContent = message;
  elements.statusMessage.dataset.tone = tone;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
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

function buildMediaUrl(path) {
  if (!path) {
    return "";
  }
  return `${state.dataBase}${path}`;
}

function applyArtistFilter() {
  const query = state.artistQuery.trim().toLowerCase();
  const service = state.serviceFilter;
  state.filteredArtists = state.creatorsSorted.filter((artist) => {
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

    const title = document.createElement("div");
    title.className = "card__title";
    title.textContent = artist.name || "Unknown";

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

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(updated);
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
    const key = `${post.service}:${post.user}:${post.id}`;
    state.postsByKey.set(key, post);
  });
}

async function loadPosts() {
  if (!state.selectedArtist) {
    setPostsEnabled(false);
    elements.postsPageInfo.textContent = "Page 1";
    showPostsPlaceholder("Select an artist to load posts.");
    return;
  }

  setStatus("Loading posts...", "info");
  elements.postsList.innerHTML = "";
  setPostsEnabled(true);

  try {
    const posts = await window.kemono.getCreatorPosts(
      state.selectedArtist.service,
      state.selectedArtist.id,
      {
        offset: state.postsOffset,
        query: state.postsQuery,
      }
    );
    setPostsList(posts);
    renderPosts();
    setStatus("Posts loaded.", "info");
  } catch (error) {
    setStatus(`Failed to load posts: ${error.message}`, "error");
  }
}

function renderPosts() {
  setPostsEnabled(true);
  const totalCount = state.artistProfile?.post_count || null;
  const currentPage = Math.floor(state.postsOffset / PAGE_SIZE) + 1;
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

  elements.postsList.innerHTML = "";
  if (state.posts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "card post-placeholder";
    empty.textContent = "No posts found.";
    elements.postsList.appendChild(empty);
    return;
  }

  state.posts.forEach((post) => {
    const card = document.createElement("div");
    card.className = "card post-card";
    card.dataset.postId = post.id;
    card.dataset.service = post.service;
    card.dataset.user = post.user;

    const thumb = document.createElement("div");
    thumb.className = "post-card__thumb";
    const thumbData = pickPostThumb(post);
    if (thumbData && thumbData.type === "image") {
      const img = document.createElement("img");
      img.src = buildMediaUrl(thumbData.path);
      img.alt = post.title || "Post image";
      img.loading = "lazy";
      thumb.appendChild(img);
    } else {
      thumb.textContent = thumbData?.type === "video" ? "video" : "file";
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
    title.textContent = post.title || "Untitled";
    const count = document.createElement("span");
    count.className = "post-card__count";
    count.textContent = String(getPostMediaCount(post));
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
  for (const item of candidates) {
    if (!item || !item.path) {
      continue;
    }
    const type = getMediaType(item.path);
    if (type === "image") {
      return { type, path: item.path };
    }
  }
  if (candidates.length > 0) {
    const type = getMediaType(candidates[0].path);
    return { type, path: candidates[0].path };
  }
  return null;
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
    };
    if (type === "image" || type === "video") {
      media.push(payload);
    } else {
      files.push(payload);
    }
  });
  return { media, files };
}

function setupSplitter() {
  if (!elements.splitter) {
    return;
  }
  const workspace = elements.splitter.closest(".workspace");
  if (!workspace) {
    return;
  }

  let dragging = false;

  const onMove = (event) => {
    if (!dragging) {
      return;
    }
    const rect = workspace.getBoundingClientRect();
    const leftWidth = workspace.children[0]?.getBoundingClientRect().width || 0;
    const splitterWidth = elements.splitter.getBoundingClientRect().width;
    const minPosts = 260;
    const minGallery = 280;
    const maxPosts = rect.width - leftWidth - splitterWidth - minGallery;
    const raw = event.clientX - rect.left - leftWidth - splitterWidth / 2;
    const next = Math.max(minPosts, Math.min(maxPosts, raw));
    workspace.style.setProperty("--posts-width", `${next}px`);
  };

  const stopDrag = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    elements.splitter.classList.remove("is-dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", stopDrag);
  };

  elements.splitter.addEventListener("mousedown", (event) => {
    dragging = true;
    elements.splitter.classList.add("is-dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stopDrag);
    event.preventDefault();
  });
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
    scrollToGalleryPost(key);
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
    state.galleryPosts = [entry];
  }

  renderGallery();
  renderTimeline();
  scrollToGalleryPost(key);
}

function renderGallery() {
  elements.gallery.innerHTML = "";
  if (state.galleryPosts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<h3>No posts selected</h3><p>Pick a post to start building a gallery.</p>";
    elements.gallery.appendChild(empty);
    return;
  }

  state.galleryPosts.forEach((entry) => {
    const section = document.createElement("section");
    section.className = "gallery-post";
    section.id = `gallery-post-${entry.key}`;

    const title = document.createElement("h3");
    title.textContent = entry.title;

    const meta = document.createElement("div");
    meta.className = "gallery-post__meta";
    meta.textContent = `${capitalize(entry.service)} - ${formatDate(
      entry.published
    )} - ${entry.media.length} media`;

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
        const img = document.createElement("img");
        img.src = item.url;
        img.alt = item.name || entry.title;
        img.loading = "lazy";
        mediaWrap.appendChild(img);
      } else if (item.type === "video") {
        const video = document.createElement("video");
        video.controls = true;
        video.src = item.url;
        video.preload = "metadata";
        mediaWrap.appendChild(video);
      }
    });

    if (entry.files.length > 0) {
      entry.files.forEach((item) => {
        const file = document.createElement("div");
        file.className = "gallery-file";
        const label = document.createElement("span");
        label.textContent = item.name || "File";
        const link = document.createElement("button");
        link.className = "ghost";
        link.textContent = "Open";
        link.addEventListener("click", () => {
          window.kemono.openExternal(item.url);
        });
        file.appendChild(label);
        file.appendChild(link);
        mediaWrap.appendChild(file);
      });
    }

    section.appendChild(title);
    section.appendChild(meta);
    section.appendChild(mediaWrap);
    elements.gallery.appendChild(section);
  });
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
    state.galleryPosts.splice(index, 1);
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
  setupSplitter();
  elements.artistSearch.addEventListener(
    "input",
    debounce((event) => {
      state.artistQuery = event.target.value;
      applyArtistFilter();
    }, 250)
  );

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

  elements.postsPrev.addEventListener("click", () => {
    if (!state.selectedArtist) {
      return;
    }
    state.postsOffset = Math.max(0, state.postsOffset - PAGE_SIZE);
    loadPosts();
  });

  elements.postsNext.addEventListener("click", () => {
    if (!state.selectedArtist) {
      return;
    }
    state.postsOffset += PAGE_SIZE;
    loadPosts();
  });

  elements.postsList.addEventListener("click", (event) => {
    const addButton = event.target.closest("button[data-action='add']");
    const card = event.target.closest(".post-card");
    if (!card) {
      return;
    }
    const key = `${card.dataset.service}:${card.dataset.user}:${card.dataset.postId}`;
    const post = state.postsByKey.get(key);
    if (addButton) {
      addPostToGallery(post, { append: true });
    } else {
      addPostToGallery(post, { append: false });
    }
  });

  elements.postsList.addEventListener("contextmenu", (event) => {
    const card = event.target.closest(".post-card");
    if (!card) {
      return;
    }
    event.preventDefault();
    const key = `${card.dataset.service}:${card.dataset.user}:${card.dataset.postId}`;
    const post = state.postsByKey.get(key);
    addPostToGallery(post, { append: true });
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

  elements.clearGallery.addEventListener("click", () => {
    state.galleryPosts = [];
    renderGallery();
    renderTimeline();
  });
}

async function init() {
  setStatus("Loading creators...", "info");
  setupEventListeners();
  setPostsEnabled(false);
  showPostsPlaceholder("Select an artist to load posts.");

  try {
    state.dataBase = await window.kemono.getDataBase();
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

    state.filteredArtists = state.creatorsSorted;
    renderArtists();
    setStatus("Ready.", "info");
  } catch (error) {
    setStatus(`Failed to load creators: ${error.message}`, "error");
  }
}

init();
