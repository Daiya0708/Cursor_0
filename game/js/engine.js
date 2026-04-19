/* ============================================================
 * Campus Heart — シーン管理エンジン（拡張版）
 *
 * シーンデータ形式:
 *   {
 *     id, lines:[{who,text}, ...],
 *     prompt, choices:[{label, points, next}, ...],
 *     next: "次ID",
 *     branch: (state) => "次ID",
 *     onEnd: (engine) => void,          // 行を全て表示しきった後に呼ばれる（next/choices/branch/endType よりも優先される）
 *     endType: "good"|"normal", route, title, epilogue,  // エンディング専用
 *   }
 *
 * テキスト内の置換:
 *   {name}  → プレイヤー名
 * ============================================================ */

const Engine = (() => {
  const HEROINES = ['misaki', 'shiori', 'reina', 'hikari'];
  const NAMES    = { misaki:'美咲', shiori:'詩織', reina:'玲奈', hikari:'ひかり' };
  const FULLNAMES= { misaki:'星野 美咲', shiori:'白石 詩織', reina:'黒川 玲奈', hikari:'藤村 ひかり' };
  const NAME_TO_KEY = { '美咲':'misaki', '詩織':'shiori', '玲奈':'reina', 'ひかり':'hikari' };
  const STORE_PROG = 'campus_heart_progress_v1';
  const STORE_NAME = 'campus_heart_player_name_v1';

  // ---------- 画面切替 ----------
  function showScreen(id){
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
    if (id === 'gallery') { refreshGallery(); updatePlayerNameBadge(); }
    // シーン以外に移ったら auto/skip は解除
    if (id !== 'scene') { state.autoMode = false; state.skipMode = false; clearTimeout(state.autoTimer); updateModeButtons(); }
  }

  // ---------- ステート ----------
  const state = {
    scenes: {},
    current: null,
    index: 0,
    affection: { misaki:0, shiori:0, reina:0, hikari:0 },
    currentRoute: null,

    playerName: (()=>{ try { return localStorage.getItem(STORE_NAME) || '君'; } catch { return '君'; } })(),
    history: [],              // {who, text}[]
    autoMode: false,
    skipMode: false,
    autoTimer: null,
  };

  function loadScenes(m){ state.scenes = m || {}; }
  function addScenes(m){ Object.assign(state.scenes, m || {}); }
  function getAffection(k){ return state.affection[k] || 0; }

  // ---------- 名前 ----------
  function setPlayerName(name){
    const n = (name || '').trim().slice(0, 12) || '君';
    state.playerName = n;
    try { localStorage.setItem(STORE_NAME, n); } catch {}
    updatePlayerNameBadge();
  }
  function updatePlayerNameBadge(){
    const el = document.getElementById('gallery-name');
    if (el) el.textContent = state.playerName ? `${state.playerName} として` : '';
  }
  function substitute(s){
    if (!s) return '';
    return String(s).replace(/\{name\}/g, state.playerName || '君');
  }

  // ---------- 進行度 ----------
  function loadProgress(){
    try { return JSON.parse(localStorage.getItem(STORE_PROG) || '{}'); }
    catch { return {}; }
  }
  function saveCompletion(route, endType){
    if (!route || !endType) return;
    try {
      const d = loadProgress();
      d[route] = d[route] || {};
      d[route][endType] = true;
      localStorage.setItem(STORE_PROG, JSON.stringify(d));
    } catch {}
  }
  function resetProgress(){
    try {
      localStorage.removeItem(STORE_PROG);
      localStorage.removeItem(STORE_NAME);
    } catch {}
    state.playerName = '君';
    state.history = [];
    state.affection = { misaki:0, shiori:0, reina:0, hikari:0 };
    refreshGallery();
    updatePlayerNameBadge();
    toast('進行データをリセットしました');
  }

  // ---------- ルート ----------
  function playRoute(key){
    if (!HEROINES.includes(key)) return;
    state.affection[key] = 0;
    state.currentRoute = key;
    state.history = [];
    applyTheme(key);
    const introId = `${key}_intro`;
    playScene(state.scenes[introId] ? introId : `${key}_s1`);
  }
  function applyTheme(key){ document.body.dataset.route = key || ''; }

  // ---------- 新規ゲーム開始 ----------
  function startNewGame(){
    // 現在の保存名を入力欄に反映
    const input = document.getElementById('player-name');
    if (input) input.value = state.playerName === '君' ? '' : state.playerName;
    applyTheme(null);
    showScreen('prologue');
    setTimeout(() => input && input.focus(), 50);
  }
  function confirmName(){
    const input = document.getElementById('player-name');
    const v = (input?.value || '').trim() || '君';
    setPlayerName(v);
    // 共通プロローグがあれば再生、なければそのままギャラリーへ
    if (state.scenes['common_prologue']) {
      state.history = [];
      playScene('common_prologue');
    } else {
      showScreen('gallery');
    }
  }

  // ---------- シーン再生 ----------
  function playScene(id){
    const scene = state.scenes[id];
    if (!scene){ console.warn(`[Engine] scene not found: ${id}`); return; }

    const prefix = id.split('_')[0];
    if (HEROINES.includes(prefix)){
      state.currentRoute = prefix;
      applyTheme(prefix);
      setPortrait(prefix);  // シーン開始時にルートヒロインの立ち絵
    } else {
      clearPortrait();
    }

    state.current = scene;
    state.index = 0;

    const sceneEl = document.getElementById('scene');
    if (sceneEl) sceneEl.onclick = null;

    showScreen('scene');
    updateAffectionHud();
    renderLine();
  }

  // ---------- 立ち絵プリロード ----------
  function preloadPortraits(){
    HEROINES.forEach(k => {
      const img = new Image();
      img.decoding = 'async';
      img.loading = 'eager';
      img.src = `assets/${k}.png`;
    });
  }

  // ---------- 立ち絵制御 ----------
  function setPortrait(key){
    const el = document.getElementById('scene-portrait');
    if (!el) return;
    el.dataset.key = key;
    el.className = `scene-portrait show h-${key}`;
  }
  function clearPortrait(){
    const el = document.getElementById('scene-portrait');
    if (!el) return;
    el.className = 'scene-portrait';
    el.dataset.key = '';
  }
  function dimPortrait(on){
    const el = document.getElementById('scene-portrait');
    if (!el) return;
    el.classList.toggle('dim', !!on);
  }

  // ---------- テキスト描画 ----------
  function renderLine(){
    const scene = state.current;
    if (!scene) return;

    const speakerEl = document.getElementById('speaker');
    const lineEl    = document.getElementById('line');
    const choicesEl = document.getElementById('choices');
    const hintEl    = document.getElementById('next-hint');

    choicesEl.innerHTML = '';
    choicesEl.style.display = 'none';

    const raw = (scene.lines || [])[state.index];
    if (!raw){ showEndOfScene(); return; }

    const who = raw.who || '';
    const text = substitute(raw.text);
    const key = NAME_TO_KEY[who];

    speakerEl.textContent = who;
    speakerEl.className = 'speaker'
      + (who === 'ナレーション' ? ' narration' : '')
      + (key ? ` h-${key}` : '');

    // 立ち絵：ヒロインが喋ったらそのヒロインに切替、ナレーションは少し暗くして現状維持
    if (key){ setPortrait(key); dimPortrait(false); }
    else if (who === 'ナレーション'){ dimPortrait(true); }
    else { dimPortrait(false); }

    lineEl.textContent = text;
    lineEl.classList.remove('anim-in');
    void lineEl.offsetWidth;
    lineEl.classList.add('anim-in');

    hintEl.style.display = '';
    hintEl.textContent = '▼ クリック／スペースで進む';

    // バックログ記録
    state.history.push({ who, text });
    if (state.history.length > 500) state.history.splice(0, state.history.length - 500);

    // オート/スキップのスケジューリング
    scheduleAutoAdvance();
  }

  function advance(){
    if (!state.current) return;
    const choicesEl = document.getElementById('choices');
    if (choicesEl.style.display === 'flex') return;
    clearTimeout(state.autoTimer);
    state.index += 1;
    renderLine();
  }

  // ---------- シーン末尾 ----------
  function showEndOfScene(){
    const scene = state.current;
    const choicesEl = document.getElementById('choices');
    const hintEl    = document.getElementById('next-hint');
    const lineEl    = document.getElementById('line');

    // onEnd が最優先
    if (typeof scene.onEnd === 'function'){
      scene.onEnd(publicAPI);
      return;
    }

    if (scene.endType){ showEndingScreen(scene); return; }

    if (scene.choices && scene.choices.length){
      // オート/スキップは選択肢で必ず停止
      state.autoMode = false; state.skipMode = false; updateModeButtons();

      lineEl.textContent = scene.prompt ? substitute(scene.prompt) : '…どうする？';
      hintEl.style.display = 'none';
      choicesEl.innerHTML = '';
      choicesEl.style.display = 'flex';
      scene.choices.forEach((c) => {
        const btn = document.createElement('button');
        btn.className = 'choice';
        btn.type = 'button';
        btn.textContent = substitute(c.label);
        btn.addEventListener('click', () => onChoose(c));
        choicesEl.appendChild(btn);
      });
      return;
    }

    if (typeof scene.branch === 'function'){
      const nextId = scene.branch(state);
      if (nextId){ playScene(nextId); return; }
    }

    if (scene.next){
      hintEl.textContent = '▼ クリックで次へ';
      const sceneEl = document.getElementById('scene');
      sceneEl.onclick = () => { sceneEl.onclick = null; playScene(scene.next); };
      // オート/スキップ中はそのまま次へ
      if (state.autoMode || state.skipMode) {
        clearTimeout(state.autoTimer);
        state.autoTimer = setTimeout(() => { sceneEl.onclick = null; playScene(scene.next); }, state.skipMode ? 120 : 1200);
      }
      return;
    }

    hintEl.textContent = '（ここで終わり）';
  }

  function onChoose(choice){
    if (choice.points){
      for (const [k, v] of Object.entries(choice.points)){
        state.affection[k] = (state.affection[k] || 0) + v;
      }
      updateAffectionHud();
    }
    if (typeof choice.onPick === 'function') choice.onPick();

    state.history.push({ who:'（選択）', text: '→ ' + substitute(choice.label) });

    const scene = state.current;
    let nextId = choice.next;
    if (!nextId && typeof scene.branch === 'function') nextId = scene.branch(state);
    if (!nextId) nextId = scene.next;
    if (nextId) playScene(nextId);
  }

  // ---------- 好感度HUD ----------
  function updateAffectionHud(){
    const el = document.getElementById('hud-heart');
    if (!el) return;
    const r = state.currentRoute;
    if (!r){ el.classList.remove('on'); el.textContent=''; return; }
    el.className = `hud-heart on theme-${r}`;
    el.textContent = `♥ ${NAMES[r] || r}  ${state.affection[r] || 0}`;
  }

  // ---------- エンディング画面 ----------
  function showEndingScreen(scene){
    const route   = scene.route || state.currentRoute;
    const score   = state.affection[route] || 0;
    const isGood  = scene.endType === 'good';
    const label   = isGood ? 'TRUE  ENDING' : 'NORMAL  ENDING';
    const heroine = FULLNAMES[route] || '';
    const title   = scene.title || (isGood ? '届いた想い' : 'やさしい距離');
    const epi     = substitute(scene.epilogue || '');

    saveCompletion(route, scene.endType);
    state.autoMode = false; state.skipMode = false; updateModeButtons();

    const wrap = document.getElementById('ending-wrap');
    wrap.className = `ending-wrap theme-${route} ${isGood ? 'is-good' : 'is-normal'}`;
    wrap.innerHTML = `
      <div class="ending-banner">
        <div class="ending-label">${label}</div>
        <div class="ending-heroine">${heroine}</div>
        <h2 class="ending-title">「${title}」</h2>
        <div class="ending-score">♥ ${score} / 9</div>
      </div>
      <div class="ending-body">
        <p class="ending-text">${epi.replace(/\n/g,'<br>')}</p>
        <div class="ending-actions">
          <button class="btn primary" data-action="route" data-route="${route}">もう一度このヒロインへ</button>
          <button class="btn" data-action="to-gallery">別のヒロインを選ぶ</button>
          <button class="btn ghost" data-action="to-title">タイトルへ戻る</button>
        </div>
      </div>
    `;
    showScreen('ending');
    applyTheme(route);
  }

  // ---------- ギャラリー達成マーク ----------
  function refreshGallery(){
    const p = loadProgress();
    document.querySelectorAll('.char-card').forEach(card => {
      const r = card.dataset.route;
      card.querySelector('.char-progress')?.remove();
      const pr = p[r];
      if (!pr) return;
      const tag = document.createElement('div');
      tag.className = 'char-progress';
      tag.innerHTML =
        (pr.good   ? '<span class="mark good">♥ TRUE</span>' : '') +
        (pr.normal ? '<span class="mark normal">NORMAL</span>' : '');
      card.appendChild(tag);
    });
  }

  // ---------- バックログ ----------
  function openLog(){
    const el = document.getElementById('log-body');
    if (!el) return;
    el.innerHTML = state.history.slice(-200).map(h => {
      const who = h.who ? `<b>${escapeHtml(h.who)}</b>` : '';
      return `<div class="log-entry">${who}<span>${escapeHtml(h.text)}</span></div>`;
    }).join('') || '<div class="log-entry"><span>（ログはまだありません）</span></div>';
    document.getElementById('modal-log').classList.remove('hidden');
    // スクロールを最下部へ
    setTimeout(()=>{ el.scrollTop = el.scrollHeight; }, 0);
  }
  function closeLog(){ document.getElementById('modal-log').classList.add('hidden'); }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // ---------- オート/スキップ ----------
  function toggleAuto(){
    state.autoMode = !state.autoMode;
    if (state.autoMode) state.skipMode = false;
    updateModeButtons();
    scheduleAutoAdvance();
  }
  function toggleSkip(){
    state.skipMode = !state.skipMode;
    if (state.skipMode) state.autoMode = false;
    updateModeButtons();
    scheduleAutoAdvance();
  }
  function updateModeButtons(){
    document.getElementById('btn-auto')?.classList.toggle('on', state.autoMode);
    document.getElementById('btn-skip')?.classList.toggle('on', state.skipMode);
  }
  function scheduleAutoAdvance(){
    clearTimeout(state.autoTimer);
    if (!state.autoMode && !state.skipMode) return;
    const delay = state.skipMode ? 120 : 1600;
    state.autoTimer = setTimeout(() => {
      const choicesEl = document.getElementById('choices');
      if (choicesEl && choicesEl.style.display === 'flex'){ state.autoMode=false; state.skipMode=false; updateModeButtons(); return; }
      advance();
    }, delay);
  }

  // ---------- トースト ----------
  let toastTimer = null;
  function toast(msg){
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 1800);
  }

  // ---------- イベント配線 ----------
  document.addEventListener('DOMContentLoaded', () => {
    const sceneEl = document.getElementById('scene');
    sceneEl.addEventListener('click', (e) => {
      if (e.target.closest('.choice')) return;
      if (e.target.closest('[data-action]')) return;
      if (sceneEl.onclick) return;
      advance();
    });

    document.addEventListener('keydown', (e) => {
      // モーダル表示中はEscで閉じる
      if (!document.getElementById('modal-log').classList.contains('hidden')){
        if (e.code === 'Escape') closeLog();
        return;
      }
      if (document.getElementById('prologue').classList.contains('active')){
        if (e.code === 'Enter') { e.preventDefault(); confirmName(); }
        return;
      }
      if (!document.getElementById('scene').classList.contains('active')) return;
      if (e.code === 'Space' || e.code === 'Enter'){ e.preventDefault(); advance(); }
      else if (e.key === 'l' || e.key === 'L'){ openLog(); }
      else if (e.key === 'a' || e.key === 'A'){ toggleAuto(); }
      else if (e.key === 's' || e.key === 'S'){ toggleSkip(); }
    });

    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      const act = t.dataset.action;
      switch(act){
        case 'to-title':   e.preventDefault(); applyTheme(null); showScreen('title'); break;
        case 'to-gallery': e.preventDefault(); applyTheme(null); showScreen('gallery'); break;
        case 'new-game':   e.preventDefault(); startNewGame(); break;
        case 'confirm-name': e.preventDefault(); confirmName(); break;
        case 'route':      e.preventDefault(); playRoute(t.dataset.route); break;
        case 'log':        e.preventDefault(); openLog(); break;
        case 'close-log':  e.preventDefault(); closeLog(); break;
        case 'auto':       e.preventDefault(); toggleAuto(); break;
        case 'skip':       e.preventDefault(); toggleSkip(); break;
        case 'reset-progress':
          e.preventDefault();
          if (confirm('進行データ（攻略済みマーク・名前）を削除します。よろしいですか？')) resetProgress();
          break;
      }
    });

    // モーダル背景クリックで閉じる
    document.getElementById('modal-log').addEventListener('click', (e) => {
      if (e.target.id === 'modal-log') closeLog();
    });

    updatePlayerNameBadge();
    updateModeButtons();
    preloadPortraits();
  });

  const publicAPI = {
    showScreen, loadScenes, addScenes, playScene, advance,
    playRoute, getAffection, loadProgress, refreshGallery,
    setPlayerName, substitute,
  };
  return publicAPI;
})();


/* ============================================================
 * 起動
 * ============================================================ */
window.addEventListener('load', () => {
  const hash = location.hash.replace('#', '');
  if (hash){ Engine.playScene(hash); }
  else     { Engine.showScreen('title'); }
});
