
(function(){
  'use strict';

  function getTabs(){
    return document.getElementById('tabs');
  }

  function syncAhlyActiveTab(){
    var tabs = getTabs();
    if(!tabs) return;
    var buttons = tabs.querySelectorAll('.tablinks');
    var active = null;

    Array.prototype.forEach.call(buttons, function(btn){
      btn.classList.remove('mndo-ahly-current-tab');
      btn.removeAttribute('aria-current');
      if(!active && btn.classList.contains('active')) active = btn;
    });

    if(active){
      active.classList.add('mndo-ahly-current-tab');
      active.setAttribute('aria-current', 'page');
    }
  }

  function scheduleSync(){
    setTimeout(syncAhlyActiveTab, 0);
    setTimeout(syncAhlyActiveTab, 80);
  }

  function wrapOpenCity(){
    if(typeof window.openCity !== 'function' || window.openCity.__mndoAhlyActiveTabWrapped) return;
    var original = window.openCity;
    var wrapped = function(){
      var result = original.apply(this, arguments);
      scheduleSync();
      return result;
    };
    try{
      Object.keys(original).forEach(function(key){ wrapped[key] = original[key]; });
    }catch(e){}
    wrapped.__mndoAhlyActiveTabWrapped = true;
    window.openCity = wrapped;
  }

  function init(){
    wrapOpenCity();
    document.addEventListener('click', function(e){
      var target = e.target;
      if(target && target.closest && target.closest('#tabs .tablinks')) scheduleSync();
    }, true);
    scheduleSync();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
