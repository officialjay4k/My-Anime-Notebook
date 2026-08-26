const STORAGE_KEY = 'void-anime-notebook';
const JIKAN_URL = 'https://api.jikan.moe/v4';
const ANILIST_URL = 'https://graphql.anilist.co';
const EPISODE_API_URL = 'https://kitsu.io/api/edge';
const SEARCH_DELAY = 750;
const ANIME_GOAL = 1000;
const SUPABASE_URL = window.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || '';
const supabaseClient = window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const state = {
  anime: [],
  filter: 'All',
  query: '',
  searchResults: [],
  discoveryResults: [],
  selectedAnime: null,
  selectedEpisode: null,
  searchTimer: null,
  searchController: null,
  episodeController: null,
  editingId: null
};
const episodeCache = new Map();

const $ = (selector) => document.querySelector(selector);
const elements = {
  libraryView: $('#libraryView'),
  discoveryView: $('#discoveryView'),
  animeView: $('#animeView'),
  episodeView: $('#episodeView'),
  animeList: $('#animeList'),
  statusTabs: $('#statusTabs'),
  animeDetail: $('#animeDetail'),
  episodeDetail: $('#episodeDetail'),
  modal: $('#addAnimeModal'),
  modalInput: $('#modalSearchInput'),
  searchResults: $('#searchResults'),
  searchStatus: $('#searchStatus'),
  addDetailStep: $('#addDetailStep'),
  dbStatus: $('#dbStatus'),
  discoveryList: $('#discoveryList'),
  discoveryStatus: $('#discoveryStatus')
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function readObject(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function getTitle(item) {
  return item.title_english || item.title?.english || item.title?.romaji || item.title || 'Unknown title';
}

function getCover(item) {
  return item.cover || item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || item.coverImage?.large || item.coverImage?.medium || '';
}

function normalize(item) {
  const totalEpisodes = Number(item.totalEpisodes ?? item.total_episodes ?? item.episodes) || 1;
  return {
    ...item,
    id: item.id ?? item.mal_id ?? crypto.randomUUID(),
    mal_id: item.mal_id ?? null,
    title: getTitle(item),
    cover: getCover(item),
    episodes: Number(item.episodes) || totalEpisodes,
    currentEpisode: Math.max(0, Number(item.currentEpisode ?? item.current_episode ?? 0)),
    totalEpisodes,
    rating: Math.min(10, Math.max(0, Number(item.rating) || 0)),
    status: item.status || 'Watching',
    notes: item.notes || '',
    vip: Boolean(item.vip),
    rewatch: Boolean(item.rewatch),
    episodeNotes: readObject(item.episodeNotes ?? item.episode_notes),
    loadedEpisodes: item.loadedEpisodes || []
  };
}

function setDatabaseStatus(text) {
  if (elements.dbStatus) elements.dbStatus.textContent = text;
}

async function loadAnime() {
  if (supabaseClient) {
    const { data, error } = await supabaseClient.from('anime_library').select('id,title,cover,status,current_episode,total_episodes,rating,notes,episode_notes,updated_at').order('updated_at', { ascending: false });
    if (!error && Array.isArray(data)) {
      state.anime = data.map(normalize);
      setDatabaseStatus('Supabase live');
      return;
    }
    setDatabaseStatus('Database setup needed');
  }

  try {
    state.anime = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').map(normalize);
  } catch {
    state.anime = [];
  }
}

async function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.anime));
  if (!supabaseClient) {
    setDatabaseStatus('Local save');
    return true;
  }

  const rows = state.anime.map((item) => ({
    id: item.id,
    title: item.title,
    cover: item.cover,
    status: item.status,
    current_episode: item.currentEpisode,
    total_episodes: item.totalEpisodes,
    rating: item.rating,
    notes: item.notes,
    episode_notes: item.episodeNotes,
    vip: item.vip,
    rewatch: item.rewatch,
    updated_at: new Date().toISOString()
  }));
  let { error } = await supabaseClient.from('anime_library').upsert(rows, { onConflict: 'id' });
  if (error && /vip|rewatch|column/i.test(error.message || '')) {
    const compatibleRows = rows.map(({ vip, rewatch, ...row }) => row);
    ({ error } = await supabaseClient.from('anime_library').upsert(compatibleRows, { onConflict: 'id' }));
  }
  setDatabaseStatus(error ? 'Saved locally' : 'Supabase live');
  return !error;
}

function showView(view) {
  [elements.libraryView, elements.discoveryView, elements.animeView, elements.episodeView].forEach((item) => item.classList.remove('active-view'));
  view.classList.add('active-view');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function fetchDiscovery() {
  elements.discoveryStatus.textContent = 'Finding a fresh selection...';
  elements.discoveryList.innerHTML = '<div class="empty-state"><span>Searching the anime database...</span></div>';
  try {
    const response = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: 'query($page:Int){ Page(page:$page, perPage:12) { media(type:ANIME, sort:POPULARITY_DESC, isAdult:false, status_in:[FINISHED, RELEASING]) { id title { romaji english } coverImage { large medium } episodes averageScore genres } } }',
        variables: { page: Math.floor(Math.random() * 40) + 1 }
      })
    });
    if (!response.ok) throw new Error('Discovery request failed');
    const data = await response.json();
    const results = (data.data?.Page?.media || []).map(normalize);
    state.discoveryResults = results;
    elements.discoveryStatus.textContent = `${results.length} random titles found`;
    elements.discoveryList.innerHTML = results.map((item) => `<article class="discovery-card"><img src="${escapeHtml(item.cover)}" alt="${escapeHtml(item.title)}" /><div><h2>${escapeHtml(item.title)}</h2><p>${item.episodes || '?'} episodes${item.averageScore ? ` · ${item.averageScore}% score` : ''}</p><button class="discover-add" data-discover-id="${item.id}" type="button">Add to notebook</button></div></article>`).join('');
  } catch (error) {
    console.error('Discovery request failed:', error);
    elements.discoveryStatus.textContent = 'Discovery is temporarily unavailable.';
    elements.discoveryList.innerHTML = '<div class="empty-state"><strong>Could not load anime</strong><span>Try New selection again.</span></div>';
  }
}

function openDiscovery() {
  showView(elements.discoveryView);
  fetchDiscovery();
}

function statusClass(status) {
  return { Watching: 'watching', Watched: 'watched', Dropped: 'dropped', 'Plan to Watch': 'planned' }[status] || 'watching';
}

function renderStars(rating, interactive = false) {
  return Array.from({ length: 10 }, (_, index) => {
    const number = index + 1;
    return interactive
      ? `<button class="rating-star ${number <= rating ? 'filled' : ''}" data-rating="${number}" type="button" aria-label="${number} out of 10 stars">★</button>`
      : `<span class="${number <= rating ? 'filled' : ''}">★</span>`;
  }).join('');
}

function renderLibrary() {
  const statuses = ['All', 'Watching', 'Watched', 'Plan to Watch', 'Dropped'];
  elements.statusTabs.innerHTML = statuses.map((status) => `<button class="status-tab ${state.filter === status ? 'active' : ''}" data-status="${status}" type="button">${status}</button>`).join('');
  const visible = state.anime.filter((item) => (state.filter === 'All' || item.status === state.filter) && `${item.title} ${item.notes}`.toLowerCase().includes(state.query.toLowerCase()));
  const watchedCount = state.anime.filter((item) => item.status === 'Watched').length;
  $('#goalCounter').innerHTML = `<span class="goal-label">Anime goal</span><strong>${watchedCount.toLocaleString()} <small>/ ${ANIME_GOAL.toLocaleString()}</small></strong><span class="goal-track"><i style="width:${Math.min(100, watchedCount / ANIME_GOAL * 100)}%"></i></span>`;

  if (!visible.length) {
    elements.animeList.innerHTML = '<div class="empty-state"><strong>Your archive is empty</strong><span>Add an anime to begin your notebook.</span></div>';
    return;
  }

  elements.animeList.innerHTML = visible.map((item) => {
    const total = item.totalEpisodes || 1;
    const progress = Math.min(100, Math.max(0, item.currentEpisode / total * 100));
    return `<article class="anime-card">
      <button class="cover-button" data-open-anime="${item.id}" type="button">
        <img src="${escapeHtml(item.cover)}" alt="${escapeHtml(item.title)}" />
        <span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status)} · ${item.currentEpisode}/${total}</span>
        ${item.vip ? '<span class="vip-badge">VIP</span>' : ''}${item.rewatch ? '<span class="rewatch-badge">REWATCH</span>' : ''}
      </button>
      <div class="card-copy"><div class="card-title-row"><h2>${escapeHtml(item.title)}</h2>${item.vip ? '<span class="vip-mark">✦</span>' : ''}</div>
        <div class="stars">${renderStars(item.rating)}</div><p>${escapeHtml(item.notes || 'No notes yet.')}</p>
        <div class="progress"><span style="width:${progress}%"></span></div>
        <div class="card-actions"><button class="edit-card-button" data-edit-anime="${item.id}" type="button">Edit details</button><button class="remove-card-button" data-remove-anime="${item.id}" type="button">Remove</button></div>
      </div>
    </article>`;
  }).join('');
}

async function searchAnime(query) {
  const value = query.trim();
  if (value.length < 2) { elements.searchResults.innerHTML = ''; return; }
  if (state.searchController) state.searchController.abort();
  state.searchController = new AbortController();
  elements.searchStatus.textContent = 'Searching...';
  try {
    const response = await fetch(`${JIKAN_URL}/anime?q=${encodeURIComponent(value)}&limit=8&sfw=true`, { signal: state.searchController.signal });
    if (!response.ok) throw new Error('Jikan unavailable');
    state.searchResults = (await response.json()).data.map(normalize);
  } catch (error) {
    if (error.name === 'AbortError') return;
    try {
      const response = await fetch(ANILIST_URL, { method: 'POST', signal: state.searchController.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'query($search:String){Page(page:1,perPage:8){media(search:$search,type:ANIME,isAdult:false){id title{romaji english} coverImage{large medium} episodes}}}', variables: { search: value } }) });
      const data = await response.json();
      state.searchResults = (data.data?.Page?.media || []).map(normalize);
    } catch { state.searchResults = []; }
  }
  elements.searchStatus.textContent = `${state.searchResults.length} result${state.searchResults.length === 1 ? '' : 's'}`;
  elements.searchResults.innerHTML = state.searchResults.length ? state.searchResults.map((item) => `<button class="search-result" data-result-id="${item.id}" type="button"><img src="${escapeHtml(item.cover)}" alt="" /><span><strong>${escapeHtml(item.title)}</strong><small>${item.episodes} episodes · ${item.type || 'Anime'}</small></span></button>`).join('') : '<div class="empty-state">No matching anime found.</div>';
}

function makeAddForm(item) {
  return `<div class="add-detail"><button class="back-link" data-add-back type="button">← Change anime</button><div class="selected-preview"><img src="${escapeHtml(item.cover)}" alt="" /><div><p class="eyebrow">Selected title</p><h2>${escapeHtml(item.title)}</h2></div></div><div class="form-grid"><label class="field">Status<select id="addStatus"><option>Watching</option><option>Watched</option><option>Dropped</option><option>Plan to Watch</option></select></label><label class="field">On episode<input id="addEpisode" type="number" min="0" value="0" /></label><label class="field full">Rating<div id="addRating" class="star-rating">${renderStars(0, true)}</div></label><label class="vip-toggle full"><input id="addVip" type="checkbox" /> Mark as VIP anime</label><label class="vip-toggle full"><input id="addRewatch" type="checkbox" /> Mark for Rewatch</label><label class="field full">Notes<textarea id="addNotes" rows="3" placeholder="Write a note about this anime..."></textarea></label></div><button id="commitAnime" class="primary-btn wide" type="button">Commit to Library</button></div>`;
}

function normalizeEpisode(episode) {
  const attributes = episode.attributes || {};
  const number = attributes.number || attributes.relativeNumber || episode.id;
  return { number, title: attributes.canonicalTitle || attributes.titles?.en_us || attributes.titles?.en_jp || `Episode ${number}`, image: attributes.thumbnail?.original || attributes.thumbnail?.large || '' };
}

async function fetchEpisodes(item) {
  const cacheKey = `${item.title}`.toLowerCase();
  if (episodeCache.has(cacheKey)) return episodeCache.get(cacheKey);
  if (state.episodeController) state.episodeController.abort();
  state.episodeController = new AbortController();
  try {
    const animeResponse = await fetch(`${EPISODE_API_URL}/anime?filter%5Btext%5D=${encodeURIComponent(item.title)}&page%5Blimit%5D=5`, { signal: state.episodeController.signal });
    if (!animeResponse.ok) throw new Error(`Anime lookup returned ${animeResponse.status}`);
    const animeData = await animeResponse.json();
    const matches = animeData.data || [];
    const requestedTitle = item.title.toLowerCase();
    const match = matches.find((candidate) => {
      const candidateTitle = candidate.attributes?.canonicalTitle?.toLowerCase() || '';
      return candidateTitle === requestedTitle || candidateTitle.includes(requestedTitle) || requestedTitle.includes(candidateTitle);
    }) || matches[0];
    const kitsuId = match?.id;
    if (!kitsuId) throw new Error('Kitsu did not find this anime');
    const episodes = [];
    const pageSize = 20;
    for (let offset = 0; offset < 1000; offset += pageSize) {
      const response = await fetch(`${EPISODE_API_URL}/episodes?filter%5Bmedia_id%5D=${encodeURIComponent(kitsuId)}&page%5Blimit%5D=${pageSize}&page%5Boffset%5D=${offset}`, { signal: state.episodeController.signal });
      if (!response.ok) throw new Error(`Episode lookup returned ${response.status}`);
      const data = await response.json();
      const page = data.data || [];
      episodes.push(...page.map(normalizeEpisode));
      if (page.length < pageSize) break;
    }
    episodes.sort((first, second) => Number(first.number) - Number(second.number));
    episodeCache.set(cacheKey, episodes);
    return episodes;
  } catch (error) {
    if (error.name !== 'AbortError') console.warn('Episode API failed:', error);
    return [];
  }
}

function episodeRows(item, episodes) {
  return episodes.length ? episodes.map((episode) => `<button class="episode-row" data-episode-number="${episode.number}" type="button"><span class="episode-thumb">${episode.image ? `<img src="${escapeHtml(episode.image)}" alt="" />` : ''}</span><span><strong>Episode ${episode.number}</strong><small>${escapeHtml(episode.title)}</small></span><span class="note-indicator">${item.episodeNotes?.[episode.number] ? 'Note saved' : '＋ Note'}</span></button>`).join('') : '<div class="empty-state">No episode data is available right now.</div>';
}

async function renderAnimeDetail(item) {
  state.selectedAnime = item;
  showView(elements.animeView);
    elements.animeDetail.innerHTML = `<div class="anime-hero"><img class="hero-poster" src="${escapeHtml(item.cover)}" alt="${escapeHtml(item.title)}" /><div class="hero-copy"><div class="hero-title-row"><span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span>${item.vip ? '<span class="vip-badge inline">VIP</span>' : ''}${item.rewatch ? '<span class="rewatch-badge inline">REWATCH</span>' : ''}</div><h1>${escapeHtml(item.title)}</h1><p class="muted">${item.totalEpisodes || item.episodes || '?'} episodes · Your personal record</p><p>${escapeHtml(item.notes || 'No notes yet.')}</p><div class="stars large">${renderStars(item.rating)}</div><div class="hero-controls"><label>On episode<input id="heroEpisode" type="number" min="0" max="${item.totalEpisodes}" value="${item.currentEpisode}" /></label><button id="editAnimeButton" class="ghost-btn" type="button">Edit details</button><button id="openChronicles" class="primary-btn" type="button">Open episode chronicles</button></div></div></div><section class="chronicle-preview"><div class="section-title"><h2>Chronological Logs</h2><span id="episodeLoading">Loading episodes...</span></div><div id="heroEpisodes" class="episode-list"><div class="episode-loading">Fetching episode list and previews...</div></div></section>`;
  const episodes = await fetchEpisodes(item);
  item.loadedEpisodes = episodes;
  $('#episodeLoading').textContent = episodes.length ? `${episodes.length} episodes` : 'No episode data';
  $('#heroEpisodes').innerHTML = episodeRows(item, episodes);
  bindEpisodeRows($('#heroEpisodes'), item, episodes);
  $('#heroEpisode').addEventListener('change', async (event) => { item.currentEpisode = Math.min(item.totalEpisodes, Math.max(0, Number(event.target.value) || 0)); event.target.value = item.currentEpisode; await persist(); renderLibrary(); });
  $('#openChronicles').addEventListener('click', () => renderChronicles(item));
  $('#editAnimeButton').addEventListener('click', () => openEditForm(item));
}

function bindEpisodeRows(container, item, episodes) {
  container.querySelectorAll('[data-episode-number]').forEach((button) => button.addEventListener('click', () => renderEpisodeEntry(item, episodes.find((episode) => String(episode.number) === button.dataset.episodeNumber))));
}

function renderChronicles(item) {
  showView(elements.episodeView);
  elements.episodeDetail.innerHTML = `<div class="page-heading"><div><p class="eyebrow">${escapeHtml(item.title)}</p><h1>Episode Chronicles</h1><p class="muted">A chronological record of your observations.</p></div><aside class="summary-panel"><p class="eyebrow">Astral Summary</p><h2>${Object.keys(item.episodeNotes || {}).length} notes</h2><p class="muted">Your notes across this series.</p></aside></div><div class="chronicle-list" id="chronicleList"></div>`;
  const list = $('#chronicleList');
  list.innerHTML = episodeRows(item, item.loadedEpisodes || []);
  bindEpisodeRows(list, item, item.loadedEpisodes || []);
}

function renderEpisodeEntry(item, episode) {
  if (!episode) return;
  state.selectedEpisode = episode;
  showView(elements.episodeView);
  const note = item.episodeNotes?.[episode.number] || '';
  elements.episodeDetail.innerHTML = `<button id="episodeEntryBack" class="back-link" type="button">← Back to Episodes</button><article class="entry-card"><div class="entry-header"><span class="episode-thumb large">${episode.image ? `<img src="${escapeHtml(episode.image)}" alt="" />` : ''}</span><div><p class="eyebrow">Episode ${episode.number}</p><h1>${escapeHtml(episode.title)}</h1><p class="muted">Private archive note</p></div></div><label class="field">My observations<textarea id="episodeNoteEditor" rows="8" placeholder="Write your thoughts about this episode...">${escapeHtml(note)}</textarea></label><button id="saveEpisodeNote" class="primary-btn" type="button">Save entry</button></article>`;
  $('#episodeEntryBack').addEventListener('click', () => renderChronicles(item));
  $('#saveEpisodeNote').addEventListener('click', async () => { item.episodeNotes = item.episodeNotes || {}; item.episodeNotes[episode.number] = $('#episodeNoteEditor').value.trim(); await persist(); $('#saveEpisodeNote').textContent = 'Entry saved'; });
}

function openEditForm(item) {
  state.editingId = item.id;
  openAddModal(item);
}

function openAddModalFromDiscovery(item) {
  state.editingId = null;
  elements.modal.classList.remove('hidden');
  elements.modalInput.parentElement.classList.add('hidden');
  elements.searchResults.classList.add('hidden');
  elements.addDetailStep.classList.remove('hidden');
  elements.addDetailStep.innerHTML = makeAddForm(item);
  bindAddForm(item);
}

function openAddModal(editingItem = null) {
  elements.modal.classList.remove('hidden');
  elements.modal.setAttribute('aria-hidden', 'false');
  elements.modalInput.parentElement.classList.toggle('hidden', Boolean(editingItem));
  elements.searchResults.classList.toggle('hidden', Boolean(editingItem));
  elements.addDetailStep.classList.remove('hidden');
  const item = editingItem || state.searchResults[0];
  if (editingItem) {
    elements.addDetailStep.innerHTML = makeAddForm(item);
    $('#addStatus').value = item.status;
    $('#addEpisode').value = item.currentEpisode;
    $('#addNotes').value = item.notes;
      $('#addVip').checked = item.vip;
      $('#addRewatch').checked = item.rewatch;
    $('#addRating').dataset.value = item.rating;
    $('#addRating').innerHTML = renderStars(item.rating, true);
  }
  bindAddForm(item);
}

function bindAddForm(item) {
  $('[data-add-back]')?.addEventListener('click', () => { state.editingId = null; elements.addDetailStep.classList.add('hidden'); elements.searchResults.classList.remove('hidden'); elements.modalInput.parentElement.classList.remove('hidden'); });
  $('#addRating')?.addEventListener('click', (event) => { if (!event.target.dataset.rating) return; const rating = Number(event.target.dataset.rating); $('#addRating').dataset.value = rating; $('#addRating').innerHTML = renderStars(rating, true); });
  $('#addStatus')?.addEventListener('change', (event) => { if (event.target.value === 'Watched') $('#addEpisode').value = item.totalEpisodes || item.episodes || 1; });
  $('#commitAnime')?.addEventListener('click', async () => {
    const record = normalize({ ...item, id: state.editingId || crypto.randomUUID(), status: $('#addStatus').value, currentEpisode: Number($('#addEpisode').value) || 0, totalEpisodes: item.totalEpisodes || item.episodes || 1, rating: Number($('#addRating').dataset.value) || 0, vip: $('#addVip').checked, rewatch: $('#addRewatch').checked, notes: $('#addNotes').value.trim() });
    if (record.status === 'Watched') record.currentEpisode = record.totalEpisodes;
    record.currentEpisode = Math.min(record.totalEpisodes, Math.max(0, record.currentEpisode));
    const index = state.anime.findIndex((existing) => existing.id === record.id);
    if (index >= 0) state.anime[index] = { ...state.anime[index], ...record, episodeNotes: state.anime[index].episodeNotes || {} };
    else state.anime.unshift(record);
    await persist();
    closeAddModal();
    renderLibrary();
    showView(elements.libraryView);
  });
}

function closeAddModal() { elements.modal.classList.add('hidden'); elements.modal.setAttribute('aria-hidden', 'true'); state.editingId = null; }

function bindEvents() {
  $('#brandBtn').addEventListener('click', () => { showView(elements.libraryView); renderLibrary(); });
  $('#discoverBtn').addEventListener('click', openDiscovery);
  $('#discoveryBackBtn').addEventListener('click', () => { showView(elements.libraryView); renderLibrary(); });
  $('#refreshDiscoveryBtn').addEventListener('click', fetchDiscovery);
  $('#newAnimeBtn').addEventListener('click', () => { state.editingId = null; elements.modal.classList.remove('hidden'); elements.modalInput.value = ''; elements.searchResults.innerHTML = ''; elements.searchResults.classList.remove('hidden'); elements.addDetailStep.classList.add('hidden'); elements.modalInput.parentElement.classList.remove('hidden'); elements.searchStatus.textContent = 'Results appear after 750ms. Press Enter to search now.'; elements.modalInput.focus(); });
  $('#closeModalBtn').addEventListener('click', closeAddModal);
  document.querySelector('[data-close="true"]').addEventListener('click', closeAddModal);
  $('#backToLibraryBtn').addEventListener('click', () => { showView(elements.libraryView); renderLibrary(); });
  $('#backToAnimeBtn').addEventListener('click', () => { if (state.selectedAnime) renderAnimeDetail(state.selectedAnime); else { showView(elements.libraryView); renderLibrary(); } });
  $('#globalSearch').addEventListener('input', (event) => { state.query = event.target.value; renderLibrary(); });
  elements.statusTabs.addEventListener('click', (event) => { if (event.target.dataset.status) { state.filter = event.target.dataset.status; renderLibrary(); } });
  elements.animeList.addEventListener('click', async (event) => { const open = event.target.closest('[data-open-anime]'); const edit = event.target.closest('[data-edit-anime]'); const remove = event.target.closest('[data-remove-anime]'); if (open) renderAnimeDetail(state.anime.find((item) => String(item.id) === open.dataset.openAnime)); if (edit) openEditForm(state.anime.find((item) => String(item.id) === edit.dataset.editAnime)); if (remove) { const item = state.anime.find((anime) => String(anime.id) === remove.dataset.removeAnime); if (!item || !window.confirm(`Remove ${item.title} from your archive?`)) return; state.anime = state.anime.filter((anime) => anime.id !== item.id); if (supabaseClient) await supabaseClient.from('anime_library').delete().eq('id', item.id); await persist(); renderLibrary(); } });
  elements.modalInput.addEventListener('input', (event) => { clearTimeout(state.searchTimer); elements.searchStatus.textContent = 'Searching in 750ms...'; state.searchTimer = setTimeout(() => searchAnime(event.target.value), SEARCH_DELAY); });
  elements.modalInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); clearTimeout(state.searchTimer); searchAnime(event.target.value); } });
  elements.searchResults.addEventListener('click', (event) => { const button = event.target.closest('[data-result-id]'); if (!button) return; const item = state.searchResults.find((result) => String(result.id) === button.dataset.resultId); elements.searchResults.classList.add('hidden'); elements.addDetailStep.classList.remove('hidden'); elements.modalInput.parentElement.classList.add('hidden'); elements.addDetailStep.innerHTML = makeAddForm(item); bindAddForm(item); });
  elements.discoveryList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-discover-id]');
    if (!button) return;
    const result = state.discoveryResults.find((item) => String(item.id) === button.dataset.discoverId);
    if (result) openAddModalFromDiscovery(result);
  });
}

loadAnime().then(() => { bindEvents(); renderLibrary(); });
