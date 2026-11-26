'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  store: null,
  mode: 'retail',
  category: 'Todas',
  search: '',
  stock: 'all',
  sort: 'featured',
  page: 1,
  pageSize: 8,
  cart: [],
  coupon: '',
  admin: false,
  editingImages: [],
};

const money = (value) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value);
const modeName = (mode) => mode === 'wholesale' ? 'Mayorista' : 'Minorista';

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('is-visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('is-visible'), 2600);
}

function openDialog(id) {
  const dialog = $(`#${id}`);
  if (dialog && !dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = $(`#${id}`);
  if (dialog?.open) dialog.close();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function activePromos(product) {
  return state.store.promotions.filter((promo) =>
    promo.active &&
    (promo.mode === 'all' || promo.mode === state.mode) &&
    (!promo.category || promo.category === product.category) &&
    (!promo.productId || promo.productId === product.id)
  ).sort((a, b) => b.percent - a.percent);
}

function availableProducts() {
  const products = state.store.products.filter((product) => product[state.mode].price > 0);
  const query = state.search.trim().toLocaleLowerCase('es');
  return products.filter((product) => {
    const matchesCategory = state.category === 'Todas' ||
      (state.category === 'Promos' ? activePromos(product).length > 0 : product.category === state.category);
    const matchesSearch = !query || [product.name, product.category, product.notes, product.description].some((value) => value.toLocaleLowerCase('es').includes(query));
    const matchesStock = state.stock === 'all' ||
      (state.stock === 'available' ? product[state.mode].stock > 0 : activePromos(product).length > 0);
    return matchesCategory && matchesSearch && matchesStock;
  }).sort((a, b) => {
    if (state.sort === 'price-asc') return a[state.mode].price - b[state.mode].price;
    if (state.sort === 'price-desc') return b[state.mode].price - a[state.mode].price;
    if (state.sort === 'newest') return new Date(b.createdAt) - new Date(a.createdAt);
    return 0;
  });
}

function productArt(product, className = '') {
  const image = product.images?.[0] || product.image || '';
  if (image) {
    const image = el('img', `product-image ${className}`);
    image.src = product.images?.[0] || product.image;
    image.alt = product.name;
    image.loading = 'lazy';
    image.decoding = 'async';
    return image;
  }
  const art = el('div', `product-art ${className}`);
  art.setAttribute('aria-label', `Ilustración de ${product.name}`);
  art.setAttribute('role', 'img');
  const bottle = el('span', 'art-bottle');
  bottle.append(el('span', 'art-bottle-cap'), el('span', 'art-bottle-label', 'CA'));
  art.append(bottle);
  return art;
}

function renderCategories() {
  const allCategories = ['Todas', ...state.store.categories];
  if (state.store.promotions.some((promo) => promo.active)) allCategories.push('Promos');
  const links = $('#category-links');
  links.replaceChildren();
  for (const [index, category] of allCategories.entries()) {
    const button = el('button', `category-link ${index === 0 ? 'category-link-featured' : ''}`);
    button.append(el('span', 'category-number', String(index + 1).padStart(2, '0')), el('span', 'category-name', category), el('span', 'category-arrow', '↗'));
    button.addEventListener('click', () => {
      state.category = category;
      state.page = 1;
      renderFilters();
      renderProducts();
      $('#catalog').scrollIntoView({ behavior: 'smooth' });
    });
    links.append(button);
  }
  renderFilters();
}

function renderFilters() {
  const chips = $('#filter-chips');
  chips.replaceChildren();
  const categories = ['Todas', ...state.store.categories];
  if (state.store.promotions.some((promo) => promo.active)) categories.push('Promos');
  categories.forEach((category) => {
    const button = el('button', `filter-chip ${state.category === category ? 'is-selected' : ''}`, category);
    button.setAttribute('aria-pressed', String(state.category === category));
    button.addEventListener('click', () => {
      state.category = category;
      state.page = 1;
      renderFilters();
      renderProducts();
    });
    chips.append(button);
  });
}

function productCard(product) {
  const offer = product[state.mode];
  const card = el('article', `product-card ${offer.stock === 0 ? 'is-sold-out' : ''}`);
  const imageButton = el('button', 'product-image-button');
  imageButton.type = 'button';
  imageButton.setAttribute('aria-label', `Ver detalles de ${product.name}`);
  imageButton.append(productArt(product));
  const promos = activePromos(product);
  if (promos.length) {
    const badge = el('span', 'promo-badge', `${promos[0].percent}% ${promos[0].code ? `· ${promos[0].code}` : 'OFF'}`);
    imageButton.append(badge);
  }
  card.append(imageButton);
  const content = el('div', 'product-card-content');
  const overline = el('div', 'product-overline');
  overline.append(el('span', '', product.category || 'ESENCIA'), el('span', 'product-index', 'CASA ÁMBAR'));
  content.append(overline);
  const title = el('button', 'product-title', product.name);
  title.type = 'button';
  content.append(title);
  content.append(el('p', 'product-notes', product.notes || 'Una fragancia para descubrir.'));
  const footer = el('div', 'product-card-footer');
  const price = el('strong', 'product-price', money(offer.price));
  const status = el('span', `stock-status ${offer.stock === 0 ? 'is-empty' : offer.stock < 5 ? 'is-low' : ''}`, offer.stock === 0 ? 'Agotado' : offer.stock < 5 ? 'Últimas unidades' : 'Disponible');
  const priceStock = el('div', 'price-stock');
  priceStock.append(price, status);
  footer.append(priceStock);
  const add = el('button', 'add-button', offer.stock === 0 ? 'Agotado' : '＋');
  add.type = 'button';
  add.disabled = offer.stock === 0;
  add.setAttribute('aria-label', `Agregar ${product.name} a la bolsa`);
  footer.append(add);
  content.append(footer);
  if (state.mode === 'wholesale') content.append(el('p', 'minimum-note', `Compra mínima: ${offer.minimum} unidades`));
  card.append(content);
  const open = () => showProduct(product);
  imageButton.addEventListener('click', open);
  title.addEventListener('click', open);
  add.addEventListener('click', () => addToCart(product, state.mode === 'wholesale' ? offer.minimum : 1));
  return card;
}

function renderProducts() {
  const products = availableProducts();
  const grid = $('#product-grid');
  grid.replaceChildren();
  $('#product-count').textContent = `${products.length} ${products.length === 1 ? 'fragancia' : 'fragancias'}`;
  if (!products.length) {
    const empty = el('div', 'empty-state');
    empty.append(el('span', 'empty-mark', '—'), el('h3', '', 'Todavía no encontramos ese aroma.'), el('p', '', 'Probá otra categoría o cambiá la búsqueda.'));
    grid.append(empty);
  } else {
    products.slice(0, state.page * state.pageSize).forEach((product) => grid.append(productCard(product)));
  }
  $('#load-more').hidden = products.length <= state.page * state.pageSize;
  $('#catalog-title').innerHTML = state.mode === 'wholesale'
    ? 'Aromas para <em>hacer crecer tu negocio.</em>'
    : 'Perfumes para <em>hacerlos tuyos.</em>';
  $('#catalog-subtitle').textContent = state.mode === 'wholesale'
    ? 'Precios por volumen y mínimos claros para cada producto.'
    : 'Aromas con personalidad, a un gesto de distancia.';
  $$('.mode-tab').forEach((tab) => {
    const active = tab.dataset.mode === state.mode;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-pressed', String(active));
  });
  updateCartCount();
}

function showProduct(product) {
  const detail = $('#product-detail');
  detail.replaceChildren();
  const artwork = productArt(product, 'detail-art');
  const imageColumn = el('div', 'detail-image-column');
  imageColumn.append(artwork);
  const photos = product.images || [];
  if (photos.length > 1) {
    const thumbnails = el('div', 'detail-thumbnails');
    photos.forEach((photo, index) => {
      const button = el('button', `detail-thumbnail ${index === 0 ? 'is-selected' : ''}`);
      button.type = 'button';
      button.setAttribute('aria-label', `Ver imagen ${index + 1} de ${product.name}`);
      const thumbnail = el('img');
      thumbnail.src = photo;
      thumbnail.alt = '';
      thumbnail.loading = 'lazy';
      button.append(thumbnail);
      button.addEventListener('click', () => {
        artwork.src = photo;
        $$('.detail-thumbnail', thumbnails).forEach((item) => item.classList.toggle('is-selected', item === button));
      });
      thumbnails.append(button);
    });
    imageColumn.append(thumbnails);
  }
  const content = el('div', 'detail-copy');
  content.append(el('p', 'eyebrow', `${product.category || 'ESENCIA'} · ${modeName(state.mode).toUpperCase()}`));
  content.append(el('h2', '', product.name));
  content.append(el('p', 'detail-notes', product.notes || 'Una fragancia para descubrir.'));
  content.append(el('p', 'detail-description', product.description || 'Descubrí todos sus matices y encontrá tu momento para llevarla.'));
  content.append(el('div', 'detail-price', money(product[state.mode].price)));
  content.append(el('p', 'detail-stock', product[state.mode].stock > 0 ? `${product[state.mode].stock} unidades disponibles` : 'Sin stock por el momento.'));
  if (state.mode === 'wholesale') content.append(el('p', 'detail-stock', `Mínimo por producto: ${product.wholesale.minimum} unidades.`));
  const promos = activePromos(product);
  if (promos.length) content.append(el('p', 'detail-promo', `${promos[0].percent}% de descuento${promos[0].code ? ` con el código ${promos[0].code}` : ''}.`));
  const add = el('button', 'button button-dark', product[state.mode].stock > 0 ? 'Sumar a mi bolsa ↗' : 'Sin stock');
  add.disabled = product[state.mode].stock < 1;
  add.addEventListener('click', () => {
    addToCart(product, state.mode === 'wholesale' ? product.wholesale.minimum : 1);
    closeDialog('product-dialog');
  });
  content.append(add);
  detail.append(imageColumn, content);
  openDialog('product-dialog');
}

function addToCart(product, quantity) {
  const mode = state.mode;
  const offer = product[mode];
  if (!offer.price || offer.stock < quantity) return toast('No hay stock suficiente para esa cantidad.');
  const existing = state.cart.find((item) => item.id === product.id && item.mode === mode);
  const nextQuantity = (existing?.quantity || 0) + quantity;
  if (nextQuantity > offer.stock) return toast(`Solo quedan ${offer.stock} unidades.`);
  if (existing) existing.quantity = nextQuantity;
  else state.cart.push({ id: product.id, mode, quantity });
  updateCartCount();
  renderCart();
  toast(`${product.name} se sumó a tu bolsa.`);
}

function updateCartCount() {
  $('#cart-count').textContent = state.cart.reduce((sum, item) => sum + item.quantity, 0);
}

function cartTotals(items = state.cart) {
  const subtotal = items.reduce((sum, item) => {
    const product = state.store.products.find((entry) => entry.id === item.id);
    return sum + (product ? product[item.mode].price * item.quantity : 0);
  }, 0);
  const promo = state.store.promotions.find((entry) => entry.active && entry.code && entry.code === state.coupon.toUpperCase());
  let couponEligible = false;
  const discount = items.reduce((sum, item) => {
    const product = state.store.products.find((entry) => entry.id === item.id);
    if (!product) return sum;
    const matches = (candidate) =>
      (candidate.mode === 'all' || candidate.mode === item.mode) &&
      (!candidate.category || candidate.category === product.category) &&
      (!candidate.productId || candidate.productId === product.id);
    const automatic = state.store.promotions
      .filter((candidate) => candidate.active && !candidate.code && subtotal >= candidate.minimum && matches(candidate))
      .sort((a, b) => b.percent - a.percent)[0];
    const applicable = promo && subtotal >= promo.minimum && matches(promo)
      ? (couponEligible = true, promo)
      : !state.coupon && automatic;
    return applicable ? sum + Math.round(product[item.mode].price * item.quantity * applicable.percent / 100) : sum;
  }, 0);
  return { subtotal, discount: couponEligible || !state.coupon ? discount : 0 };
}

function renderCart() {
  const list = $('#cart-items');
  list.replaceChildren();
  if (!state.cart.length) {
    list.append(el('div', 'empty-cart', 'Todavía no hay aromas en tu bolsa.'));
  }
  state.cart = state.cart.filter((item) => state.store.products.some((product) => product.id === item.id));
  state.cart.forEach((item) => {
    const product = state.store.products.find((entry) => entry.id === item.id);
    const row = el('article', 'cart-item');
    const image = productArt(product, 'cart-thumb');
    const info = el('div', 'cart-item-info');
    info.append(el('strong', '', product.name), el('span', 'cart-mode', modeName(item.mode)));
    if (item.mode === 'wholesale') info.append(el('span', 'cart-mode', `Mínimo ${product.wholesale.minimum} u.`));
    const quantity = el('div', 'quantity-control');
    const minus = el('button', '', '−');
    minus.type = 'button';
    minus.setAttribute('aria-label', `Quitar una unidad de ${product.name}`);
    minus.addEventListener('click', () => changeQuantity(item, -1));
    const count = el('span', '', String(item.quantity));
    const plus = el('button', '', '+');
    plus.type = 'button';
    plus.setAttribute('aria-label', `Agregar una unidad de ${product.name}`);
    plus.addEventListener('click', () => changeQuantity(item, 1));
    quantity.append(minus, count, plus);
    const amount = el('strong', 'cart-item-price', money(product[item.mode].price * item.quantity));
    row.append(image, info, quantity, amount);
    list.append(row);
  });
  const { subtotal, discount } = cartTotals();
  const totals = $('#cart-totals');
  totals.replaceChildren();
  const line = (label, amount, emphasis = false) => {
    const row = el('div', `total-line ${emphasis ? 'total-final' : ''}`);
    row.append(el('span', '', label), el('strong', '', money(amount)));
    totals.append(row);
  };
  line('Subtotal', subtotal);
  if (discount) line('Descuento', -discount);
  line('Total estimado', subtotal - discount, true);
  const submit = $('.checkout-button');
  submit.disabled = !state.cart.length;
}

function changeQuantity(item, delta) {
  const product = state.store.products.find((entry) => entry.id === item.id);
  if (delta > 0 && item.quantity >= product[item.mode].stock) return toast(`Solo quedan ${product[item.mode].stock} unidades.`);
  if (delta < 0 && item.mode === 'wholesale' && item.quantity - 1 < product.wholesale.minimum) {
    state.cart = state.cart.filter((entry) => entry !== item);
    renderCart();
    updateCartCount();
    return;
  }
  item.quantity += delta;
  if (item.quantity <= 0) state.cart = state.cart.filter((entry) => entry !== item);
  renderCart();
  updateCartCount();
}

async function compressImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Elegí un archivo de imagen.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
  if (!blob) throw new Error('No se pudo optimizar la imagen.');
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(blob);
  });
  return api('/api/admin/image', { method: 'POST', body: JSON.stringify({ type: blob.type, data }) });
}

function renderAdmin() {
  if (!state.admin) return;
  renderAdminProducts();
  renderAdminCategories();
  renderAdminPromotions();
  syncAdminSettings();
  fillCategorySelects();
}

function renderAdminProducts() {
  const list = $('#admin-products');
  list.replaceChildren();
  state.store.products.forEach((product) => {
    const row = el('article', 'admin-product');
    const name = el('div', 'admin-product-name');
    name.append(el('strong', '', product.name), el('span', '', product.category || 'Sin categoría'));
    const stock = el('div', 'admin-stock');
    stock.append(el('span', `stock-status ${product.retail.stock === 0 && product.wholesale.stock === 0 ? 'is-empty' : product.retail.stock < 5 ? 'is-low' : ''}`, `Minorista ${product.retail.stock} u.`));
    stock.append(el('span', `stock-status ${product.wholesale.stock === 0 ? 'is-empty' : ''}`, `Mayorista ${product.wholesale.stock} u.`));
    const actions = el('div', 'admin-actions');
    const edit = el('button', 'text-link', 'Editar');
    edit.type = 'button';
    edit.addEventListener('click', () => openProductForm(product));
    const remove = el('button', 'text-link danger-link', 'Eliminar');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar ${product.name} del catálogo?`)) return;
      try {
        await api(`/api/admin/products/${product.id}`, { method: 'DELETE' });
        await loadStore();
        renderAdmin();
        renderProducts();
        toast('Producto eliminado.');
      } catch (error) { toast(error.message); }
    });
    actions.append(edit, remove);
    row.append(name, stock, actions);
    list.append(row);
  });
}

function renderAdminCategories() {
  const list = $('#admin-categories');
  list.replaceChildren();
  state.store.categories.forEach((category, index) => {
    const tag = el('span', 'admin-tag');
    const label = el('span', '', category);
    const rename = el('button', '', '✎');
    rename.type = 'button';
    rename.setAttribute('aria-label', `Renombrar ${category}`);
    rename.addEventListener('click', async () => {
      const name = prompt('Nuevo nombre para la categoría:', category);
      if (!name || name.trim() === category) return;
      try { await api(`/api/admin/categories/${index}`, { method: 'PATCH', body: JSON.stringify({ name }) }); await loadStore(); renderAdmin(); renderProducts(); }
      catch (error) { toast(error.message); }
    });
    const remove = el('button', '', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Eliminar ${category}`);
    remove.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar la categoría "${category}"? Los productos quedarán sin categoría.`)) return;
      try { await api(`/api/admin/categories/${index}`, { method: 'DELETE' }); await loadStore(); renderAdmin(); renderProducts(); }
      catch (error) { toast(error.message); }
    });
    tag.append(label, rename, remove);
    list.append(tag);
  });
}

function renderAdminPromotions() {
  const list = $('#admin-promotions');
  list.replaceChildren();
  state.store.promotions.forEach((promo) => {
    const row = el('article', 'admin-promo');
    const name = el('div', '');
    name.append(el('strong', '', `${promo.name} · ${promo.percent}%`), el('span', '', promo.code ? `Código ${promo.code}` : 'Automática'));
    const toggleLabel = el('label', 'toggle-label');
    const toggle = el('input');
    toggle.type = 'checkbox';
    toggle.checked = promo.active;
    toggle.setAttribute('aria-label', `Activar ${promo.name}`);
    toggle.addEventListener('change', async () => {
      try { await api(`/api/admin/promotions/${promo.id}`, { method: 'PATCH', body: JSON.stringify({ ...promo, active: toggle.checked }) }); await loadStore(); renderAdmin(); renderProducts(); }
      catch (error) { toggle.checked = !toggle.checked; toast(error.message); }
    });
    toggleLabel.append(toggle, el('span', '', promo.active ? 'Activa' : 'Pausada'));
    const actions = el('div', 'admin-actions');
    const edit = el('button', 'text-link', 'Editar');
    edit.type = 'button';
    edit.addEventListener('click', () => {
      const form = $('#promo-form');
      form.elements.id.value = promo.id;
      form.elements.name.value = promo.name;
      form.elements.code.value = promo.code;
      form.elements.percent.value = promo.percent;
      form.elements.mode.value = promo.mode;
      form.elements.category.value = promo.category;
      form.elements.productId.value = promo.productId;
      form.elements.minimum.value = promo.minimum;
      form.elements.active.checked = promo.active;
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      form.elements.name.focus();
    });
    const remove = el('button', 'text-link danger-link', 'Eliminar');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar la promoción "${promo.name}"?`)) return;
      try { await api(`/api/admin/promotions/${promo.id}`, { method: 'DELETE' }); await loadStore(); renderAdmin(); renderProducts(); }
      catch (error) { toast(error.message); }
    });
    actions.append(edit, remove);
    row.append(name, toggleLabel, actions);
    list.append(row);
  });
}

function fillCategorySelects() {
  ['product-category', 'promo-category'].forEach((id) => {
    const select = $(`#${id}`);
    const current = select.value;
    select.replaceChildren(el('option', '', id === 'promo-category' ? 'Todas las categorías' : 'Sin categoría'));
    select.options[0].value = '';
    state.store.categories.forEach((category) => {
      const option = el('option', '', category);
      option.value = category;
      select.append(option);
    });
    select.value = state.store.categories.includes(current) ? current : '';
  });
  const productSelect = $('#promo-product');
  const selectedProduct = productSelect.value;
  productSelect.replaceChildren(el('option', '', 'Todos los productos'));
  productSelect.options[0].value = '';
  state.store.products.forEach((product) => {
    const option = el('option', '', product.name);
    option.value = product.id;
    productSelect.append(option);
  });
  productSelect.value = state.store.products.some((product) => product.id === selectedProduct) ? selectedProduct : '';
}

function syncAdminSettings() {
  const form = $('#settings-form');
  Object.entries(state.store.settings).forEach(([key, value]) => {
    const field = form.elements[key];
    if (field && field.type !== 'file' && field.type !== 'checkbox') field.value = value || (field.type === 'color' ? '#ffffff' : '');
  });
  form.elements.removeAvatar.checked = false;
}

function openProductForm(product) {
  const form = $('#product-form');
  fillCategorySelects();
  form.hidden = false;
  $('#admin-products').hidden = true;
  $('#new-product').hidden = true;
  $('#product-form-title').innerHTML = product ? 'Editar <em>producto.</em>' : 'Nuevo <em>producto.</em>';
  form.elements.id.value = product?.id || '';
  form.elements.name.value = product?.name || '';
  form.elements.category.value = product?.category || '';
  form.elements.description.value = product?.description || '';
  form.elements.notes.value = product?.notes || '';
  form.elements.retailPrice.value = product?.retail.price || '';
  form.elements.retailStock.value = product?.retail.stock ?? 0;
  form.elements.wholesalePrice.value = product?.wholesale.price || '';
  form.elements.wholesaleStock.value = product?.wholesale.stock ?? 0;
  form.elements.wholesaleMinimum.value = product?.wholesale.minimum ?? 1;
  form.elements.images.value = '';
  state.editingImages = [...(product?.images || (product?.image ? [product.image] : []))];
  renderEditingPhotos();
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  form.elements.name.focus();
}

function closeProductForm() {
  $('#product-form').hidden = true;
  $('#admin-products').hidden = false;
  $('#new-product').hidden = false;
  $('#product-form').reset();
  state.editingImages = [];
  renderEditingPhotos();
}

function renderEditingPhotos() {
  const container = $('#editing-photos');
  container.replaceChildren();
  state.editingImages.forEach((url, index) => {
    const item = el('div', 'editing-photo');
    const image = el('img');
    image.src = url;
    image.alt = `Foto actual ${index + 1}`;
    image.loading = 'lazy';
    const remove = el('button', 'text-link danger-link', 'Quitar');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      state.editingImages.splice(index, 1);
      renderEditingPhotos();
    });
    item.append(image, remove);
    container.append(item);
  });
}

async function loadStore() {
  try {
    state.store = await api('/api/store');
    $('#connection-error').hidden = true;
  } catch (error) {
    $('#connection-error').hidden = false;
    throw error;
  }
  const settings = state.store.settings;
  document.title = `${settings.name} — perfumería de autor`;
  $('#brand-name').textContent = settings.name;
  $('.hero-description').textContent = settings.tagline;
  $$('.footer-brand').forEach((node) => { node.firstChild.textContent = settings.name; });
  document.documentElement.style.setProperty('--accent', settings.accent);
  document.documentElement.style.setProperty('--paper', settings.background);
  document.documentElement.style.setProperty('--ink', settings.ink);
  if (settings.avatar) {
    $('#brand-avatar').src = settings.avatar;
    $('#brand-avatar').hidden = false;
    $('.brand-mark').hidden = true;
  } else {
    $('#brand-avatar').hidden = true;
    $('.brand-mark').hidden = false;
  }
  const phone = settings.whatsapp.replace(/\D/g, '');
  const contact = $('#contact-link');
  if (phone) {
    contact.href = `https://wa.me/${phone}`;
    contact.target = '_blank';
    contact.rel = 'noopener';
  } else {
    contact.href = '#';
    contact.removeAttribute('target');
    contact.removeAttribute('rel');
  }
  renderCategories();
  renderProducts();
}

function setMode(mode) {
  if (!['retail', 'wholesale'].includes(mode)) return;
  state.mode = mode;
  state.category = 'Todas';
  state.page = 1;
  renderFilters();
  renderProducts();
  if (state.admin) renderAdmin();
}

function receipt(order, whatsapp) {
  const summary = $('#receipt-summary');
  summary.replaceChildren();
  summary.append(el('p', '', `Pedido ${order.id.slice(0, 8).toUpperCase()} · ${new Date(order.createdAt).toLocaleString('es-AR')}`));
  order.items.forEach((item) => summary.append(el('p', 'receipt-line', `${item.quantity} × ${item.name} (${modeName(item.mode)}) — ${money(item.unitPrice * item.quantity)}`)));
  summary.append(el('p', 'receipt-total', `Total estimado: ${money(order.total)}`));
  const button = $('#receipt-whatsapp');
  if (whatsapp) {
    const message = [`Hola, hice el pedido ${order.id.slice(0, 8).toUpperCase()}:`, ...order.items.map((item) => `${item.quantity} × ${item.name} (${modeName(item.mode)})`), `Total estimado: ${money(order.total)}`].join('\n');
    button.href = `https://wa.me/${whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
    button.hidden = false;
  } else button.hidden = true;
  openDialog('receipt-dialog');
}

$$('[data-mode]').forEach((button) => button.addEventListener('click', () => {
  setMode(button.dataset.mode);
  $('#catalog').scrollIntoView({ behavior: 'smooth' });
}));
$$('[data-scroll-catalog]').forEach((button) => button.addEventListener('click', () => $('#catalog').scrollIntoView({ behavior: 'smooth' })));
$$('[data-close]').forEach((button) => button.addEventListener('click', () => closeDialog(button.dataset.close)));
$$('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
}));

$('#quick-search').addEventListener('input', (event) => {
  state.search = event.target.value;
  state.page = 1;
  renderProducts();
  $('#catalog').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#sort-select').addEventListener('change', (event) => { state.sort = event.target.value; renderProducts(); });
$('#stock-filter').addEventListener('change', (event) => { state.stock = event.target.value; state.page = 1; renderProducts(); });
$('#load-more').addEventListener('click', () => { state.page += 1; renderProducts(); });
$('#cart-open').addEventListener('click', () => { renderCart(); openDialog('cart-dialog'); });
$('#settings-open').addEventListener('click', () => openDialog('settings-dialog'));
$('#admin-entry').addEventListener('click', async () => {
  closeDialog('settings-dialog');
  try {
    const session = await api('/api/admin/session');
    state.admin = session.authenticated;
    if (state.admin) { renderAdmin(); openDialog('admin-dialog'); }
    else openDialog('login-dialog');
  } catch (error) { toast(error.message); }
});
$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = $('#login-message');
  message.textContent = '';
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: event.currentTarget.elements.password.value }) });
    state.admin = true;
    event.currentTarget.reset();
    closeDialog('login-dialog');
    renderAdmin();
    openDialog('admin-dialog');
  } catch (error) { message.textContent = error.message; }
});
$('#logout-button').addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', { method: 'POST', body: '{}' });
    state.admin = false;
    closeDialog('admin-dialog');
    toast('Sesión cerrada.');
  } catch (error) { toast(error.message); }
});
$('#apply-coupon').addEventListener('click', () => {
  state.coupon = $('#coupon-input').value.trim().toUpperCase();
  const totals = cartTotals();
  const message = $('#coupon-message');
  const promo = state.store.promotions.find((entry) => entry.active && entry.code === state.coupon);
  if (!state.coupon) message.textContent = 'Ingresá un código para aplicarlo.';
  else if (!promo) message.textContent = 'No encontramos ese código.';
  else if (!totals.discount) message.textContent = 'Ese código no aplica a los productos seleccionados.';
  else message.textContent = `¡Listo! Ahorrás ${money(totals.discount)}.`;
  message.classList.toggle('is-success', Boolean(totals.discount));
  renderCart();
});
$('#checkout-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.cart.length) return;
  const form = event.currentTarget;
  const submit = $('.checkout-button');
  submit.disabled = true;
  try {
    const result = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        items: state.cart,
        coupon: state.coupon,
        customer: { name: form.elements.customerName.value, contact: form.elements.contact.value },
        delivery: form.elements.delivery.value,
        payment: form.elements.payment.value,
      }),
    });
    state.cart = [];
    state.coupon = '';
    $('#coupon-input').value = '';
    $('#coupon-message').textContent = '';
    form.reset();
    closeDialog('cart-dialog');
    updateCartCount();
    let refreshError;
    try { await loadStore(); }
    catch (error) { refreshError = error; console.error(error); }
    receipt(result.order, result.whatsapp);
    if (refreshError) toast('El pedido quedó confirmado, pero no se pudo actualizar el catálogo. Recargá la página.');
  } catch (error) {
    toast(error.message);
    try { await loadStore(); }
    catch (refreshError) { console.error(refreshError); }
    renderCart();
  } finally { submit.disabled = false; }
});

$('#new-product').addEventListener('click', () => openProductForm(null));
$$('[data-product-close]').forEach((button) => button.addEventListener('click', closeProductForm));
$('#product-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const selectedPhotos = [...form.elements.images.files];
    if (state.editingImages.length + selectedPhotos.length > 5) throw new Error('Un producto puede tener hasta 5 fotos.');
    const newImages = [];
    for (const file of selectedPhotos) newImages.push((await compressImage(file)).image);
    const images = [...state.editingImages, ...newImages];
    const product = {
      name: form.elements.name.value,
      category: form.elements.category.value,
      description: form.elements.description.value,
      notes: form.elements.notes.value,
      images,
      retail: { price: form.elements.retailPrice.value, stock: form.elements.retailStock.value },
      wholesale: { price: form.elements.wholesalePrice.value, stock: form.elements.wholesaleStock.value, minimum: form.elements.wholesaleMinimum.value },
    };
    const id = form.elements.id.value;
    await api(id ? `/api/admin/products/${id}` : '/api/admin/products', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(product) });
    closeProductForm();
    await loadStore();
    renderAdmin();
    toast('Producto guardado.');
  } catch (error) { toast(error.message); }
  finally { submit.disabled = false; }
});
$('#category-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/admin/categories', { method: 'POST', body: JSON.stringify({ name: event.currentTarget.elements.name.value }) });
    event.currentTarget.reset();
    await loadStore();
    renderAdmin();
    toast('Categoría creada.');
  } catch (error) { toast(error.message); }
});
$('#promo-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const promo = {
    name: form.elements.name.value,
    code: form.elements.code.value,
    percent: form.elements.percent.value,
    mode: form.elements.mode.value,
    category: form.elements.category.value,
    productId: form.elements.productId.value,
    minimum: form.elements.minimum.value,
    active: form.elements.active.checked,
  };
  const id = form.elements.id.value;
  try {
    await api(id ? `/api/admin/promotions/${id}` : '/api/admin/promotions', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(promo) });
    form.reset();
    form.elements.active.checked = true;
    await loadStore();
    renderAdmin();
    renderProducts();
    toast(id ? 'Promoción actualizada.' : 'Promoción creada.');
  } catch (error) { toast(error.message); }
});
$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    let avatar = state.store.settings.avatar;
    if (form.elements.avatar.files[0]) avatar = (await compressImage(form.elements.avatar.files[0])).image;
    if (form.elements.removeAvatar.checked) avatar = '';
    await api('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        name: form.elements.name.value,
        tagline: form.elements.tagline.value,
        whatsapp: form.elements.whatsapp.value,
        accent: form.elements.accent.value,
        background: form.elements.background.value,
        ink: form.elements.ink.value,
        avatar,
      }),
    });
    await loadStore();
    renderAdmin();
    toast('Apariencia guardada.');
  } catch (error) { toast(error.message); }
  finally { submit.disabled = false; }
});

$('#year').textContent = new Date().getFullYear();
$('#contact-link').addEventListener('click', (event) => {
  if (!state.store?.settings.whatsapp.replace(/\D/g, '')) {
    event.preventDefault();
    toast('El WhatsApp de la tienda todavía no está configurado.');
  }
});
loadStore().catch((error) => {
  console.error(error);
  toast('No pudimos cargar la tienda. Revisá que el servidor esté activo.');
});
