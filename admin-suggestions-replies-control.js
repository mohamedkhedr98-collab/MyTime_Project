/*
 * Admin Suggestions reply control.
 * Scope: Admin Panel -> Suggestions tab only.
 * Purpose: allow deleting a child reply without deleting the original suggestion.
 */
(function(){
  if (window.__UA07_ADMIN_SUGGESTION_REPLIES_V1) return;
  window.__UA07_ADMIN_SUGGESTION_REPLIES_V1 = true;

  var repliesCache = [];
  var loading = false;
  var bound = false;
  var renderTimer = 0;

  function esc(value){
    return String(value == null ? '' : value)
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }
  function fmt(ts){
    try { return new Date(ts).toLocaleString(); } catch { return ''; }
  }
  function tab(){ return document.getElementById('adminTabSuggestions'); }
  function status(){ return document.getElementById('adminStatus'); }
  function setStatus(text, type){
    var s = status();
    if (!s) return;
    s.textContent = text || '';
    if (type) s.dataset.type = type;
  }
  function getSuggestionId(row){
    var btn = row.querySelector("button[data-action='delete-suggestion'][data-id]");
    return btn ? String(btn.getAttribute('data-id') || '') : '';
  }
  function pickText(reply){
    return String(reply?.text ?? reply?.message ?? reply?.reply ?? reply?.content ?? reply?.body ?? '').trim();
  }
  function pickUser(reply){
    return String(reply?.user_id ?? reply?.sender_id ?? reply?.author_id ?? reply?.created_by ?? '').trim();
  }
  function pickSuggestionId(reply){
    return String(reply?.suggestion_id ?? reply?.parent_id ?? reply?.suggestionId ?? reply?.suggestion ?? '').trim();
  }
  function groupReplies(){
    var map = Object.create(null);
    repliesCache.forEach(function(reply){
      var sid = pickSuggestionId(reply);
      if (!sid) return;
      if (!map[sid]) map[sid] = [];
      map[sid].push(reply);
    });
    return map;
  }
  async function api(path, body){
    var res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    var data = await res.json().catch(function(){ return {}; });
    if (!res.ok) throw new Error(data?.error || 'Request failed');
    return data;
  }
  async function loadReplies(){
    if (loading) return;
    loading = true;
    try {
      var out = await api('/api/admin-suggestion-replies', {});
      repliesCache = Array.isArray(out?.replies) ? out.replies : [];
    } catch (error) {
      // Keep the existing Suggestions panel usable even if replies table/API is unavailable.
      repliesCache = [];
    } finally {
      loading = false;
    }
  }
  function renderReply(reply){
    var id = String(reply?.id || '').trim();
    var text = pickText(reply);
    var user = pickUser(reply);
    return `
      <div class="admin-suggestion-reply" data-reply-id="${esc(id)}" style="margin:8px 0 0 18px;padding:9px 10px;border-radius:12px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);">
        <div style="font-size:11px;opacity:.75;margin-bottom:5px;">Reply ID ${esc(id || '-')} ${reply?.created_at ? '• ' + esc(fmt(reply.created_at)) : ''} ${user ? '• User ' + esc(user) : ''}</div>
        <div style="white-space:pre-wrap;line-height:1.45;">${esc(text || '(empty reply)')}</div>
        <div style="margin-top:7px;display:flex;gap:6px;justify-content:flex-end;">
          <button type="button" class="admin-action danger" data-action="delete-suggestion-reply" data-reply-id="${esc(id)}">Delete reply only</button>
        </div>
      </div>
    `;
  }
  function enhanceRows(){
    var root = tab();
    if (!root) return;
    var grouped = groupReplies();
    Array.from(root.querySelectorAll('.admin-row')).forEach(function(row){
      var sid = getSuggestionId(row);
      if (!sid || row.dataset.replyControlBound === '1') return;
      row.dataset.replyControlBound = '1';
      var main = row.querySelector('.admin-row-main');
      if (!main) return;
      var replies = grouped[sid] || [];
      var holder = document.createElement('div');
      holder.className = 'admin-suggestion-replies-box';
      holder.dataset.suggestionId = sid;
      holder.style.marginTop = '10px';
      holder.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;">
          <span style="font-size:12px;opacity:.78;font-weight:800;">Replies: ${replies.length}</span>
          <button type="button" class="admin-action" data-action="toggle-suggestion-replies" data-suggestion-id="${esc(sid)}">Show replies</button>
          <button type="button" class="admin-action" data-action="refresh-suggestion-replies" data-suggestion-id="${esc(sid)}">Refresh replies</button>
        </div>
        <div class="admin-suggestion-replies-list" style="display:none;margin-top:6px;">
          ${replies.length ? replies.map(renderReply).join('') : '<div style="font-size:12px;opacity:.65;margin-top:6px;">No replies for this suggestion.</div>'}
        </div>
      `;
      main.appendChild(holder);
    });
  }
  async function refreshAndRender(){
    await loadReplies();
    var root = tab();
    if (!root) return;
    root.querySelectorAll('.admin-suggestion-replies-box').forEach(function(el){ el.remove(); });
    root.querySelectorAll('.admin-row[data-reply-control-bound="1"]').forEach(function(row){ delete row.dataset.replyControlBound; });
    enhanceRows();
  }
  function scheduleRender(){
    clearTimeout(renderTimer);
    renderTimer = setTimeout(function(){ refreshAndRender(); }, 250);
  }
  function bindEvents(){
    if (bound) return;
    bound = true;
    document.addEventListener('click', async function(e){
      var target = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
      if (!target) return;
      var root = tab();
      if (!root || !root.contains(target)) return;
      var action = target.getAttribute('data-action');
      if (action === 'toggle-suggestion-replies') {
        var box = target.closest('.admin-suggestion-replies-box');
        var list = box?.querySelector('.admin-suggestion-replies-list');
        if (!list) return;
        var show = list.style.display === 'none';
        list.style.display = show ? 'block' : 'none';
        target.textContent = show ? 'Hide replies' : 'Show replies';
        return;
      }
      if (action === 'refresh-suggestion-replies') {
        setStatus('Refreshing suggestion replies…');
        await refreshAndRender();
        setStatus('Replies refreshed ✅');
        return;
      }
      if (action === 'delete-suggestion-reply') {
        var id = target.getAttribute('data-reply-id');
        if (!id) return;
        var ok = confirm('Delete this reply only?\n\nThe original suggestion will remain unchanged.');
        if (!ok) return;
        try {
          setStatus('Deleting reply…');
          await api('/api/admin-delete', { table: 'suggestion_replies', id: Number(id) });
          setStatus('Reply deleted ✅');
          repliesCache = repliesCache.filter(function(r){ return String(r?.id || '') !== String(id); });
          await refreshAndRender();
        } catch (error) {
          setStatus('Could not delete reply: ' + String(error?.message || ''), 'error');
        }
      }
    }, true);
  }
  function boot(){
    bindEvents();
    scheduleRender();
    try {
      var observer = new MutationObserver(function(){ scheduleRender(); });
      var root = tab();
      if (root) observer.observe(root, { childList: true, subtree: false });
    } catch {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
