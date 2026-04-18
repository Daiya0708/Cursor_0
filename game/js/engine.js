/* ============================================================
 * Campus Heart — シーン管理エンジン（完成版）
 *
 * シーンデータ形式:
 *   {
 *     id:   "misaki_s1",
 *     lines:[ { who, text }, ... ],
 *     prompt: "……どうする？",
 *     choices:[ { label, points:{misaki:3}, next:"..." }, ... ],
 *     next:   "misaki_s2",
 *     branch: (state) => "次シーンID",
 *
 *     // エンディング専用
 *     endType: "good" | "normal",
 *     route:   "misaki",
 *     title:   "届いた春",
 *     epilogue:"……まとめの一文。",
 *   }
 * ============================================================ */

const Engine = (() => {
  const HEROINES = ['misaki', 'shiori', 'reina', 'hikari'];
  const NAMES    = { misaki:'美咲', shiori:'詩織', reina:'玲奈', hikari:'ひかり' };
  const FULLNAMES= { misaki:'星野 美咲', shiori:'白石 詩織', reina:'黒川 玲奈', hikari:'藤村 ひかり' };
  const NAME_TO_KEY = { '美咲':'misaki', '詩織':'shiori', '玲奈':'reina', 'ひかり':'hikari' };
  const STORE_KEY = 'campus_heart_progress_v1';

  // ---------- 画面切替 ----------
  function showScreen(id){
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
    if (id === 'gallery') refreshGallery();
  }

  // ---------- ステート ----------
  const state = {
    scenes: {},
    current: null,
    index: 0,
    affection: { misaki:0, shiori:0, reina:0, hikari:0 },
    currentRoute: null,
  };

  function loadScenes(m){ state.scenes = m || {}; }
  function addScenes(m){ Object.assign(state.scenes, m || {}); }
  function getAffection(k){ return state.affection[k] || 0; }

  // ---------- 進行度（localStorage） ----------
  function loadProgress(){
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveCompletion(route, endType){
    if (!route || !endType) return;
    try {
      const d = loadProgress();
      d[route] = d[route] || {};
      d[route][endType] = true;
      localStorage.setItem(STORE_KEY, JSON.stringify(d));
    } catch {}
  }

  // ---------- ルート ----------
  function playRoute(key){
    if (!HEROINES.includes(key)) return;
    state.affection[key] = 0;
    state.currentRoute = key;
    applyTheme(key);
    // intro があれば先に。なければ _s1
    const introId = `${key}_intro`;
    playScene(state.scenes[introId] ? introId : `${key}_s1`);
  }

  function applyTheme(key){
    document.body.dataset.route = key || '';
  }

  // ---------- シーン再生 ----------
  function playScene(id){
    const scene = state.scenes[id];
    if (!scene){
      console.warn(`[Engine] scene not found: ${id}`);
      return;
    }
    const prefix = id.split('_')[0];
    if (HEROINES.includes(prefix)){
      state.currentRoute = prefix;
      applyTheme(prefix);
    }

    state.current = scene;
    state.index = 0;

    const sceneEl = document.getElementById('scene');
    if (sceneEl) sceneEl.onclick = null;

    showScreen('scene');
    updateAffectionHud();
    renderLine();
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

    const line = (scene.lines || [])[state.index];
    if (!line){
      showEndOfScene();
      return;
    }

    const who = line.who || '';
    const speakerKey = NAME_TO_KEY[who];
    speakerEl.textContent = who;
    speakerEl.className = 'speaker'
      + (who === 'ナレーション' ? ' narration' : '')
      + (speakerKey ? ` h-${speakerKey}` : '');

    // フェード再生のため一度classを外してから付け直す
    lineEl.textContent = line.text || '';
    lineEl.classList.remove('anim-in');
    // reflow を挟んで再アニメーション
    void lineEl.offsetWidth;
    lineEl.classList.add('anim-in');

    hintEl.style.display = '';
    hintEl.textContent = '▼ クリック／スペースで進む';
  }

  function advance(){
    if (!state.current) return;
    const choicesEl = document.getElementById('choices');
    if (choicesEl.style.display === 'flex') return;
    state.index += 1;
    renderLine();
  }

  // ---------- シーン末尾 ----------
  function showEndOfScene(){
    const scene = state.current;
    const choicesEl = document.getElementById('choices');
    const hintEl    = document.getElementById('next-hint');
    const lineEl    = document.getElementById('line');

    // エンディング：専用画面へ
    if (scene.endType){
      showEndingScreen(scene);
      return;
    }

    if (scene.choices && scene.choices.length){
      lineEl.textContent = scene.prompt || '…どうする？';
      hintEl.style.display = 'none';
      choicesEl.innerHTML = '';
      choicesEl.style.display = 'flex';
      scene.choices.forEach((c) => {
        const btn = document.createElement('button');
        btn.className = 'choice';
        btn.type = 'button';
        btn.textContent = c.label;
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
      sceneEl.onclick = () => {
        sceneEl.onclick = null;
        playScene(scene.next);
      };
      return;
    }

    hintEl.textContent = '（ここで終わり — タイトルへ戻れます）';
  }

  function onChoose(choice){
    if (choice.points){
      for (const [k, v] of Object.entries(choice.points)){
        state.affection[k] = (state.affection[k] || 0) + v;
      }
      updateAffectionHud();
    }
    if (typeof choice.onPick === 'function') choice.onPick();

    const scene = state.current;
    let nextId = choice.next;
    if (!nextId && typeof scene.branch === 'function'){
      nextId = scene.branch(state);
    }
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
    const epi     = scene.epilogue || '';

    saveCompletion(route, scene.endType);

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

  // ---------- ギャラリーの達成マーク更新 ----------
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
      if (!document.getElementById('scene').classList.contains('active')) return;
      if (e.code === 'Space' || e.code === 'Enter'){
        e.preventDefault();
        advance();
      }
    });

    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      const act = t.dataset.action;
      if (act === 'to-title')        { e.preventDefault(); applyTheme(null); showScreen('title'); }
      else if (act === 'to-gallery') { e.preventDefault(); applyTheme(null); showScreen('gallery'); }
      else if (act === 'route')      { e.preventDefault(); playRoute(t.dataset.route); }
    });
  });

  return {
    showScreen, loadScenes, addScenes, playScene, advance,
    playRoute, getAffection, loadProgress, refreshGallery,
  };
})();


/* ============================================================
 * 起動：URLハッシュがあればそこから、なければタイトル画面
 * ============================================================ */
window.addEventListener('load', () => {
  const hash = location.hash.replace('#', '');
  if (hash){
    Engine.playScene(hash);
  } else {
    Engine.showScreen('title');
  }
});
