const PAGE_SIZE = 24;

const state = {
  query: "",
  category: "",
  sort: "products-desc",
  page: 1,
};

const shops = Array.isArray(window.SHOPS) ? window.SHOPS : [];
const meta = window.SHOP_DIRECTORY_META || {};

const elements = {
  search: document.querySelector("#searchInput"),
  category: document.querySelector("#categoryFilter"),
  sort: document.querySelector("#sortSelect"),
  grid: document.querySelector("#shopGrid"),
  empty: document.querySelector("#emptyState"),
  previous: document.querySelector("#prevPage"),
  next: document.querySelector("#nextPage"),
  pageLabel: document.querySelector("#pageLabel"),
  resultCount: document.querySelector("#resultCount"),
  template: document.querySelector("#shopCardTemplate"),
};

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
}

function formatPrice(min, max) {
  if (!Number.isFinite(min)) return "暂无";
  if (!Number.isFinite(max) || min === max) return `¥${min.toFixed(2)}`;
  return `¥${min.toFixed(2)} - ${max.toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return "更新时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新时间未知";
  return `更新于 ${new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)}`;
}

function initials(name) {
  const normalized = String(name || "店").trim();
  return Array.from(normalized).slice(0, 2).join("").toUpperCase();
}

function avatarColor(name) {
  const palette = [
    ["#e2eee8", "#195f49"],
    ["#f5e8df", "#8a451f"],
    ["#e6edf5", "#315f83"],
    ["#efe8f2", "#674b70"],
    ["#f3edda", "#765f1f"],
  ];
  const hash = Array.from(String(name || "")).reduce((sum, char) => sum + char.codePointAt(0), 0);
  return palette[hash % palette.length];
}

function populateCategories() {
  const counts = new Map();
  shops.forEach((shop) => {
    shop.categories.forEach((category) => {
      counts.set(category, (counts.get(category) || 0) + 1);
    });
  });

  [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .forEach(([category, count]) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = `${category} (${count})`;
      elements.category.append(option);
    });
}

function filteredShops() {
  const query = state.query.trim().toLowerCase();
  const filtered = shops.filter((shop) => {
    const categoryMatch = !state.category || shop.categories.includes(state.category);
    const queryMatch = !query || shop.searchText.includes(query);
    return categoryMatch && queryMatch;
  });

  filtered.sort((a, b) => {
    if (state.sort === "updated-desc") return String(b.lastSeen).localeCompare(String(a.lastSeen));
    if (state.sort === "price-asc") return a.minPrice - b.minPrice || b.productCount - a.productCount;
    if (state.sort === "name-asc") return a.name.localeCompare(b.name, "zh-CN");
    return b.productCount - a.productCount || b.stock - a.stock;
  });

  return filtered;
}

function createCard(shop) {
  const card = elements.template.content.firstElementChild.cloneNode(true);
  const avatar = card.querySelector(".avatar");
  const [background, color] = avatarColor(shop.name);

  avatar.textContent = initials(shop.name);
  avatar.style.background = background;
  avatar.style.color = color;
  card.querySelector("h2").textContent = shop.name;
  card.querySelector(".updated").textContent = formatDate(shop.lastSeen);
  card.querySelector(".summary").textContent = shop.sampleProducts.length
    ? shop.sampleProducts.join(" / ")
    : "公开店铺";
  card.querySelector(".products").textContent = formatNumber(shop.productCount);
  card.querySelector(".price").textContent = formatPrice(shop.minPrice, shop.maxPrice);
  card.querySelector(".stock").textContent = formatNumber(shop.stock);

  const categoryContainer = card.querySelector(".categories");
  shop.categories.slice(0, 3).forEach((category) => {
    const chip = document.createElement("span");
    chip.className = "category-chip";
    chip.textContent = category;
    categoryContainer.append(chip);
  });

  const link = card.querySelector(".open-shop");
  link.href = shop.url;
  link.setAttribute("aria-label", `打开店铺：${shop.name}`);
  return card;
}

function render() {
  const results = filteredShops();
  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * PAGE_SIZE;
  const visible = results.slice(start, start + PAGE_SIZE);

  elements.grid.replaceChildren(...visible.map(createCard));
  elements.grid.hidden = visible.length === 0;
  elements.empty.hidden = visible.length !== 0;
  elements.resultCount.textContent = formatNumber(results.length);
  elements.pageLabel.textContent = `第 ${state.page} / ${totalPages} 页`;
  elements.previous.disabled = state.page <= 1;
  elements.next.disabled = state.page >= totalPages;

  if (window.lucide) window.lucide.createIcons();
}

elements.search.addEventListener("input", (event) => {
  state.query = event.target.value.toLowerCase();
  state.page = 1;
  render();
});

elements.category.addEventListener("change", (event) => {
  state.category = event.target.value;
  state.page = 1;
  render();
});

elements.sort.addEventListener("change", (event) => {
  state.sort = event.target.value;
  state.page = 1;
  render();
});

elements.previous.addEventListener("click", () => {
  if (state.page > 1) {
    state.page -= 1;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

elements.next.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(filteredShops().length / PAGE_SIZE));
  if (state.page < totalPages) {
    state.page += 1;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
});

document.querySelector("#shopCount").textContent = formatNumber(shops.length);
document.querySelector("#productCount").textContent = formatNumber(meta.productCount);
document.querySelector("#dataStatus").textContent = meta.generatedAt
  ? `公开在售商品汇总 · ${formatDate(meta.generatedAt).replace("更新于 ", "生成于 ")}`
  : "公开在售商品汇总";

populateCategories();
render();
