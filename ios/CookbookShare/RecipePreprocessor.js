var ExtensionPreprocessingJS = (function () {
  function extract() {
    var result = {url: location.href, title: document.title, recipe: null};
    function findRecipe(x) {
      if (!x || typeof x !== 'object') return null;
      if (Array.isArray(x)) { for (var i=0;i<x.length;i++) { var r=findRecipe(x[i]); if(r) return r; } return null; }
      var type=x['@type']; if(type === 'Recipe' || (Array.isArray(type) && type.indexOf('Recipe')>=0)) return x;
      if(x['@graph']) return findRecipe(x['@graph']);
      return null;
    }
    var scripts=document.querySelectorAll('script[type="application/ld+json"]');
    for(var i=0;i<scripts.length;i++){try{var r=findRecipe(JSON.parse(scripts[i].textContent));if(r){result.recipe=r;break;}}catch(e){}}
    if(!result.recipe){
      var card=document.querySelector('.wprm-recipe-container,.tasty-recipes,.mv-create-card,[itemtype*="schema.org/Recipe"]');
      if(card){
        function collect(sel){return Array.from(card.querySelectorAll(sel)).map(function(n){return n.textContent.trim();}).filter(Boolean);}
        result.recipe={name:(card.querySelector('.wprm-recipe-name,.tasty-recipes-title,[itemprop="name"]')||{}).textContent||document.title,
          recipeIngredient:collect('.wprm-recipe-ingredient,.tasty-recipes-ingredients li,[itemprop="recipeIngredient"]'),
          recipeInstructions:collect('.wprm-recipe-instruction-text,.tasty-recipes-instructions li,[itemprop="recipeInstructions"] li')};
      }
    }
    return result;
  }
  return {run:function(args){return extract();},finalize:function(args){}};
})();
