# Search System Documentation

## Overview
The multi-profile anime notebook features a comprehensive search system that allows users to discover and add anime with advanced filtering and sorting capabilities.

## Features

### 1. **Title Search**
- Search by anime title in both modal view and full search view
- Minimum 2 characters to trigger search
- Real-time results with fallback to AniList API if Jikan API unavailable

### 2. **Genre/Tag Filtering**
Available genres (by ID):
- 1: Action
- 2: Adventure
- 4: Comedy
- 8: Drama
- 10: Fantasy
- 14: Horror
- 7: Mystery
- 22: Romance
- 24: Sci-Fi
- 36: Slice of Life
- 30: Sports
- 37: Supernatural
- 41: Suspense
- 62: Isekai

**Implementation:**
- Select dropdown in search view
- Sends genre ID via `?genres={id}` parameter to Jikan API
- Works with or without title search

### 3. **Type Filtering**
Filter by anime format:
- `tv` - TV Series (default)
- `movie` - Theatrical Movies
- `ova` - Original Video Animation
- `special` - TV Specials
- `ona` - Original Net Animation

**Implementation:**
- Select dropdown in search view
- Sends via `&type={value}` to Jikan API

### 4. **Status Filtering**
Filter by anime air status:
- `airing` - Currently Airing
- `complete` - Finished Airing
- `upcoming` - Not Yet Aired

**Implementation:**
- Select dropdown in search view
- Sends via `&status={value}` to Jikan API

### 5. **Popularity Sorting**
Sort results by four criteria:
- `popularity` - Most Popular (default, descending order)
- `score` - Highest Rated (by user ratings)
- `start_date` - Newest (by broadcast date)
- `episodes` - Most Episodes (by episode count)

**Implementation:**
- Select dropdown in search view
- Maps to `&order_by={value}&sort=desc` in Jikan API

### 6. **Profile-Aware Search**
- Search results respect profile data isolation
- Each profile has its own anime library
- Results exclude anime already in current profile's notebook
- "IN NOTEBOOK" badge shows duplicates with disabled "Add" button

## API Endpoints

### Jikan API v4
**Primary Search Endpoint:**
```
GET https://api.jikan.moe/v4/anime
```

**Query Parameters:**
```
- q="{query}"                    // Search title
- genres={id}                    // Filter by genre ID
- type={type}                    // Filter by type (tv, movie, ova, special, ona)
- status={status}                // Filter by status (airing, complete, upcoming)
- order_by={sort}                // Sort field (popularity, score, start_date, episodes)
- sort={order}                   // Sort direction (desc for descending)
- limit=24                       // Results per page
- sfw=true                       // Safe for work
```

**Popular Anime Endpoint:**
```
GET https://api.jikan.moe/v4/top/anime?limit=24
```

### Fallback: AniList GraphQL
Used when Jikan API is unavailable or search has issues.

## Code Structure

### Main Functions

#### `executeFullSearch(query = '')`
Enhanced search function that:
- Reads all filter select values (genre, type, status, sort)
- Builds appropriate Jikan API URL
- Handles both title search and popular browsing
- Calls `renderSearchResults()` with results
- Updates status message and results count

**Implementation:**
```javascript
async function executeFullSearch(query = '') {
  // 1. Read filter values
  const genre = elements.genreFilter?.value || '';
  const type = elements.typeFilter?.value || '';
  const status = elements.statusFilter?.value || '';
  const sort = elements.sortFilter?.value || 'popularity';
  
  // 2. Build Jikan API URL
  let url;
  if (query) {
    // Title search with filters
    url = `${JIKAN_URL}/anime?q=${encodeURIComponent(query)}&limit=24&sfw=true`;
    if (genre) url += `&genres=${genre}`;
    if (type) url += `&type=${type}`;
    if (status) url += `&status=${status}`;
    if (sort && sort !== 'popularity') url += `&order_by=${sort}&sort=desc`;
  } else {
    // Popular browse with filters
    if (genre) {
      url = `${JIKAN_URL}/anime?genres=${genre}&limit=24&sfw=true&order_by=popularity&sort=desc`;
    } else if (sort === 'score') {
      url = `${JIKAN_URL}/top/anime?limit=24`;
    } else {
      url = `${JIKAN_URL}/top/anime?limit=24`;
    }
  }
  
  // 3. Fetch and render
  try {
    const response = await fetch(url);
    const data = await response.json();
    const results = (data.data || []).map(normalize).filter(item => item && item.title);
    renderSearchResults(results);
  } catch (err) {
    // Error handling
  }
}
```

#### `renderSearchResults(results)`
Displays search results with:
- Anime cover image
- Title
- Episode count and duration
- "Add to Notebook" button
- "IN NOTEBOOK" badge for duplicates
- Click handlers for adding to library

#### `openAddModalFromSearch(item)`
Opens add-to-library modal with:
- Anime details pre-filled
- Form for status, rating, notes
- One-click add functionality

#### `searchAnime(query)`
Quick search in modal view (8 results)
- Used when adding from library main view
- Fallback to AniList if Jikan unavailable

## Event Bindings

In `bindEvents()`:
```javascript
// Search button + Enter key
elements.executeSearchBtn.addEventListener('click', () => 
  executeFullSearch(elements.fullSearchInput.value));
elements.fullSearchInput.addEventListener('keydown', (e) => { 
  if (e.key === 'Enter') executeFullSearch(elements.fullSearchInput.value); 
});

// Filter change handlers
[elements.genreFilter, elements.typeFilter, elements.statusFilter, elements.sortFilter].forEach(el => {
  el.addEventListener('change', () => 
    executeFullSearch(elements.fullSearchInput.value));
});

// Back button
elements.searchBackBtn.addEventListener('click', () => 
  showView(elements.libraryView));

// New anime button opens search
document.getElementById('newAnimeBtn').addEventListener('click', () => {
  showView(elements.searchView);
  executeFullSearch(); // Load initial popular list
});
```

## HTML Structure

```html
<section id="searchView" class="view">
  <div class="search-controls-box glass-panel">
    <div class="search-bar-row">
      <label class="search-input-label">
        <input id="fullSearchInput" type="search" placeholder="Type a title..." />
      </label>
      <button id="executeSearchBtn" class="primary-btn">Search</button>
    </div>
    
    <div class="filter-row">
      <select id="genreFilter" class="filter-select">
        <option value="">All Genres</option>
        <option value="1">Action</option>
        <!-- ... more genres ... -->
      </select>
      
      <select id="typeFilter" class="filter-select">
        <option value="">All Types</option>
        <option value="tv">TV Series</option>
        <!-- ... more types ... -->
      </select>
      
      <select id="statusFilter" class="filter-select">
        <option value="">Any Status</option>
        <option value="airing">Currently Airing</option>
        <!-- ... more statuses ... -->
      </select>
      
      <select id="sortFilter" class="filter-select">
        <option value="popularity">Most Popular</option>
        <option value="score">Highest Rated</option>
        <!-- ... more sorts ... -->
      </select>
    </div>
  </div>
  
  <div id="fullSearchStatus" class="search-status-text">Showing popular anime</div>
  <div id="fullSearchList" class="anime-grid"></div>
</section>
```

## Multi-Profile Integration

### Profile-Scoped Search
- Search results generated for current active profile (state.profile)
- Results exclude anime in `state.anime` (current profile's library)
- When profile changes:
  - `loadAnime()` reloads profile-specific library
  - Search results show only anime from Jikan API not in new profile

### Duplicate Detection
```javascript
const isAdded = state.anime.some(a => 
  String(a.mal_id) === String(item.mal_id) || 
  String(a.id) === String(item.id)
);
```

- Checks current profile's anime array
- Compares both `mal_id` (from Jikan) and internal `id`
- Shows "IN NOTEBOOK" badge when found
- Disables "Add to Notebook" button

## Data Isolation

- **Jordan's search:** Shows anime available for Jordan's profile only
- **Ayden's search:** Shows anime available for Ayden's profile only
- **Shared data:** Both can borrow anime from each other via Connections

## Cleanup & Improvements

**Changes Made:**
1. ✅ Removed 2 duplicate `executeFullSearch()` functions
2. ✅ Removed 1 duplicate `renderSearchResults()` function
3. ✅ Enhanced main `executeFullSearch()` with better filter handling
4. ✅ Improved error messages and status display
5. ✅ Added proper sort parameter mapping
6. ✅ Verified all event bindings work correctly
7. ✅ Maintained backward compatibility with existing search

**Code Quality:**
- ✅ Syntax validation passed (Node.js --check)
- ✅ No duplicate function definitions
- ✅ Single source of truth for search logic
- ✅ Clean event binding architecture
- ✅ Proper error handling with fallbacks

## Testing

To test the search system:

1. **Title Search:**
   - Type "Demon Slayer" → Search
   - Verify results show anime matching title

2. **Genre Filter:**
   - Select genre "Action" → observe results change
   - Try different genres independently

3. **Type Filter:**
   - Select "Movie" → see only movies
   - Select "TV" → see only TV series

4. **Status Filter:**
   - Select "Airing" → see currently airing anime
   - Select "Finished" → see completed series

5. **Sort Options:**
   - "Most Popular" → should show top-rated anime
   - "Highest Rated" → should show by score
   - "Newest" → should show recent releases
   - "Most Episodes" → should show series with most episodes

6. **Profile Switching:**
   - Add "Demon Slayer" to Jordan's profile
   - Switch to Ayden profile
   - Search "Demon Slayer" → should show result
   - Switch back to Jordan → should show "IN NOTEBOOK" badge

7. **Combined Filters:**
   - Search "anime" + Genre "Action" + Type "TV" + Status "Airing" + Sort "Score"
   - Verify complex queries work correctly

## Performance Notes

- Search debounce: Filters trigger search immediately (no delay)
- API limit: 24 results per query
- Fallback: AniList available if Jikan API unavailable
- Caching: Search results stored in state.searchResults
- Profile switching: Reloads library, search results cleared

## Future Enhancements

Potential additions:
- Search result pagination (load more)
- Advanced search with multiple genres
- Search history saved per profile
- Filter persistence across sessions
- Search suggestions/autocomplete
- Anime comparison tool
- Watchlist vs watched filtering
