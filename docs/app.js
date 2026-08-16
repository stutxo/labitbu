const ITEM = Object.freeze({
  ID: 0,
  TXID: 1,
  IMAGE: 2,
  BODY: 3,
  ACCESSORY: 4,
  PARITY: 5,
  POOL: 6,
  COPIES: 7,
  FEE_RATE: 8,
  SAT: 9,
  MINT_ADDRESS: 10,
  BLOCK: 11,
  RARITY_SCORE: 12,
  RARITY_RANK: 13,
});

const PAGE_SIZE = 100;
const DEFAULT_TITLE = document.title;
const numberFormat = new Intl.NumberFormat("en-US");
const percentFormat = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const elements = {
  form: document.querySelector("#collection-filters"),
  search: document.querySelector("#search"),
  body: document.querySelector("#body-filter"),
  accessory: document.querySelector("#accessory-filter"),
  copies: document.querySelector("#copies-filter"),
  rarity: document.querySelector("#rarity-filter"),
  pool: document.querySelector("#pool-filter"),
  sort: document.querySelector("#sort"),
  grid: document.querySelector("#collection-grid"),
  empty: document.querySelector("#collection-empty"),
  pagination: document.querySelector("#pagination"),
  firstPage: document.querySelector("#first-page"),
  previousPage: document.querySelector("#previous-page"),
  nextPage: document.querySelector("#next-page"),
  lastPage: document.querySelector("#last-page"),
  pageStatus: document.querySelector("#page-status"),
  pageRange: document.querySelector("#page-range"),
  loadError: document.querySelector("#load-error"),
  status: document.querySelector("#collection-status"),
  dialog: document.querySelector("#item-dialog"),
  dialogClose: document.querySelector("#dialog-close"),
  dialogImage: document.querySelector("#dialog-image"),
  dialogRank: document.querySelector("#dialog-rank"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogSummary: document.querySelector("#dialog-summary"),
  dialogTraits: document.querySelector("#dialog-traits"),
  dialogProvenance: document.querySelector("#dialog-provenance"),
  dialogTransactionLink: document.querySelector("#dialog-transaction-link"),
};

const state = {
  data: null,
  filteredItems: [],
  currentPage: 1,
  itemsById: new Map(),
  bodyCounts: new Map(),
  accessoryCounts: new Map(),
  keepHashOnClose: false,
  searchTimer: null,
};

function formatLabel(value) {
  const labels = {
    none: "None",
    pinkGlasses: "Pink glasses",
    sleepMask: "Sleep mask",
    horny: "Horny",
  };

  if (labels[value]) {
    return labels[value];
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatCount(value) {
  return numberFormat.format(value);
}

function formatPercent(count) {
  return `${percentFormat.format((count / state.data.stats.total) * 100)}%`;
}

function imageUrl(item) {
  return new URL(`images/${state.data.images[item[ITEM.IMAGE]]}`, import.meta.url).href;
}

function appendOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function populateFilters() {
  for (const body of state.data.labels.bodies) {
    appendOption(elements.body, body, formatLabel(body));
  }

  for (const accessory of state.data.labels.accessories) {
    appendOption(elements.accessory, accessory, formatLabel(accessory));
  }

  for (const pool of state.data.labels.pools) {
    appendOption(elements.pool, pool, pool);
  }
}

function cacheTraitCounts() {
  const { stats } = state.data;

  state.bodyCounts = new Map(stats.bodies.map((row) => [row.value, row.count]));
  state.accessoryCounts = new Map(
    stats.accessories.map((row) => [row.value, row.count]),
  );
}

function createCard(item) {
  const id = item[ITEM.ID];
  const body = state.data.labels.bodies[item[ITEM.BODY]];
  const accessory = state.data.labels.accessories[item[ITEM.ACCESSORY]];
  const copies = item[ITEM.COPIES];

  const entry = document.createElement("div");
  entry.className = "item-entry";
  entry.setAttribute("role", "listitem");

  const button = document.createElement("button");
  button.className = "item-card";
  button.type = "button";
  button.dataset.itemId = String(id);
  button.setAttribute(
    "aria-label",
    `Open Labitbu ${id}, ${formatLabel(body)}, ${formatLabel(accessory)}, rarity rank ${item[ITEM.RARITY_RANK]}`,
  );

  const artwork = document.createElement("span");
  artwork.className = "item-artwork";

  const image = document.createElement("img");
  image.src = imageUrl(item);
  image.alt = "";
  image.width = 45;
  image.height = 59;
  image.loading = "lazy";
  image.decoding = "async";
  artwork.append(image);

  const primary = document.createElement("span");
  primary.className = "item-card-primary";

  const itemNumber = document.createElement("span");
  itemNumber.textContent = `#${id}`;

  const rank = document.createElement("span");
  rank.className = "item-card-rank";
  rank.textContent = `R${formatCount(item[ITEM.RARITY_RANK])}`;
  primary.append(itemNumber, rank);

  const secondary = document.createElement("span");
  secondary.className = "item-card-secondary";

  const bodyLabel = document.createElement("span");
  bodyLabel.textContent = formatLabel(body);

  const copyLabel = document.createElement("span");
  copyLabel.textContent = copies === 1 ? "1/1" : `1/${copies}`;
  secondary.append(bodyLabel, copyLabel);

  button.append(artwork, primary, secondary);
  entry.append(button);
  return entry;
}

function renderPage({ scroll = false } = {}) {
  const total = state.filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  state.currentPage = Math.min(Math.max(state.currentPage, 1), totalPages);

  const start = (state.currentPage - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, total);
  const fragment = document.createDocumentFragment();

  for (let index = start; index < end; index += 1) {
    fragment.append(createCard(state.filteredItems[index]));
  }

  elements.grid.replaceChildren(fragment);
  elements.status.textContent = `${formatCount(total)} result${total === 1 ? "" : "s"}`;
  elements.pagination.hidden = total === 0;
  elements.pageStatus.textContent = `Page ${formatCount(state.currentPage)} of ${formatCount(totalPages)}`;
  elements.pageRange.textContent = total
    ? `${formatCount(start + 1)}-${formatCount(end)} of ${formatCount(total)}`
    : "0 results";
  elements.firstPage.disabled = state.currentPage === 1;
  elements.previousPage.disabled = state.currentPage === 1;
  elements.nextPage.disabled = state.currentPage === totalPages;
  elements.lastPage.disabled = state.currentPage === totalPages;

  if (scroll) {
    document.querySelector("#collection").scrollIntoView();
  }
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(state.filteredItems.length / PAGE_SIZE));
  const nextPage = Math.min(Math.max(page, 1), totalPages);
  if (nextPage === state.currentPage) {
    return;
  }

  state.currentPage = nextPage;
  renderPage({ scroll: true });
}

function matchesSearch(item, query) {
  if (!query) {
    return true;
  }

  const normalized = query.replace(/^#/, "").toLowerCase();
  return (
    String(item[ITEM.ID]).includes(normalized) ||
    item[ITEM.TXID].includes(normalized) ||
    item[ITEM.SAT].includes(normalized) ||
    item[ITEM.MINT_ADDRESS].includes(normalized)
  );
}

function sortItems(items, sort) {
  const byId = (left, right) => left[ITEM.ID] - right[ITEM.ID];
  const comparators = {
    "id-asc": byId,
    "id-desc": (left, right) => right[ITEM.ID] - left[ITEM.ID],
    rarity: (left, right) =>
      left[ITEM.RARITY_RANK] - right[ITEM.RARITY_RANK] || byId(left, right),
    copies: (left, right) =>
      left[ITEM.COPIES] - right[ITEM.COPIES] ||
      left[ITEM.RARITY_RANK] - right[ITEM.RARITY_RANK] ||
      byId(left, right),
    block: (left, right) => left[ITEM.BLOCK] - right[ITEM.BLOCK] || byId(left, right),
  };

  return items.sort(comparators[sort] ?? byId);
}

function applyFilters() {
  if (!state.data) {
    return;
  }

  const query = elements.search.value.trim();
  const body = elements.body.value;
  const accessory = elements.accessory.value;
  const pool = elements.pool.value;
  const maximumCopies = elements.copies.value === "all"
    ? Number.POSITIVE_INFINITY
    : Number(elements.copies.value);
  const maximumRank = elements.rarity.value === "all"
    ? Number.POSITIVE_INFINITY
    : Number(elements.rarity.value);

  const filtered = state.data.items.filter((item) => {
    const itemBody = state.data.labels.bodies[item[ITEM.BODY]];
    const itemAccessory = state.data.labels.accessories[item[ITEM.ACCESSORY]];
    const itemPool = state.data.labels.pools[item[ITEM.POOL]];

    return (
      matchesSearch(item, query) &&
      (body === "all" || itemBody === body) &&
      (accessory === "all" || itemAccessory === accessory) &&
      (pool === "all" || itemPool === pool) &&
      item[ITEM.COPIES] <= maximumCopies &&
      item[ITEM.RARITY_RANK] <= maximumRank
    );
  });

  state.filteredItems = sortItems(filtered, elements.sort.value);
  state.currentPage = 1;
  elements.empty.hidden = state.filteredItems.length !== 0;
  elements.grid.hidden = state.filteredItems.length === 0;
  renderPage();
}

function addDetailRow(list, label, value, href = null) {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;

  if (href) {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = value;
    link.title = value;
    description.append(link);
  } else {
    description.textContent = value;
    description.title = value;
  }

  row.append(term, description);
  list.append(row);
}

function showItem(item) {
  const id = item[ITEM.ID];
  const body = state.data.labels.bodies[item[ITEM.BODY]];
  const accessory = state.data.labels.accessories[item[ITEM.ACCESSORY]];
  const pool = state.data.labels.pools[item[ITEM.POOL]];
  const copies = item[ITEM.COPIES];
  const bodyCount = state.bodyCounts.get(body);
  const accessoryCount = state.accessoryCounts.get(accessory);

  elements.dialogImage.src = imageUrl(item);
  elements.dialogImage.alt = `Labitbu #${id}`;
  elements.dialogRank.textContent =
    `Visual rarity rank ${formatCount(item[ITEM.RARITY_RANK])} / ${formatCount(state.data.stats.total)}`;
  elements.dialogTitle.textContent = `Labitbu #${id}`;
  elements.dialogSummary.textContent =
    `${copies === 1 ? "One-of-one artwork" : `One of ${copies} identical artworks`} / Score ${item[ITEM.RARITY_SCORE].toFixed(2)}`;

  elements.dialogTraits.replaceChildren();
  addDetailRow(
    elements.dialogTraits,
    "Body",
    `${formatLabel(body)} / ${formatCount(bodyCount)} (${formatPercent(bodyCount)})`,
  );
  addDetailRow(
    elements.dialogTraits,
    "Accessory",
    `${formatLabel(accessory)} / ${formatCount(accessoryCount)} (${formatPercent(accessoryCount)})`,
  );
  addDetailRow(
    elements.dialogTraits,
    "Exact artwork",
    copies === 1 ? "1 of 1" : `${formatCount(copies)} copies`,
  );
  addDetailRow(
    elements.dialogTraits,
    "Rarity score",
    item[ITEM.RARITY_SCORE].toFixed(4),
  );

  elements.dialogProvenance.replaceChildren();
  addDetailRow(
    elements.dialogProvenance,
    "Block",
    formatCount(item[ITEM.BLOCK]),
    `https://mempool.space/block-height/${item[ITEM.BLOCK]}`,
  );
  addDetailRow(elements.dialogProvenance, "Mining pool", pool);
  addDetailRow(
    elements.dialogProvenance,
    "Fee rate",
    `${item[ITEM.FEE_RATE].toFixed(2)} sat/vB`,
  );
  addDetailRow(elements.dialogProvenance, "Parity bit", String(item[ITEM.PARITY]));
  addDetailRow(
    elements.dialogProvenance,
    "Sat",
    item[ITEM.SAT],
    `https://ordinals.com/sat/${item[ITEM.SAT]}`,
  );
  addDetailRow(
    elements.dialogProvenance,
    "Mint address",
    item[ITEM.MINT_ADDRESS],
    `https://mempool.space/address/${item[ITEM.MINT_ADDRESS]}`,
  );

  elements.dialogTransactionLink.href = `https://mempool.space/tx/${item[ITEM.TXID]}`;
  document.title = `Labitbu #${id} | Labitbu`;

  if (!elements.dialog.open) {
    elements.dialog.showModal();
    document.body.classList.add("dialog-open");
  }
}

function openItem(id, updateHash = true) {
  const item = state.itemsById.get(id);
  if (!item) {
    return;
  }

  if (updateHash && window.location.hash !== `#labitbu-${id}`) {
    window.history.pushState(null, "", `#labitbu-${id}`);
  }
  showItem(item);
}

function itemIdFromHash() {
  const match = window.location.hash.match(/^#labitbu-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function handleHash() {
  if (!state.data) {
    return;
  }

  const id = itemIdFromHash();
  if (id !== null) {
    openItem(id, false);
    return;
  }

  if (elements.dialog.open) {
    state.keepHashOnClose = true;
    elements.dialog.close();
  }

  const sectionHash = window.location.hash;
  if (sectionHash === "#top") {
    window.requestAnimationFrame(() => window.scrollTo(0, 0));
    return;
  }

  const section = sectionHash === "#collection" ? elements.grid.closest("section") : null;
  if (section) {
    window.requestAnimationFrame(() => section.scrollIntoView());
  }
}

function closeDialog() {
  if (elements.dialog.open) {
    elements.dialog.close();
  }
}

function bindEvents() {
  elements.form.addEventListener("submit", (event) => event.preventDefault());

  elements.search.addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(applyFilters, 120);
  });

  for (const select of [
    elements.body,
    elements.accessory,
    elements.copies,
    elements.rarity,
    elements.pool,
    elements.sort,
  ]) {
    select.addEventListener("change", applyFilters);
  }

  elements.form.addEventListener("reset", () => {
    window.setTimeout(applyFilters, 0);
  });

  document.querySelector("[data-reset-filters]").addEventListener("click", () => {
    elements.form.reset();
  });

  elements.firstPage.addEventListener("click", () => goToPage(1));
  elements.previousPage.addEventListener("click", () => goToPage(state.currentPage - 1));
  elements.nextPage.addEventListener("click", () => goToPage(state.currentPage + 1));
  elements.lastPage.addEventListener("click", () => {
    goToPage(Math.ceil(state.filteredItems.length / PAGE_SIZE));
  });

  elements.grid.addEventListener("click", (event) => {
    const card = event.target.closest("[data-item-id]");
    if (card) {
      openItem(Number(card.dataset.itemId));
    }
  });

  elements.dialogClose.addEventListener("click", closeDialog);
  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) {
      closeDialog();
    }
  });

  elements.dialog.addEventListener("close", () => {
    document.body.classList.remove("dialog-open");
    document.title = DEFAULT_TITLE;

    if (state.keepHashOnClose) {
      state.keepHashOnClose = false;
    } else if (itemIdFromHash() !== null) {
      window.history.replaceState(null, "", "#collection");
    }
  });

  window.addEventListener("hashchange", handleHash);
}

function validateData(data) {
  if (
    data.version !== 1 ||
    !Array.isArray(data.items) ||
    data.items.length !== data.stats.total ||
    !Array.isArray(data.images)
  ) {
    throw new Error("Collection data has an unsupported format");
  }
}

async function initialize() {
  bindEvents();

  try {
    const response = await fetch(new URL("data/collection.json", import.meta.url));
    if (!response.ok) {
      throw new Error(`Collection request failed with ${response.status}`);
    }

    const data = await response.json();
    validateData(data);
    state.data = data;
    state.itemsById = new Map(data.items.map((item) => [item[ITEM.ID], item]));

    populateFilters();
    cacheTraitCounts();
    applyFilters();
    elements.grid.setAttribute("aria-busy", "false");
    handleHash();
  } catch (error) {
    console.error(error);
    elements.status.textContent = "Collection unavailable";
    elements.grid.setAttribute("aria-busy", "false");
    elements.grid.hidden = true;
    elements.pagination.hidden = true;
    elements.loadError.hidden = false;
  }
}

initialize();
