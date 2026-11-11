(() => {
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let recipes = [], currentId = null, page = 'recipes', supabase = null, user = null, syncEnabled = false;
  const localKey = 'recipe-keeper-recipes-v1';
  try { recipes = JSON.parse(localStorage.getItem(localKey) || '[]'); if (!Array.isArray(recipes)) recipes = []; } catch { recipes = []; }
  if (window.RECIPE_KEEPER_CONFIG?.supabaseUrl && window.RECIPE_KEEPER_CONFIG?.supabaseAnonKey && window.supabase?.createClient) {
    supabase = window.supabase.createClient(window.RECIPE_KEEPER_CONFIG.supabaseUrl, window.RECIPE_KEEPER_CONFIG.supabaseAnonKey);
    supabase.auth.getSession().then(({data}) => { user = data.session?.user || null; if (user) syncCloud(); });
    supabase.auth.onAuthStateChange((_event, session) => { user = session?.user || null; if (user) syncCloud(); });
  }
  function toast(message) { $('toast').textContent = message; $('toast').classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').classList.add('hidden'), 2800); }
  function persist() { localStorage.setItem(localKey, JSON.stringify(recipes)); render(); if (user && syncEnabled) syncOne(currentId).catch(e => console.warn('Cloud sync:', e.message)); }
  async function syncOne(id) {
    const r = recipes.find(x => x.id === id); if (!r || !user || !supabase) return;
    const { error } = await supabase.from('recipes').upsert({ id: r.id, user_id: user.id, recipe: r, updated_at: new Date().toISOString() });
    if (error) throw error;
  }
  async function syncCloud() {
    if (!supabase || !user) return;
    $('authStatus').textContent = 'Syncing your cookbook…';
    const { data, error } = await supabase.from('recipes').select('recipe,updated_at').order('updated_at', {ascending:false});
    if (error) { $('authStatus').textContent = error.message; return; }
    const cloud = (data || []).map(row => row.recipe).filter(Boolean);
    const map = new Map(cloud.map(r => [r.id, r]));
    for (const local of recipes) if (!map.has(local.id)) map.set(local.id, local);
    recipes = [...map.values()]; localStorage.setItem(localKey, JSON.stringify(recipes)); syncEnabled = true;
    for (const r of recipes) { try { await syncOne(r.id); } catch (e) { console.warn(e.message); } }
    $('authStatus').textContent = `Signed in as ${user.email}`; render();
  }
  function setPage(next) {
    page = next;
    ['recipes','favorites','import','detail'].forEach(p => $(`page-${p}`).classList.toggle('hidden', p !== next));
    document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === next));
    if (next === 'recipes' || next === 'favorites') render();
    window.scrollTo({top:0, behavior:'smooth'});
  }
  function card(r) {
    const image = r.image && /^https?:\/\//i.test(r.image) ? `<img src="${escapeHtml(r.image)}" alt="" loading="lazy" onerror="this.remove()">` : '🍲';
    return `<article class="recipe" data-open="${escapeHtml(r.id)}"><div class="recipe-image">${image}</div><div class="recipe-body"><div class="recipe-title">${escapeHtml(r.title)}</div><div class="meta">⏱ ${escapeHtml(r.totalTime || [r.prepTime,r.cookTime].filter(Boolean).join(' prep · ') || 'Time not specified')}</div><div class="recipe-sub"><span>${(r.ingredients||[]).length} ingredients · ${(r.instructions||[]).length} steps</span><span>${r.favorite ? '♥' : '♡'}</span></div></div></article>`;
  }
  function render() {
    $('count').textContent = recipes.length;
    const query = $('search').value.trim().toLowerCase();
    const filtered = recipes.filter(r => (r.title || '').toLowerCase().includes(query));
    $('recipeGrid').innerHTML = filtered.map(card).join('');
    $('empty').classList.toggle('hidden', recipes.length > 0);
    if (recipes.length && !filtered.length) $('recipeGrid').innerHTML = '<p class="muted small">No recipes match your search.</p>';
    const favorites = recipes.filter(r => r.favorite);
    $('favoriteGrid').innerHTML = favorites.length ? favorites.map(card).join('') : '<p class="muted small">No favorites yet. Open a recipe and tap the heart to save it here.</p>';
  }
  function showDetail(id) {
    currentId = id; const r = recipes.find(x => x.id === id); if (!r) return;
    setPage('detail');
    const checked = (r.ingredients || []).filter(x => x.checked).length, total = (r.ingredients || []).length;
    $('detail').innerHTML = `<div class="recipe-detail-top"><div><div class="eyebrow">FROM YOUR COOKBOOK</div><h1>${escapeHtml(r.title)}</h1><p class="muted small">${escapeHtml(r.description || '')}</p></div><div style="display:flex;gap:7px;flex-wrap:wrap"><button class="btn ghost" id="favoriteBtn">${r.favorite ? '♥ Saved' : '♡ Favorite'}</button><button class="btn ghost" id="deleteBtn">Delete</button></div></div>
      <div class="stats"><div class="stat"><small>Prep time</small><b>${escapeHtml(r.prepTime || '—')}</b></div><div class="stat"><small>Cook time</small><b>${escapeHtml(r.cookTime || '—')}</b></div><div class="stat"><small>Servings</small><b>${escapeHtml(r.servings || '—')}</b></div></div>
      <div class="panel"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><h2>Ingredients</h2><span class="pill" id="ingredientCount">${checked}/${total} checked</span></div><div class="progress"><span id="ingredientProgress" style="width:${total ? checked/total*100 : 0}%"></span></div><p class="muted small">Check off each ingredient as you gather or add it.</p><div id="ingredients">${(r.ingredients||[]).map((item,i)=>`<label class="ingredient ${item.checked?'checked':''}"><input type="checkbox" data-ingredient="${i}" ${item.checked?'checked':''}><span>${escapeHtml(item.name || item)}</span></label>`).join('') || '<p class="muted small">No ingredients added.</p>'}</div><button class="btn ghost" id="resetIngredients" style="margin-top:12px;font-size:11px;padding:8px 11px">Reset checkboxes</button></div>
      <div class="panel"><h2>Instructions</h2>${(r.instructions||[]).map((step,i)=>`<div class="step"><div class="stepnum">${i+1}</div><div>${escapeHtml(step)}</div></div>`).join('') || '<p class="muted small">No instructions added.</p>'}</div>
      ${r.sourceUrl ? `<p class="muted small">Original recipe: <a href="${escapeHtml(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">View website ↗</a></p>` : ''}`;
    $('favoriteBtn').onclick = () => { r.favorite = !r.favorite; persist(); showDetail(id); };
    $('deleteBtn').onclick = async () => { if (!confirm('Delete this recipe from your cookbook?')) return; recipes = recipes.filter(x => x.id !== id); localStorage.setItem(localKey, JSON.stringify(recipes)); if (user && supabase) await supabase.from('recipes').delete().eq('id', id).eq('user_id', user.id); currentId = null; setPage('recipes'); toast('Recipe deleted.'); };
    function updateProgress() { const n = r.ingredients.filter(x => x.checked).length; $('ingredientCount').textContent = `${n}/${r.ingredients.length} checked`; $('ingredientProgress').style.width = `${r.ingredients.length ? n/r.ingredients.length*100 : 0}%`; }
    $('ingredients').querySelectorAll('[data-ingredient]').forEach(input => input.addEventListener('change', () => { r.ingredients[Number(input.dataset.ingredient)].checked = input.checked; input.closest('label').classList.toggle('checked', input.checked); updateProgress(); persist(); }));
    $('resetIngredients').onclick = () => { r.ingredients.forEach(x => x.checked = false); persist(); showDetail(id); };
  }
  function saveRecipe(recipe) {
    const r = { id: uid(), title: recipe.title || 'Untitled recipe', description: recipe.description || '', prepTime: recipe.prepTime || '', cookTime: recipe.cookTime || '', totalTime: recipe.totalTime || '', servings: recipe.servings || '', image: recipe.image || '', ingredients: (recipe.ingredients || []).map(x => ({name: typeof x === 'string' ? x : x.name, checked: false})), instructions: recipe.instructions || [], sourceUrl: recipe.sourceUrl || '', favorite: false, createdAt: new Date().toISOString() };
    recipes.unshift(r); currentId = r.id; persist(); setPage('recipes'); toast('Saved to My Recipes!');
  }
  $('topAdd').onclick = $('addMain').onclick = $('emptyAdd').onclick = () => setPage('import');
  $('accountBtn').onclick = () => { $('authModal').classList.remove('hidden'); $('authStatus').textContent = supabase ? (user ? `Signed in as ${user.email}` : 'Sign in or create an account to enable cloud sync.') : 'Cloud sync needs Supabase project settings. See the setup guide.'; };
  document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => setPage(b.dataset.page)));
  document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => setPage('recipes')));
  $('detailBack').onclick = () => setPage('recipes');
  $('search').addEventListener('input', render);
  document.addEventListener('click', e => { const cardEl = e.target.closest('[data-open]'); if (cardEl) showDetail(cardEl.dataset.open); });
  $('importForm').addEventListener('submit', async e => {
    e.preventDefault(); const url = $('recipeUrl').value.trim(); const button = $('importBtn'); button.disabled = true; button.textContent = 'Importing…'; $('importStatus').textContent = 'Fetching the recipe page and extracting its ingredients and steps…';
    try {
      const response = await fetch('/api/import', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url})});
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Recipe import failed.');
      saveRecipe(data.recipe); $('recipeUrl').value = '';
    } catch (error) { $('importStatus').textContent = error.message; toast('Could not import that page. Try pasting the recipe text.'); }
    finally { button.disabled = false; button.textContent = 'Import recipe →'; }
  });
  function parsePasted(text) {
    const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const ingredientStart = lines.findIndex(x => /ingredients/i.test(x));
    const instructionStart = lines.findIndex((x,i) => i > Math.max(ingredientStart, -1) && /instructions|directions|method|preparation/i.test(x));
    const ingredients = ingredientStart >= 0 ? lines.slice(ingredientStart+1, instructionStart > ingredientStart ? instructionStart : undefined).map(x => x.replace(/^[-•*\s]+/, '')).filter(Boolean) : [];
    const instructions = instructionStart >= 0 ? lines.slice(instructionStart+1).map(x => x.replace(/^\d+[.)]\s*/, '')).filter(x => x.length > 3) : [];
    if (!ingredients.length || !instructions.length) throw new Error('Could not identify both the ingredients and instructions. Try adding the recipe manually.');
    return {title: lines[0].replace(/^#+\s*/, '').slice(0,100) || 'Pasted recipe', ingredients, instructions};
  }
  $('usePaste').onclick = () => { try { const r = parsePasted($('pasteText').value); r.sourceUrl = $('recipeUrl').value.trim(); saveRecipe(r); $('pasteText').value=''; } catch(e) { toast(e.message); } };
  $('manualForm').addEventListener('submit', e => { e.preventDefault(); const ingredients = $('manualIngredients').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean); const instructions = $('manualSteps').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean); if (!ingredients.length || !instructions.length) return toast('Add ingredients and instructions first.'); saveRecipe({title:$('manualTitle').value.trim(),prepTime:$('manualPrep').value,cookTime:$('manualCook').value,ingredients,instructions}); $('manualForm').reset(); });
  $('signIn').onclick = async () => { if (!supabase) return $('authStatus').textContent = 'Cloud sync has not been configured yet.'; const {error} = await supabase.auth.signInWithPassword({email:$('authEmail').value,password:$('authPassword').value}); $('authStatus').textContent = error?.message || 'Signed in. Syncing…'; };
  $('signUp').onclick = async () => { if (!supabase) return $('authStatus').textContent = 'Cloud sync has not been configured yet.'; const {error} = await supabase.auth.signUp({email:$('authEmail').value,password:$('authPassword').value}); $('authStatus').textContent = error?.message || 'Check your email to confirm your account.'; };
  $('authClose').onclick = () => $('authModal').classList.add('hidden');
  // Android/Chromium Web Share Target: a shared URL is passed to this app as a query parameter.
  const params = new URLSearchParams(location.search); const shared = params.get('url') || params.get('text');
  if (params.get('shared') === '1' || shared) { const candidate = shared && shared.match(/https?:\/\/\S+/)?.[0]; if (candidate) { $('recipeUrl').value = candidate; setPage('import'); history.replaceState({}, '', '/'); } }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(console.warn);
  render();
})();
