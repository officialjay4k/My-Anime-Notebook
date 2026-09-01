const STORAGE_KEY = 'void-anime-notebook';
const PLANNING_KEY = 'void-anime-planning';
const PROFILE_KEY = 'void-anime-profile';
const CONNECTIONS_KEY = 'void-anime-connections';
const PROFILES = { jordan: { name: 'Jordan', label: 'me' }, ayden: { name: 'Ayden', label: 'friend' } };
const JIKAN_URL = 'https://api.jikan.moe/v4';
const ANILIST_URL = 'https://graphql.anilist.co';
const EPISODE_API_URL = 'https://kitsu.io/api/edge';
const SEARCH_DELAY = 750;
const ANIME_GOAL = 500;
const SUPABASE_URL = window.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || '';
const supabaseClient = window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const state = {
  profile: localStorage.getItem(PROFILE_KEY) || 'jordan',
  anime: [],
  filter: 'All',
  query: '',
  sort: 'recent',
  searchResults: [],
  discoveryResults: [],
  selectedAnime: null,
  selectedEpisode: null,
  searchTimer: null,
  searchController: null,
  episodeController: null,
  editingId: null,
  modalReturnFocus: null,
  historyExpanded: {},
  searchGenre: '',
  searchType: '',
  searchStatus: '',
  searchSort: 'popularity',
  plans: [], deferred: [], milestones: [500, 1000], activity: []
};
const episodeCache = new Map();

const $ = (selector) => document.querySelector(selector);
const elements = {
  dashboardView: $('#dashboardView'),
  plannerView: $('#plannerView'),
  calendarView: $('#calendarView'),
  libraryView: $('#libraryView'),
  discoveryView: $('#discoveryView'),
  animeView: $('#animeView'),
  episodeView: $('#episodeView'),
  connectionsView: $('#connectionsView'),
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
  discoveryStatus: $('#discoveryStatus'),
  searchView: $('#searchView'),
  fullSearchInput: $('#fullSearchInput'),
  executeSearchBtn: $('#executeSearchBtn'),
  fullSearchList: $('#fullSearchList'),
  fullSearchStatus: $('#fullSearchStatus'),
  genreFilter: $('#genreFilter'),
  typeFilter: $('#typeFilter'),
  statusFilter: $('#statusFilter'),
  sortFilter: $('#sortFilter'),
  searchBackBtn: $('#searchBackBtn'),
  dashboardContent: $('#dashboardContent'), plannerContent: $('#plannerContent'), calendarContent: $('#calendarContent'), connectionsContent: $('#connectionsContent'), profileSelect: $('#profileSelect')
};

function profileStorageKey(key) { return `${key}-${state.profile}`; }
function currentProfile() { return PROFILES[state.profile] || PROFILES.jordan; }
function readConnections() {
  try { return JSON.parse(localStorage.getItem(CONNECTIONS_KEY) || '{}'); } catch { return {}; }
}
function saveConnections(connections) { localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(connections)); }
function weekActivity(profile) {
  const connections = readConnections();
  const week = connections.competition?.weekKey === getWeekKey() ? connections.competition : null;
  return week ? Number(week.scores?.[profile] || 0) : 0;
}

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

function getTitleVariants(item) {
  return [item.title, item.title_english, item.title?.english, item.title?.romaji, item.title?.native].filter((value) => typeof value === 'string').map((value) => value.toLowerCase());
}

function getCover(item) {
  return item.cover || item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || item.coverImage?.large || item.coverImage?.medium || '';
}

function parseRuntime(value) {
  if (typeof value === 'number') return value;
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) : 0;
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
    totalMinutes: parseRuntime(item.totalMinutes ?? item.duration) || 24,
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

function getWeekKey(date = new Date()) {
  const day = new Date(date);
  const offset = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - offset);
  return day.toISOString().slice(0, 10);
}

function getPlan(weekKey = getWeekKey()) {
  return state.plans.find((plan) => plan.weekKey === weekKey);
}

function savePlanning() {
  localStorage.setItem(profileStorageKey(PLANNING_KEY), JSON.stringify({ plans: state.plans, deferred: state.deferred, milestones: state.milestones, activity: state.activity }));
}

function loadPlanning() {
  try {
    const saved = JSON.parse(localStorage.getItem(profileStorageKey(PLANNING_KEY)) || '{}');
    state.plans = Array.isArray(saved.plans) ? saved.plans : [];
    state.deferred = Array.isArray(saved.deferred) ? saved.deferred : [];
    state.milestones = Array.isArray(saved.milestones) && saved.milestones.length ? saved.milestones : [500, 1000];
    state.activity = Array.isArray(saved.activity) ? saved.activity : [];
  } catch { state.plans = []; state.deferred = []; state.milestones = [500, 1000]; state.activity = []; }
  archiveMissedPlans();
}

function archiveMissedPlans() {
  const currentWeek = getWeekKey();
  state.plans.forEach((plan) => {
    if (plan.weekKey >= currentWeek || plan.completed || plan.status === 'deferred') return;
    plan.status = 'deferred';
    plan.animeIds.forEach((id) => {
      const anime = titleById(id);
      if (anime?.status !== 'Watched' && !state.deferred.includes(id)) state.deferred.push(id);
    });
  });
}

function exportBackup() {
  const payload = { version: 1, exportedAt: new Date().toISOString(), anime: state.anime, plans: state.plans, deferred: state.deferred, milestones: state.milestones, activity: state.activity };
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  link.download = `anime-notebook-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const backup = JSON.parse(reader.result);
      if (!Array.isArray(backup.anime)) throw new Error('Invalid backup');
      const existing = new Map(state.anime.map((item) => [String(item.id), item]));
      backup.anime.map(normalize).forEach((item) => existing.set(String(item.id), item));
      state.anime = [...existing.values()];
      state.plans = Array.isArray(backup.plans) ? backup.plans : state.plans;
      state.deferred = Array.isArray(backup.deferred) ? backup.deferred : state.deferred;
      state.milestones = Array.isArray(backup.milestones) && backup.milestones.length ? backup.milestones : state.milestones;
      state.activity = Array.isArray(backup.activity) ? backup.activity : state.activity;
      localStorage.setItem(profileStorageKey(STORAGE_KEY), JSON.stringify(state.anime));
      if (state.profile === 'jordan') localStorage.setItem(STORAGE_KEY, JSON.stringify(state.anime));
      savePlanning();
      setDatabaseStatus('Backup restored');
      renderDashboard(); renderLibrary(); renderPlanner(); renderCalendar();
    } catch { setDatabaseStatus('Backup invalid'); }
  };
  reader.readAsText(file);
}

function planProgress(plan) {
  const completed = (plan?.animeIds || []).filter((id) => state.anime.find((item) => String(item.id) === String(id))?.status === 'Watched').length;
  return { completed, target: Math.max(1, Number(plan?.target) || 1), percent: Math.min(100, completed / Math.max(1, Number(plan?.target) || 1) * 100) };
}

function refreshPlanCompletion() {
  state.plans.forEach((plan) => { plan.completed = planProgress(plan).completed >= planProgress(plan).target; });
  savePlanning();
}

function titleById(id) { return state.anime.find((item) => String(item.id) === String(id)); }

function renderDashboard() {
  const plan = getPlan();
  const progress = planProgress(plan);
  const watched = state.anime.filter((item) => item.status === 'Watched').length;
  const watchedHours = state.anime.reduce((total, item) => total + (item.status === 'Watched' ? getWatchHours(item) : item.currentEpisode / (item.totalEpisodes || 1) * getWatchHours(item)), 0);
  const watching = state.anime.filter((item) => item.status === 'Watching');
  const nextMilestone = state.milestones.find((milestone) => milestone > watched) || watched;
  const completedWeeks = state.plans.filter((item) => item.completed).length;
  elements.dashboardContent.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Personal command center</p><h1>Your Watch Orbit</h1><p class="muted">A calm view of your weekly momentum and the long journey ahead.</p></div><div class="heading-actions"><button class="primary-btn" data-view="plannerView" type="button">Plan this week</button></div></div><div class="backup-tools glass-panel"><div><p class="eyebrow">Data safety</p><strong>Protect your archive</strong><p class="muted">Export saves your anime, plans, streak history, and deferred list. Import merges a backup by title ID.</p></div><div class="backup-actions"><button class="ghost-btn" data-export-backup type="button">Export backup</button><button class="ghost-btn" data-import-backup type="button">Import backup</button><input id="backupFile" class="hidden" type="file" accept="application/json" /></div></div><div class="dashboard-grid"><article class="dashboard-hero glass-panel"><p class="eyebrow">This week's mission</p><h2>${plan ? `${progress.completed} of ${progress.target} anime finished` : 'No mission planned yet'}</h2><p class="muted">${plan ? 'Finish your selected titles to protect the streak.' : 'Choose a few titles and give the week a shape.'}</p><div class="mission-track"><span style="width:${progress.percent}%"></span></div><strong>${Math.round(progress.percent)}% complete</strong></article><article class="stat-panel"><span>Current streak</span><strong>${currentStreak()} weeks</strong><small>${completedWeeks} completed weeks</small></article><article class="stat-panel"><span>Archive progress</span><strong>${watched.toLocaleString()}</strong><small>Next milestone: ${nextMilestone.toLocaleString()}</small></article><article class="stat-panel"><span>Time in orbit</span><strong>${formatHours(watchedHours)}</strong><small>Estimated from episode runtimes</small></article></div><section class="dashboard-section"><div class="section-title"><h2>Continue watching</h2><span>${watching.length} active</span></div><div class="continue-list">${watching.length ? watching.slice(0, 6).map((item) => `<button class="continue-item" data-open-anime="${item.id}" type="button"><img src="${escapeHtml(item.cover)}" alt="" /><span><strong>${escapeHtml(item.title)}</strong><small>Episode ${item.currentEpisode} of ${item.totalEpisodes} · ${formatHours(getWatchHours(item))} total</small></span></button>`).join('') : '<div class="empty-state"><strong>Your orbit is quiet</strong><span>Add a title to start watching.</span></div>'}</div></section><section class="dashboard-section dashboard-columns"><div><div class="section-title"><h2>Backup list</h2><span>${state.deferred.length} deferred</span></div><p class="muted">Titles here are waiting for a future weekly plan, never forgotten.</p></div><div><div class="section-title"><h2>Milestones</h2><span>${state.milestones.join(' · ')}</span></div><label class="milestone-add"><input id="milestoneInput" type="number" min="1" placeholder="Add target" /><button class="ghost-btn" data-add-milestone type="button">Add</button></label></div></section><section class="dashboard-section"><div class="section-title"><h2>Recent activity</h2><span>${state.activity.length} logged episodes</span></div><div class="activity-list">${state.activity.slice(0, 5).map((entry) => `<div><strong>${escapeHtml(titleById(entry.animeId)?.title || 'Unknown title')}</strong><span>Episode ${entry.episode} · ${new Date(entry.date).toLocaleDateString()}</span></div>`).join('') || '<p class="muted">Your manual episode updates will appear here.</p>'}</div></section>`;
}

function currentStreak() {
  let streak = 0;
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
  while (state.plans.some((plan) => plan.weekKey === getWeekKey(cursor) && plan.completed)) { streak += 1; cursor.setDate(cursor.getDate() - 7); }
  return streak;
}

function renderPlanner() {
  const weekKey = getWeekKey();
  const plan = getPlan(weekKey) || { weekKey, target: 1, animeIds: [] };
  const selectable = state.anime.filter((item) => item.status !== 'Watched');
  elements.plannerContent.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Weekly ritual · ${weekKey}</p><h1>Shape the Week</h1><p class="muted">Pick the anime you want to finish, then let your progress tell the story.</p></div><button class="primary-btn" data-save-plan type="button">Save weekly plan</button></div><div class="planner-layout"><article class="planner-form glass-panel"><label class="field">Anime to finish this week<select id="weeklyTarget"><option value="1" ${plan.target === 1 ? 'selected' : ''}>1 anime</option><option value="2" ${plan.target === 2 ? 'selected' : ''}>2 anime</option><option value="3" ${plan.target === 3 ? 'selected' : ''}>3 anime</option></select></label><div class="planner-options">${selectable.length ? selectable.map((item) => `<label class="plan-option"><input type="checkbox" data-plan-anime value="${item.id}" ${plan.animeIds.includes(item.id) ? 'checked' : ''} /><img src="${escapeHtml(item.cover)}" alt="" /><span><strong>${escapeHtml(item.title)}</strong><small>${item.currentEpisode}/${item.totalEpisodes} episodes</small></span></label>`).join('') : '<div class="empty-state">Add some unfinished anime before planning a week.</div>'}</div></article><aside class="backup-panel glass-panel"><p class="eyebrow">Backup orbit</p><h2>${state.deferred.length} deferred titles</h2><p class="muted">Swap these back into a future week whenever the timing feels right.</p><div class="backup-list">${state.deferred.length ? state.deferred.map((id) => `<div>${escapeHtml(titleById(id)?.title || 'Unknown title')}<button data-restore-deferred="${id}" type="button">Restore</button></div>`).join('') : '<span class="muted">Nothing waiting.</span>'}</div></aside></div>`;
  plan.animeIds.forEach((id) => { if (!state.anime.some((item) => item.id === id)) plan.animeIds = plan.animeIds.filter((savedId) => savedId !== id); });
}

function formatHistoryDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function getHistoryGroups() {
  const grouped = new Map();

  [...state.activity]
    .filter((entry) => entry && entry.animeId && entry.date)
    .sort((first, second) => new Date(second.date) - new Date(first.date))
    .forEach((entry) => {
      const id = String(entry.animeId);
      const title = entry.title || titleById(id)?.title || 'Unknown title';
      if (!grouped.has(id)) {
        grouped.set(id, { id, title, entries: [] });
      }
      grouped.get(id).entries.push({
        episode: Number(entry.episode) || 1,
        date: entry.date,
        dateLabel: formatHistoryDate(entry.date)
      });
    });

  return [...grouped.values()].map((group) => ({
    ...group,
    entries: group.entries.slice(0, 6)
  }));
}

function renderCalendar() {
  const weekKey = getWeekKey();
  const plan = getPlan(weekKey) || { weekKey, animeIds: [] };
  const plannedAnime = (plan.animeIds || []).map((id) => titleById(id)).filter(Boolean);
  const history = getHistoryGroups();

  elements.calendarContent.innerHTML = `<div class="page-heading"><div><p class="eyebrow">Consistency archive</p><h1>Orbit History</h1><p class="muted">This week’s watchlist and your recent viewing timeline.</p></div></div><div class="streak-summary glass-panel"><strong>${currentStreak()} week current streak</strong><span>${state.plans.filter((item) => item.completed).length} completed weeks · ${plannedAnime.length} planned titles this week</span></div><div class="calendar-grid"><article class="month-panel"><h2>This week</h2><div class="month-weeks">${plannedAnime.length ? plannedAnime.map((item) => `<div class="calendar-week complete"><span>${weekKey}</span><strong>${escapeHtml(item.title)}</strong><small>${item.currentEpisode}/${item.totalEpisodes} episodes watched</small></div>`).join('') : '<span class="muted">No anime planned for this week.</span>'}</div></article><article class="month-panel"><h2>Watch history</h2><div class="month-weeks">${history.length ? history.map((group) => {
    const expanded = Boolean(state.historyExpanded[group.id]);
    const visibleEntries = expanded ? group.entries : group.entries.slice(0, 3);
    const hiddenCount = Math.max(0, group.entries.length - visibleEntries.length);
    return `<div class="calendar-week active history-group"><span>${group.entries.length} log${group.entries.length === 1 ? '' : 's'}</span><strong>${escapeHtml(group.title)}</strong><div class="history-episode-list">${visibleEntries.map((entry) => `<small>Ep ${entry.episode} · ${escapeHtml(entry.dateLabel)}</small>`).join('')}${hiddenCount > 0 ? `<button class="history-toggle" data-history-toggle="${escapeHtml(group.id)}" type="button">${expanded ? 'Show less' : `Show all (${hiddenCount})`}</button>` : ''}${expanded && group.entries.length > visibleEntries.length ? '<button class="history-toggle" data-history-toggle="' + escapeHtml(group.id) + '" type="button">Show less</button>' : ''}</div></div>`;
  }).join('') : '<span class="muted">No watch history yet.</span>'}</div></article></div>`;
}

function renderConnections() {
  const connections = readConnections();
  const competition = connections.competition?.weekKey === getWeekKey() ? connections.competition : null;
  const jordanLibrary = (connections.jordanLibrary || []).map(normalize);
  const opponent = state.profile === 'jordan' ? 'ayden' : 'jordan';
  const myScore = competition ? Number(competition.scores?.[state.profile] || 0) : 0;
  const theirScore = competition ? Number(competition.scores?.[opponent] || 0) : 0;
  const available = jordanLibrary.filter((item) => !state.anime.some((owned) => String(owned.id) === String(item.id)));
  elements.connectionsContent.innerHTML = `<div class="page-heading">
      <div><p class="eyebrow">Jordan + Ayden</p><h1>Connection Deck</h1><p class="muted">Share recommendations and keep a friendly weekly score.</p></div>
      <button class="primary-btn" id="viewAllConnectionsBtn" type="button">View all shared anime</button>
    </div>
    <div class="connection-grid">
      <article class="connection-panel glass-panel">
        <p class="eyebrow">Weekly competition · ${getWeekKey()}</p><h2>${competition ? 'The race is live' : 'Start the weekly race'}</h2>
        <p class="muted">Both profiles can add episodes. Every completed episode counts once the race starts.</p>
        <div class="scoreboard"><div><span>Jordan</span><strong>${competition ? competition.scores.jordan || 0 : '—'}</strong></div><div><span>Ayden</span><strong>${competition ? competition.scores.ayden || 0 : '—'}</strong></div></div>
        ${competition ? `<p class="connection-result">${myScore === theirScore ? 'Tied up.' : myScore > theirScore ? `You are ahead by ${myScore - theirScore}.` : `${opponent === 'jordan' ? 'Jordan' : 'Ayden'} is ahead by ${theirScore - myScore}.`}</p>` : `<button class="primary-btn" data-start-competition type="button">Start this week's competition</button>`}
      </article>
      <article class="connection-panel glass-panel">
        <p class="eyebrow">Jordan's saved orbit</p><h2>${available.length} titles to borrow</h2>
        <p class="muted">${state.profile === 'jordan' ? 'Your friend will see your saved titles here when they switch profiles.' : 'Add one of Jordan\'s saved anime to your own library.'}</p>
        <div class="shared-list">${available.length ? available.slice(0, 8).map((item) => `<div class="shared-item"><img src="${escapeHtml(item.cover)}" alt="" /><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.status)}</small></span>${state.profile === 'ayden' ? `<button class="ghost-btn" data-borrow-anime="${item.id}" type="button">Add to mine</button>` : ''}</div>`).join('') : '<span class="muted">No new shared titles yet.</span>'}</div>
      </article>
    </div>
    <div class="connection-note glass-panel"><strong>Shared signal</strong><span>Switch profiles any time. Your library, plans, notes, and goals travel with the selected name.</span></div>`;
  $('#viewAllConnectionsBtn')?.addEventListener('click', () => {
    // Navigate to a new sub-view? Or list all right here?
    // Let's go with showing them all in the existing list.
    const container = $('.connection-grid');
    container.innerHTML = `
      <div class="shared-list-full">
        ${jordanLibrary.map(item => `
          <div class="shared-item">
            <img src="${escapeHtml(item.cover)}" alt="" />
            <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.status)}</small></span>
            ${state.profile === 'ayden' ? `<button class="ghost-btn" data-borrow-anime="${item.id}" type="button">Add</button>` : ''}
          </div>
        `).join('')}
      </div>
    `;
    $('#viewAllConnectionsBtn').remove();
  });
}

async function loadAnime() {
  let localAnime = [];
  try { localAnime = JSON.parse(localStorage.getItem(profileStorageKey(STORAGE_KEY)) || (state.profile === 'jordan' ? localStorage.getItem(STORAGE_KEY) : '[]') || '[]').map(normalize); } catch { localAnime = []; }

  if (supabaseClient && state.profile === 'jordan') {
    let { data, error } = await supabaseClient.from('anime_library').select('id,title,cover,status,current_episode,total_episodes,rating,notes,episode_notes,vip,rewatch,updated_at').order('updated_at', { ascending: false });
    if (error && /vip|rewatch|column/i.test(error.message || '')) {
      ({ data, error } = await supabaseClient.from('anime_library').select('id,title,cover,status,current_episode,total_episodes,rating,notes,episode_notes,updated_at').order('updated_at', { ascending: false }));
    }
    if (!error && Array.isArray(data)) {
      const localById = new Map(localAnime.map((item) => [String(item.id), item]));
      state.anime = data.map((item) => {
        const remote = normalize(item);
        const local = localById.get(String(remote.id));
        return { ...remote, vip: Boolean(remote.vip || local?.vip), rewatch: Boolean(remote.rewatch || local?.rewatch) };
      });
      setDatabaseStatus('Supabase live');
      return;
    }
    setDatabaseStatus('Database setup needed');
  }

  try {
    state.anime = localAnime;
  } catch {
    state.anime = [];
  }
}

async function persist() {
  localStorage.setItem(profileStorageKey(STORAGE_KEY), JSON.stringify(state.anime));
  if (state.profile === 'jordan') localStorage.setItem(STORAGE_KEY, JSON.stringify(state.anime));
  if (state.profile === 'jordan') {
    const connections = readConnections();
    connections.jordanLibrary = state.anime;
    saveConnections(connections);
  }
  if (!supabaseClient || state.profile !== 'jordan') {
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
  [elements.dashboardView, elements.libraryView, elements.plannerView, elements.calendarView, elements.connectionsView, elements.discoveryView, elements.animeView, elements.episodeView, elements.searchView].forEach((item) => item?.classList.remove('active-view'));
  view?.classList.add('active-view');
  document.querySelectorAll('.nav-btn').forEach((item) => item.classList.toggle('active', item.dataset.view === view.id));
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
        query: 'query($page:Int){ Page(page:$page, perPage:12) { media(type:ANIME, sort:POPULARITY_DESC, isAdult:false, status_in:[FINISHED, RELEASING]) { id title { romaji english native } coverImage { large medium } episodes duration averageScore genres } } }',
        variables: { page: Math.floor(Math.random() * 40) + 1 }
      })
    });
    if (!response.ok) throw new Error('Discovery request failed');
    const data = await response.json();
    const ownedIds = new Set(state.anime.map((item) => String(item.id)));
    const ownedTitles = new Set(state.anime.flatMap(getTitleVariants));
    const results = (data.data?.Page?.media || []).map(normalize).filter((item) => !ownedIds.has(String(item.id)) && !getTitleVariants(item).some((title) => ownedTitles.has(title)));
    state.discoveryResults = results;
    elements.discoveryStatus.textContent = `${results.length} random titles found`;
    elements.discoveryList.innerHTML = results.map((item) => `<article class="discovery-card"><img src="${escapeHtml(item.cover)}" alt="${escapeHtml(item.title)}" /><div><h2>${escapeHtml(item.title)}</h2><p>${item.episodes || '?'} episodes${item.averageScore ? ` · ${item.averageScore}% score` : ''}${item.totalMinutes ? ` · ${formatHours(item.totalMinutes / 60)}` : ''}</p><button class="discover-add" data-discover-id="${item.id}" type="button">Add to notebook</button></div></article>`).join('');
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

function formatHours(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return '0m';
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function getWatchHours(item) {
  const duration = Number(item.totalMinutes || item.duration) || 24;
  return (Number(item.totalEpisodes) || 1) * duration / 60;
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
  elements.statusTabs.innerHTML = `${statuses.map((status) => `<button class="status-tab ${state.filter === status ? 'active' : ''}" data-status="${status}" type="button">${status}</button>`).join('')}<label class="sort-control">Sort<select id="librarySort"><option value="recent" ${state.sort === 'recent' ? 'selected' : ''}>Recently added</option><option value="title" ${state.sort === 'title' ? 'selected' : ''}>Title</option><option value="progress" ${state.sort === 'progress' ? 'selected' : ''}>Progress</option><option value="rating" ${state.sort === 'rating' ? 'selected' : ''}>Rating</option></select></label>`;
  const visible = state.anime.filter((item) => (state.filter === 'All' || item.status === state.filter) && `${item.title} ${item.notes}`.toLowerCase().includes(state.query.toLowerCase())).sort((first, second) => {
    if (state.sort === 'title') return first.title.localeCompare(second.title);
    if (state.sort === 'progress') return (second.currentEpisode / second.totalEpisodes) - (first.currentEpisode / first.totalEpisodes);
    if (state.sort === 'rating') return second.rating - first.rating;
    return 0;
  });
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
        ${isRateableStatus(item.status) ? `<div class="stars" aria-label="${item.rating} out of 10 stars">${renderStars(item.rating)}</div>` : ''}<p>${escapeHtml(item.notes || 'No notes yet.')}</p>
        <div class="progress"><span style="width:${progress}%"></span></div>
        <div class="card-meta"><span>${formatHours(getWatchHours(item))}</span><span>${formatHours(item.currentEpisode / total * getWatchHours(item))} watched</span></div><div class="card-actions ${item.status === 'Watched' ? 'compact' : ''}">${item.status !== 'Watched' ? `<button class="quick-episode-button" data-increment-anime="${item.id}" type="button">＋1 episode</button>` : ''}<button class="edit-card-button" data-edit-anime="${item.id}" type="button">Edit details</button><button class="remove-card-button" data-remove-anime="${item.id}" type="button">Remove</button></div>
      </div>
    </article>`;
  }).join('');
}

function isRateableStatus(status) {
  return status === 'Watched' || status === 'Dropped';
}

async function incrementEpisode(item) {
  if (!item || item.status === 'Watched') return;
  if (item.status === 'Dropped') item.status = 'Watching';

async function executeFullSearch(query = '') {
  const genre = elements.genreFilter?.value || '';
  const type = elements.typeFilter?.value || '';
  const status = elements.statusFilter?.value || '';
  const sort = elements.sortFilter?.value || 'popularity';
  
  state.searchGenre = genre;
  state.searchType = type;
  state.searchStatus = status;
  state.searchSort = sort;
  
  elements.fullSearchList.innerHTML = '<div class="empty-state">Searching the void...</div>';
  elements.fullSearchStatus.textContent = query ? `Searching for "${query}"...` : 'Fetching popular anime...';

  try {
    let url;
    
    if (query) {
      // Search by title
      url = `${JIKAN_URL}/anime?q=${encodeURIComponent(query)}&limit=24&sfw=true`;
      if (genre) url += `&genres=${genre}`;
      if (type) url += `&type=${type}`;
      if (status) url += `&status=${status}`;
      if (sort && sort !== 'popularity') url += `&order_by=${sort}&sort=desc`;
    } else {
      // Browse by filters (popular if no search)
      if (genre) {
        url = `${JIKAN_URL}/anime?genres=${genre}&limit=24&sfw=true&order_by=popularity&sort=desc`;
      } else if (sort === 'score') {
        url = `${JIKAN_URL}/top/anime?limit=24&type=${type || ''}`.replace('type=', type ? 'type=' : '');
      } else {
        url = `${JIKAN_URL}/top/anime?limit=24`;
      }
      if (type) url += url.includes('?') ? `&type=${type}` : `?type=${type}`;
      if (status) url += `&status=${status}`;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`API returned ${response.status}`);
    const data = await response.json();
    const results = (data.data || []).map(normalize).filter(item => item && item.title);
    
    renderSearchResults(results);
    elements.fullSearchStatus.textContent = results.length 
      ? (query ? `Found ${results.length} results for "${query}"` : `Showing ${results.length} anime`) 
      : (query ? 'No results found' : 'Loading...');
  } catch (err) {
    console.error('Search failed:', err);
    elements.fullSearchList.innerHTML = '<div class="empty-state"><strong>Search unavailable</strong><span>The anime database is temporarily unreachable. Try again in a moment.</span></div>';
    elements.fullSearchStatus.textContent = 'Error: Database unreachable';
  }
}

function renderSearchResults(results) {
  if (!results.length) {
    elements.fullSearchList.innerHTML = '<div class="empty-state">No matching anime found.</div>';
    return;
  }

  elements.fullSearchList.innerHTML = results.map((item) => {
    const isAdded = state.anime.some(a => String(a.mal_id) === String(item.mal_id) || String(a.id) === String(item.id));
    const hours = getWatchHours(item);
    
    return `<article class="anime-card">
      <div class="cover-button">
        <img src="${escapeHtml(item.cover)}" alt="${escapeHtml(item.title)}" />
        ${isAdded ? '<span class="already-added-badge">IN NOTEBOOK</span>' : ''}
        <span class="status-pill">${item.type || 'Anime'} · ${item.episodes || '?'} eps</span>
      </div>
      <div class="card-copy">
        <div class="card-title-row"><h2>${escapeHtml(item.title)}</h2></div>
        <p class="muted" style="font-size: 0.75rem; margin-bottom: 12px;">${formatHours(hours)} series duration</p>
        <button class="primary-btn" data-add-result="${item.id}" type="button" ${isAdded ? 'disabled' : ''}>
          ${isAdded ? 'Already Added' : 'Add to Notebook'}
        </button>
      </div>
    </article>`;
  }).join('');

  // Bind buttons
  elements.fullSearchList.querySelectorAll('[data-add-result]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.addResult;
      const item = results.find(r => String(r.id) === String(id));
      if (item) openAddModalFromSearch(item);
    });
  });
}

function openAddModalFromSearch(item) {
  state.editingId = null;
  elements.modal.classList.remove('hidden');
  elements.modal.setAttribute('aria-hidden', 'false');
  elements.modalInput.parentElement.classList.add('hidden');
  elements.searchResults.classList.add('hidden');
  elements.addDetailStep.classList.remove('hidden');
  elements.addDetailStep.innerHTML = makeAddForm(item);
  bindAddForm(item);
}

  item.currentEpisode = Math.min(item.totalEpisodes, item.currentEpisode + 1);
  state.activity.unshift({ animeId: item.id, title: item.title, episode: item.currentEpisode, date: new Date().toISOString() });
  state.activity = state.activity.slice(0, 5000);
  const completed = item.status === 'Watching' && item.currentEpisode >= item.totalEpisodes;
  if (completed) item.status = 'Watched';
  await persist();
  refreshPlanCompletion();
  renderLibrary();
  renderDashboard();
  renderCalendar();
  if (completed) openCompletionForm(item);
}

function openCompletionForm(item) {
  state.editingId = item.id;
  openAddModal(item);
  elements.addDetailStep.querySelector('.add-detail')?.insertAdjacentHTML('afterbegin', '<p class="completion-message">You reached the final episode. Add your rating and closing notes.</p>');
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
      const response = await fetch(ANILIST_URL, { method: 'POST', signal: state.searchController.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'query($search:String){Page(page:1,perPage:8){media(search:$search,type:ANIME,isAdult:false){id title{romaji english native} coverImage{large medium} episodes duration}}}', variables: { search: value } }) });
      const data = await response.json();
      state.searchResults = (data.data?.Page?.media || []).map(normalize);
    } catch { state.searchResults = []; }
  }
  elements.searchStatus.textContent = `${state.searchResults.length} result${state.searchResults.length === 1 ? '' : 's'}`;
  elements.searchResults.innerHTML = state.searchResults.length ? state.searchResults.map((item) => `<button class="search-result" data-result-id="${item.id}" type="button"><img src="${escapeHtml(item.cover)}" alt="" /><span><strong>${escapeHtml(item.title)}</strong><small>${item.episodes} episodes · ${item.type || 'Anime'}</small></span></button>`).join('') : '<div class="empty-state">No matching anime found.</div>';
}

function makeAddForm(item) {
  return `<div class="add-detail"><button class="back-link" data-add-back type="button">← Change anime</button><div class="selected-preview"><img src="${escapeHtml(item.cover)}" alt="" /><div><p class="eyebrow">Selected title</p><h2>${escapeHtml(item.title)}</h2></div></div><div class="form-grid"><label class="field">Status<select id="addStatus"><option>Watching</option><option>Watched</option><option>Dropped</option><option>Plan to Watch</option></select></label><label class="field">On episode<input id="addEpisode" type="number" min="0" value="0" /></label><label id="addRatingField" class="field rating-field">Rating<div id="addRating" class="star-rating rating-disabled" aria-disabled="true">${renderStars(0, true)}</div><small id="ratingHint" class="rating-hint">Available when watched or dropped</small></label><label class="vip-toggle full"><input id="addVip" type="checkbox" /> Mark as VIP anime</label><label class="vip-toggle full"><input id="addRewatch" type="checkbox" /> Mark for Rewatch</label><label class="field full">Notes<textarea id="addNotes" rows="3" placeholder="Write a note about this anime..."></textarea></label></div><button id="commitAnime" class="primary-btn wide" type="button">Commit to Library</button></div>`;
}

function updateRatingAvailability() {
  const rating = $('#addRating');
  const status = $('#addStatus')?.value;
  if (!rating || !status) return;
  const enabled = status === 'Watched' || status === 'Dropped';
  $('#addRatingField')?.classList.toggle('hidden', !enabled);
  rating.classList.toggle('rating-disabled', !enabled);
  rating.setAttribute('aria-disabled', String(!enabled));
  const hint = $('#ratingHint');
  if (hint) hint.textContent = enabled ? 'Select up to 10 stars' : 'Available when watched or dropped';
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
    elements.animeDetail.innerHTML = `<div class="anime-hero"><img class="hero-poster" src="${escapeHtml(item.cover)}" alt="${escapeHtml(item.title)}" /><div class="hero-copy"><div class="hero-title-row"><span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span>${item.vip ? '<span class="vip-badge inline">VIP</span>' : ''}${item.rewatch ? '<span class="rewatch-badge inline">REWATCH</span>' : ''}</div><h1>${escapeHtml(item.title)}</h1><p class="muted">${item.totalEpisodes || item.episodes || '?'} episodes · ${formatHours(getWatchHours(item))} total · ${formatHours(item.currentEpisode / (item.totalEpisodes || 1) * getWatchHours(item))} watched</p><p>${escapeHtml(item.notes || 'No notes yet.')}</p>${isRateableStatus(item.status) ? `<div class="stars large" aria-label="${item.rating} out of 10 stars">${renderStars(item.rating)}</div>` : ''}<div class="hero-controls"><label>On episode<input id="heroEpisode" type="number" min="0" max="${item.totalEpisodes}" value="${item.currentEpisode}" /></label><button id="editAnimeButton" class="ghost-btn" type="button">Edit details</button><button id="openChronicles" class="primary-btn" type="button">Open episode chronicles</button></div></div></div><section class="chronicle-preview"><div class="section-title"><h2>Chronological Logs</h2><span id="episodeLoading">Loading episodes...</span></div><div id="heroEpisodes" class="episode-list"><div class="episode-loading">Fetching episode list and previews...</div></div></section>`;
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
  $('#addRating')?.addEventListener('click', (event) => { if ($('#addRating').classList.contains('rating-disabled')) return; if (!event.target.dataset.rating) return; const rating = Number(event.target.dataset.rating); $('#addRating').dataset.value = rating; $('#addRating').innerHTML = renderStars(rating, true); });
  $('#addStatus')?.addEventListener('change', (event) => { if (event.target.value === 'Watched') $('#addEpisode').value = item.totalEpisodes || item.episodes || 1; if (event.target.value !== 'Watched' && event.target.value !== 'Dropped') { $('#addRating').dataset.value = '0'; $('#addRating').innerHTML = renderStars(0, true); } updateRatingAvailability(); });
  updateRatingAvailability();
  $('#commitAnime')?.addEventListener('click', async () => {
    const status = $('#addStatus').value;
    const record = normalize({ ...item, id: state.editingId || crypto.randomUUID(), status, currentEpisode: Number($('#addEpisode').value) || 0, totalEpisodes: item.totalEpisodes || item.episodes || 1, rating: isRateableStatus(status) ? Number($('#addRating').dataset.value) || 0 : 0, vip: $('#addVip').checked, rewatch: $('#addRewatch').checked, notes: $('#addNotes').value.trim() });
    if (record.status === 'Watched') record.currentEpisode = record.totalEpisodes;
    record.currentEpisode = Math.min(record.totalEpisodes, Math.max(0, record.currentEpisode));
    const index = state.anime.findIndex((existing) => existing.id === record.id);
    if (index >= 0) state.anime[index] = { ...state.anime[index], ...record, episodeNotes: state.anime[index].episodeNotes || {} };
    else state.anime.unshift(record);
    if (record.status === 'Watched' || record.currentEpisode > 0) {
      state.activity.unshift({ animeId: record.id, title: record.title, episode: record.currentEpisode, date: new Date().toISOString() });
      state.activity = state.activity.slice(0, 5000);
    }
    await persist();
    refreshPlanCompletion();
    if (!elements.modal.classList.contains('hidden')) closeAddModal();
    if (!elements.searchView.classList.contains('hidden')) {
      showView(elements.libraryView);
    }
    renderLibrary();
    renderDashboard();
    renderCalendar();
    showView(elements.libraryView);
  });
}

function closeAddModal() { elements.modal.classList.add('hidden'); elements.modal.setAttribute('aria-hidden', 'true'); state.editingId = null; state.modalReturnFocus?.focus(); state.modalReturnFocus = null; }

function bindEvents() {
  document.querySelector('.site-nav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    const view = document.getElementById(button.dataset.view);
    if (!view) return;
    document.querySelectorAll('.nav-btn').forEach((item) => item.classList.toggle('active', item === button));
    showView(view);
    if (view === elements.dashboardView) renderDashboard();
    if (view === elements.plannerView) renderPlanner();
    if (view === elements.calendarView) renderCalendar();
    if (view === elements.libraryView) renderLibrary();
    if (view === elements.connectionsView) renderConnections();
  });
  elements.calendarContent.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-history-toggle]');
    if (!toggle) return;
    const id = String(toggle.dataset.historyToggle);
    state.historyExpanded[id] = !state.historyExpanded[id];
    renderCalendar();
  });
  elements.dashboardContent.addEventListener('click', (event) => { const button = event.target.closest('[data-open-anime]'); const viewButton = event.target.closest('[data-view]'); if (button) renderAnimeDetail(titleById(button.dataset.openAnime)); if (viewButton) document.querySelector(`.nav-btn[data-view="${viewButton.dataset.view}"]`)?.click(); });
  elements.dashboardContent.addEventListener('click', (event) => { if (event.target.closest('[data-export-backup]')) exportBackup(); if (event.target.closest('[data-import-backup]')) $('#backupFile').click(); if (event.target.closest('[data-add-milestone]')) { const value = Number($('#milestoneInput').value); if (value > 0 && !state.milestones.includes(value)) { state.milestones.push(value); state.milestones.sort((first, second) => first - second); savePlanning(); renderDashboard(); } } });
  elements.dashboardContent.addEventListener('change', (event) => { if (event.target.id === 'backupFile' && event.target.files[0]) importBackup(event.target.files[0]); });
  elements.plannerContent.addEventListener('click', (event) => {
    const save = event.target.closest('[data-save-plan]');
    const restore = event.target.closest('[data-restore-deferred]');
    if (restore) { state.deferred = state.deferred.filter((id) => String(id) !== restore.dataset.restoreDeferred); savePlanning(); renderPlanner(); return; }
    if (save) {
  
  // New Search View Bindings
  elements.executeSearchBtn.addEventListener('click', () => executeFullSearch(elements.fullSearchInput.value));
  elements.fullSearchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') executeFullSearch(elements.fullSearchInput.value); });
  [elements.genreFilter, elements.typeFilter, elements.statusFilter, elements.sortFilter].forEach(el => {
    el.addEventListener('change', () => executeFullSearch(elements.fullSearchInput.value));
  });
  elements.searchBackBtn.addEventListener('click', () => showView(elements.libraryView));
  
  // Update "Add Anime" button to open this view instead of modal
  document.getElementById('newAnimeBtn').addEventListener('click', () => {
    console.log('Search button clicked'); showView(elements.searchView);
    executeFullSearch(); // Load initial popular list
  });

      const weekKey = getWeekKey();
      const plan = getPlan(weekKey) || { weekKey, animeIds: [] };
      plan.target = Number($('#weeklyTarget').value) || 1;
      plan.animeIds = [...document.querySelectorAll('[data-plan-anime]:checked')].map((input) => input.value);
      plan.completed = planProgress(plan).completed >= plan.target;
      if (!getPlan(weekKey)) state.plans.push(plan);
      savePlanning();
      save.textContent = 'Plan saved';
      renderDashboard();
    }
  });
  $('#brandBtn').addEventListener('click', () => { showView(elements.libraryView); renderLibrary(); });
  $('#discoverBtn').addEventListener('click', openDiscovery);
  $('#discoveryBackBtn').addEventListener('click', () => { showView(elements.libraryView); renderLibrary(); });
  $('#refreshDiscoveryBtn').addEventListener('click', fetchDiscovery);
  if (elements.executeSearchBtn) elements.executeSearchBtn.addEventListener('click', function() { executeFullSearch(elements.fullSearchInput ? elements.fullSearchInput.value : ''); });
  if (elements.fullSearchInput) elements.fullSearchInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') executeFullSearch(elements.fullSearchInput.value); });
  if (elements.genreFilter) elements.genreFilter.addEventListener('change', function() { executeFullSearch(elements.fullSearchInput ? elements.fullSearchInput.value : ''); });
  if (elements.typeFilter) elements.typeFilter.addEventListener('change', function() { executeFullSearch(elements.fullSearchInput ? elements.fullSearchInput.value : ''); });
  if (elements.statusFilter) elements.statusFilter.addEventListener('change', function() { executeFullSearch(elements.fullSearchInput ? elements.fullSearchInput.value : ''); });
  if (elements.sortFilter) elements.sortFilter.addEventListener('change', function() { executeFullSearch(elements.fullSearchInput ? elements.fullSearchInput.value : ''); });
  if (elements.searchBackBtn) elements.searchBackBtn.addEventListener('click', function() { showView(elements.libraryView); });
  document.getElementById('newAnimeBtn').addEventListener('click', function() { showView(elements.searchView); executeFullSearch(''); });

  $('#closeModalBtn').addEventListener('click', closeAddModal);
  document.querySelector('[data-close="true"]').addEventListener('click', closeAddModal);
  $('#backToLibraryBtn').addEventListener('click', () => { showView(elements.libraryView); renderLibrary(); });
  $('#backToAnimeBtn').addEventListener('click', () => { if (state.selectedAnime) renderAnimeDetail(state.selectedAnime); else { showView(elements.libraryView); renderLibrary(); } });
  $('#globalSearch').addEventListener('input', (event) => { state.query = event.target.value; renderLibrary(); });
  elements.statusTabs.addEventListener('click', (event) => { if (event.target.dataset.status) { state.filter = event.target.dataset.status; renderLibrary(); } });
  elements.statusTabs.addEventListener('change', (event) => { if (event.target.id === 'librarySort') { state.sort = event.target.value; renderLibrary(); } });
  elements.animeList.addEventListener('click', async (event) => { const open = event.target.closest('[data-open-anime]'); const edit = event.target.closest('[data-edit-anime]'); const remove = event.target.closest('[data-remove-anime]'); const increment = event.target.closest('[data-increment-anime]'); if (open) renderAnimeDetail(state.anime.find((item) => String(item.id) === open.dataset.openAnime)); if (edit) openEditForm(state.anime.find((item) => String(item.id) === edit.dataset.editAnime)); if (increment) await incrementEpisode(state.anime.find((item) => String(item.id) === increment.dataset.incrementAnime)); if (remove) { const item = state.anime.find((anime) => String(anime.id) === remove.dataset.removeAnime); if (!item || !window.confirm(`Remove ${item.title} from your archive?`)) return; state.anime = state.anime.filter((anime) => anime.id !== item.id); if (supabaseClient) await supabaseClient.from('anime_library').delete().eq('id', item.id); await persist(); renderLibrary(); } });
  elements.modalInput.addEventListener('input', (event) => { clearTimeout(state.searchTimer); elements.searchStatus.textContent = 'Searching in 750ms...'; state.searchTimer = setTimeout(() => searchAnime(event.target.value), SEARCH_DELAY); });
  elements.modalInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); clearTimeout(state.searchTimer); searchAnime(event.target.value); } });
  elements.searchResults.addEventListener('click', (event) => { const button = event.target.closest('[data-result-id]'); if (!button) return; const item = state.searchResults.find((result) => String(result.id) === button.dataset.resultId); elements.searchResults.classList.add('hidden'); elements.addDetailStep.classList.remove('hidden'); elements.modalInput.parentElement.classList.add('hidden'); elements.addDetailStep.innerHTML = makeAddForm(item); bindAddForm(item); });
  elements.discoveryList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-discover-id]');
    if (!button) return;
    const result = state.discoveryResults.find((item) => String(item.id) === button.dataset.discoverId);
    if (result) openAddModalFromDiscovery(result);
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !elements.modal.classList.contains('hidden')) closeAddModal(); });

  elements.connectionsContent.addEventListener('click', async (event) => {
    if (event.target.closest('[data-start-competition]')) {
      const connections = readConnections();
      connections.competition = { weekKey: getWeekKey(), startedAt: new Date().toISOString(), scores: { jordan: 0, ayden: 0 } };
      saveConnections(connections);
      renderConnections();
    }
    const borrow = event.target.closest('[data-borrow-anime]');
    if (borrow) {
      const source = (readConnections().jordanLibrary || []).find((item) => String(item.id) === borrow.dataset.borrowAnime);
      if (!source) return;
      state.anime.unshift(normalize({ ...source, id: crypto.randomUUID(), status: 'Plan to Watch', currentEpisode: 0, notes: `Shared by Jordan: ${source.notes || 'No note'}` }));
      await persist(); renderConnections(); renderLibrary();
    }
  });
  elements.profileSelect.value = state.profile;
  elements.profileSelect.addEventListener('change', async (event) => {
    state.profile = event.target.value;
    localStorage.setItem(PROFILE_KEY, state.profile);
    await loadAnime(); loadPlanning(); refreshPlanCompletion();
    renderDashboard(); renderLibrary(); renderPlanner(); renderCalendar(); renderConnections(); showView(elements.dashboardView);
  });
}

loadAnime().then(() => { loadPlanning(); refreshPlanCompletion(); bindEvents(); showView(elements.dashboardView); renderDashboard(); renderLibrary(); renderConnections(); });
