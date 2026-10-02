/* static snapshot override: /api/status -> api_status.json */
(function(){
  const orig = window.fetch;
  window.fetch = function(input, init){
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/api/status')) {
        return orig('api_status.json', init);
      }
    } catch(e) {}
    return orig.apply(this, arguments);
  };
})();
