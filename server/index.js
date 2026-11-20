import express from 'express';
import helmet from 'helmet';
import * as cheerio from 'cheerio';
import dns from 'node:dns/promises';
import net from 'node:net';
import ipaddr from 'ipaddr.js';
import OpenAI from 'openai';
import { chromium } from 'playwright';
import { PDFParse } from 'pdf-parse';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

function isPublicIp(address) {
  if (!net.isIP(address)) return false;
  const parsed = ipaddr.parse(address);
  return parsed.range() === 'unicast';
}
async function assertPublicHost(hostname) {
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) throw new Error('Local network addresses are not allowed.');
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => !isPublicIp(record.address))) throw new Error('This website resolves to a non-public network address.');
}
async function safeFetch(input) {
  let current = new URL(input);
  if (!['http:', 'https:'].includes(current.protocol)) throw new Error('Only HTTP and HTTPS recipe URLs are supported.');
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (current.username || current.password) throw new Error('URLs containing credentials are not supported.');
    await assertPublicHost(current.hostname);
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(18000),
      headers: { 'User-Agent': 'RecipeKeeperBot/1.0 (+recipe extraction)', 'Accept': 'text/html,application/xhtml+xml' }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('The website returned an invalid redirect.');
      current = new URL(location, current);
      if (!['http:', 'https:'].includes(current.protocol)) throw new Error('Unsupported redirect protocol.');
      continue;
    }
    if (response.status === 403 || response.status === 401 || response.status === 429) {
      const error = new Error(response.status === 429
        ? 'This recipe website is limiting automated requests. Open the recipe in your browser and paste its text below.'
        : 'This recipe website blocks automated imports. Open the recipe in your browser and paste its text below.');
      error.code = 'SOURCE_BLOCKED';
      error.sourceStatus = response.status;
      throw error;
    }
    if (!response.ok) throw new Error(`The website returned HTTP ${response.status}.`);
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) throw new Error('That link did not return a recipe webpage.');
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > 5_000_000) throw new Error('The webpage is too large to import.');
    const html = await response.text();
    if (html.length > 5_000_000) throw new Error('The webpage is too large to import.');
    return { html, finalUrl: current.toString() };
  }
  throw new Error('The website redirected too many times.');
}
// Best-effort PDF fallback. The browser never bypasses a site's access restrictions.
async function browserPdfFallback(input) {
  const url = new URL(input);
  await assertPublicHost(url.hostname);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    const page = await context.newPage();
    // Validate every browser request, including redirects and embedded resources, to prevent SSRF.
    await page.route('**/*', async route => {
      try {
        const target = new URL(route.request().url());
        if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) return route.abort();
        await assertPublicHost(target.hostname);
        if (route.request().resourceType() !== 'document' && !['stylesheet', 'font'].includes(route.request().resourceType())) return route.abort();
        await route.continue();
      } catch { await route.abort(); }
    });
    const response = await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 18000 });
    if (!response || !response.ok()) return null;
    const finalUrl = new URL(page.url());
    await assertPublicHost(finalUrl.hostname);
    const html = await page.content();
    if (html.length > 5_000_000) return null;
    const pdf = await page.pdf({ format: 'A4', printBackground: false, timeout: 12000 });
    if (pdf.length > 5_000_000) return null;
    const parser = new PDFParse({ data: pdf });
    try {
      const extracted = await parser.getText();
      return { html, pdfText: String(extracted.text || '').slice(0, 22000), finalUrl: finalUrl.toString() };
    } finally { await parser.destroy(); }
  } catch (error) {
    console.warn('PDF fallback unavailable:', error.message);
    return null;
  } finally { if (browser) await browser.close(); }
}
async function aiExtractPdf(text, url) {
  if (!openai || !text.trim()) return null;
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Extract the cooking recipe from PDF text. Return JSON keys title, description, prepTime, cookTime, totalTime, servings, ingredients (array of strings), instructions (array of ordered step strings), image (empty string). Never invent ingredients or instructions. Ignore unrelated page content. If no complete recipe is present, return empty ingredients and instructions.' },
      { role: 'user', content: 'Source: ' + url + '\\nPDF text:\\n' + text }
    ]
  });
  const result = JSON.parse(completion.choices[0]?.message?.content || '{}');
  return { ...result, ingredients: Array.isArray(result.ingredients) ? result.ingredients : [], instructions: Array.isArray(result.instructions) ? result.instructions : [], sourceUrl: url, extractionMethod: 'browser-pdf-ai' };
}
function findRecipe(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) { const found = findRecipe(item); if (found) return found; }
    return null;
  }
  if (typeof node !== 'object') return null;
  const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
  if (types.includes('Recipe')) return node;
  if (node['@graph']) return findRecipe(node['@graph']);
  return null;
}
function asText(value) {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
  if (value && typeof value === 'object') return value.name || value.text || '';
  return value == null ? '' : String(value);
}
function structuredRecipe($) {
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try { const found = findRecipe(JSON.parse($(script).contents().text())); if (found) return found; } catch {}
  }
  return null;
}
function normalizeStructured(r, url) {
  const instructions = [];
  function collect(value) {
    if (Array.isArray(value)) return value.forEach(collect);
    if (value && typeof value === 'object') {
      if (value.itemListElement) return collect(value.itemListElement);
      if (value.text) instructions.push(asText(value.text));
      else if (value.name) instructions.push(asText(value.name));
      return;
    }
    if (value) instructions.push(String(value));
  }
  collect(r.recipeInstructions);
  const ingredients = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : []).map(asText).filter(Boolean);
  const imageValue = Array.isArray(r.image) ? r.image[0] : r.image;
  return {
    title: asText(r.name) || 'Imported recipe',
    description: asText(r.description),
    prepTime: asText(r.prepTime),
    cookTime: asText(r.cookTime),
    totalTime: asText(r.totalTime),
    servings: asText(r.recipeYield),
    image: typeof imageValue === 'string' ? imageValue : asText(imageValue?.url),
    ingredients,
    instructions: instructions.filter(Boolean),
    sourceUrl: url,
    extractionMethod: 'structured-data'
  };
}
function pageText($) {
  const clone = cheerio.load($.html());
  clone('script,style,noscript,svg,nav,footer,header,aside,form,iframe,button,[aria-hidden="true"],. 광고,.advertisement,.comments,.comment,.related-posts').remove();
  return clone('body').text().replace(/\s+/g, ' ').trim().slice(0, 22000);
}

function localRecipeFromHtml($, url) {
  const selectors = ['.wprm-recipe-container', '.tasty-recipes', '.mv-create-card', '.easyrecipe', '[itemtype*="schema.org/Recipe"]'];
  const root = $(selectors.join(',')).first();
  const scope = root.length ? root : $('body');
  const readItems = (selectors) => {
    for (const selector of selectors) {
      const items = scope.find(selector).map((_, el) => $(el).text().replace(/\\s+/g, ' ').trim()).get().filter(Boolean);
      if (items.length) return [...new Set(items)].slice(0, 100);
    }
    return [];
  };
  const ingredients = readItems(['.wprm-recipe-ingredient', '.tasty-recipes-ingredients li', '.mv-create-ingredients li', '[itemprop="recipeIngredient"]']);
  const instructions = readItems(['.wprm-recipe-instruction-text', '.tasty-recipes-instructions li', '.mv-create-instructions li', '[itemprop="recipeInstructions"] li', '[itemprop="recipeInstructions"]']);
  if (!ingredients.length || !instructions.length) return null;
  return { title: scope.find('.wprm-recipe-name,.tasty-recipes-title,.mv-create-title,[itemprop="name"]').first().text().trim() || $('h1').first().text().trim() || 'Imported recipe', description: '', prepTime: '', cookTime: '', totalTime: '', servings: scope.find('.wprm-recipe-servings,.tasty-recipes-yield').first().text().trim(), image: '', ingredients, instructions, sourceUrl: url, extractionMethod: 'local-html' };
}
function localRecipeFromPdf(text, url) {
  const lines = text.split(/\\r?\\n/).map(x => x.trim()).filter(Boolean);
  const ingredientsAt = lines.findIndex(x => /^(ingredients|what you need)\\s*:?$/i.test(x));
  const instructionsAt = lines.findIndex((x,i) => i > ingredientsAt && /^(instructions|directions|method|steps|preparation)\\s*:?$/i.test(x));
  if (ingredientsAt < 0 || instructionsAt < 0) return null;
  const ingredients = lines.slice(ingredientsAt + 1, instructionsAt).filter(x => x.length < 250).slice(0, 100);
  const instructions = lines.slice(instructionsAt + 1).filter(x => x.length > 10).slice(0, 80);
  if (!ingredients.length || !instructions.length) return null;
  return { title: lines[0] || 'Imported recipe', description: '', prepTime: '', cookTime: '', totalTime: '', servings: '', image: '', ingredients, instructions, sourceUrl: url, extractionMethod: 'local-pdf' };
}
function isAiQuotaError(error) {
  return error?.status === 429 || /insufficient_quota|no credits remaining|exceeded your current quota/i.test(error?.message || '');
}

async function aiExtract($, url) {
  if (!openai) return null;
  const title = $('title').first().text().trim();
  const text = pageText($);
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Extract a cooking recipe from webpage text. Return JSON only with keys title, description, prepTime, cookTime, totalTime, servings, ingredients (array of strings preserving quantities), instructions (array of concise ordered step strings), and image (string or empty). Do not invent missing quantities or steps. Ignore ads, author biographies, comments, nutrition chatter, and unrelated page content. If the page does not contain a complete recipe, return empty ingredients and instructions.' },
      { role: 'user', content: `Source URL: ${url}\nPage title: ${title}\nWebpage text:\n${text}` }
    ]
  });
  const result = JSON.parse(completion.choices[0]?.message?.content || '{}');
  return { ...result, ingredients: Array.isArray(result.ingredients) ? result.ingredients : [], instructions: Array.isArray(result.instructions) ? result.instructions : [], sourceUrl: url, extractionMethod: 'ai' };
}
app.post('/api/import', async (req, res) => {
  try {
    const rawUrl = String(req.body?.url || '').trim();
    if (!rawUrl || rawUrl.length > 2048) return res.status(400).json({ error: 'Please provide a valid recipe URL.' });
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return res.status(400).json({ error: 'That URL is not valid.' }); }
    if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ error: 'Only HTTP and HTTPS URLs are supported.' });
    let html, finalUrl, pdfText = '';
    try {
      ({ html, finalUrl } = await safeFetch(parsed.toString()));
    } catch (error) {
      if (error.code !== 'SOURCE_BLOCKED' || error.sourceStatus !== 403) throw error;
      const fallback = await browserPdfFallback(parsed.toString());
      if (!fallback) throw error;
      ({ html, finalUrl, pdfText } = fallback);
    }
    const $ = cheerio.load(html);
    const structured = structuredRecipe($);
    let recipe = structured ? normalizeStructured(structured, finalUrl) : null;
    const complete = r => r?.ingredients?.length && r?.instructions?.length;
    if (!complete(recipe)) recipe = localRecipeFromHtml($, finalUrl);
    if (!complete(recipe) && pdfText) recipe = localRecipeFromPdf(pdfText, finalUrl);
    let aiUnavailable = false;
    if (!complete(recipe) && openai) {
      try {
        const aiRecipe = pdfText ? await aiExtractPdf(pdfText, finalUrl) : await aiExtract($, finalUrl);
        if (complete(aiRecipe)) recipe = aiRecipe;
      } catch (error) {
        if (isAiQuotaError(error)) { aiUnavailable = true; console.warn('Recipe AI extraction skipped: API credits exhausted'); }
        else throw error;
      }
    }
    if (!complete(recipe)) {
      return res.status(422).json({ error: aiUnavailable ? 'Automatic recipe extraction could not finish because AI credits are exhausted. Try Share to Cookbook or paste the recipe text.' : 'I could not find a complete recipe on that page. Try Share to Cookbook or paste the recipe text.', code: aiUnavailable ? 'AI_CREDITS_EXHAUSTED' : 'RECIPE_NOT_FOUND' });
    }
    res.json({ recipe });
  } catch (error) {
    console.error('Recipe import failed:', isAiQuotaError(error) ? 'AI credits exhausted' : error.message);
    if (isAiQuotaError(error)) return res.status(422).json({ error: 'AI credits are exhausted. Use Share to Cookbook or paste recipe text.', code: 'AI_CREDITS_EXHAUSTED' });
    const status = error.code === 'SOURCE_BLOCKED' ? 422 : /non-public|Local network|protocol|credentials/i.test(error.message) ? 400 : 502;
    res.status(status).json({ error: error.message || 'Could not import this recipe.', code: error.code || 'IMPORT_FAILED' });
  }
});
app.get('/api/health', (_req, res) => res.json({ ok: true, aiEnabled: Boolean(openai) }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.listen(PORT, () => console.log(`Mama's Cookbook listening on port ${PORT}`));
