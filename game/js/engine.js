/* ============================================================
 * シーン管理エンジン（テキスト＋選択肢、画像なし）
 *
 * シーンデータの形式:
 *   {
 *     id: "s1",
 *     lines: [
 *       { who: "ナレーション", text: "..." },
 *       { who: "美咲",       text: "..." }
 *     ],
 *     prompt: "……どうする？",       // 選択肢表示時の見出し
 *     choices: [
 *       { label: "声をかける", points:{misaki:3}, next: "s2" },
 *       { label: "無視する",   points:{misaki:1}, next: "s3" },
 *     ],
 *     // 静的な次シーン
 *     next: "s2",
 *     // もしくは動的分岐（好感度で枝分かれ）
 *     branch: (state) => state.affection.misaki >= 6
 *                        ? "misaki_end_good" : "misaki_end_normal",
 *   }
 * ============================================================ */

const Engine = (() => {
  const HEROINES = ['misaki', 'shiori', 'reina', 'hikari'];
  const NAMES = { misaki:'美咲', shiori:'詩織', reina:'玲奈', hikari:'ひかり' };

  // ---------- 画面切り替え ----------
  function showScreen(id){
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  // ---------- 全体ステート ----------
  const state = {
    scenes: {},                                   // id -> scene
    current: null,                                // 現在のシーン
    index: 0,                                     // 行インデックス
    affection: { misaki:0, shiori:0, reina:0, hikari:0 }, // 好感度
    currentRoute: null,                           // 'misaki' | 'shiori' | ...
  };

  function loadScenes(sceneMap){ state.scenes = sceneMap || {}; }
  function addScenes(sceneMap){ Object.assign(state.scenes, sceneMap || {}); }
  function getAffection(key){ return state.affection[key] || 0; }

  // ヒロインルート単位でリセットして第一シーンから
  function playRoute(heroineKey){
    if (!HEROINES.includes(heroineKey)) return;
    state.affection[heroineKey] = 0;
    state.currentRoute = heroineKey;
    playScene(`${heroineKey}_s1`);
  }

  // タイトルに戻る（進行中ルートはリセットしない：気が変わった時の保険）
  function toTitle(){ showScreen('title'); }

  function playScene(id){
    const scene = state.scenes[id];
    if (!scene){
      console.warn(`[Engine] scene not found: ${id}`);
      return;
    }
    // id のプレフィクスでルート判定
    const prefix = id.split('_')[0];
    if (HEROINES.includes(prefix)) state.currentRoute = prefix;

    state.current = scene;
    state.index = 0;

    // 遷移時に scene の直進ハンドラは必ず解除
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

    speakerEl.textContent = line.who || '';
    speakerEl.className = 'speaker ' + (line.who === 'ナレーション' ? 'narration' : '');
    lineEl.textContent = line.text || '';
    hintEl.style.display = '';
    hintEl.textContent = '▼ クリック／スペースで進む';
  }

  function advance(){
    if (!state.current) return;
    const choicesEl = document.getElementById('choices');
    if (choicesEl.style.display === 'flex') return;  // 選択肢表示中はスキップ
    state.index += 1;
    renderLine();
  }

  // ---------- シーン末尾の処理 ----------
  function showEndOfScene(){
    const scene = state.current;
    const choicesEl = document.getElementById('choices');
    const hintEl    = document.getElementById('next-hint');
    const lineEl    = document.getElementById('line');

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

    // 動的分岐
    if (typeof scene.branch === 'function'){
      const nextId = scene.branch(state);
      if (nextId){
        // 一瞬だけ「…」的な間合いを挟まず、即遷移
        playScene(nextId);
        return;
      }
    }

    // 静的next
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
    // 好感度ポイント反映
    if (choice.points){
      for (const [k, v] of Object.entries(choice.points)){
        state.affection[k] = (state.affection[k] || 0) + v;
      }
      updateAffectionHud();
    }
    if (typeof choice.onPick === 'function') choice.onPick();

    // 次シーン決定：choice.next > scene.branch > scene.next
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
    if (!r){ el.classList.remove('on'); el.textContent = ''; return; }
    el.className = `hud-heart on theme-${r}`;
    el.textContent = `♥ ${NAMES[r] || r}  ${state.affection[r] || 0}`;
  }

  // ---------- イベント配線 ----------
  document.addEventListener('DOMContentLoaded', () => {
    // シーンクリックで行送り
    const sceneEl = document.getElementById('scene');
    sceneEl.addEventListener('click', (e) => {
      if (e.target.closest('.choice')) return;       // 選択肢は個別ハンドラ
      if (e.target.closest('[data-action]')) return; // HUDボタン優先
      if (sceneEl.onclick) return;                   // 直進ハンドラ優先
      advance();
    });

    // キーボードでも進行
    document.addEventListener('keydown', (e) => {
      if (!document.getElementById('scene').classList.contains('active')) return;
      if (e.code === 'Space' || e.code === 'Enter'){
        e.preventDefault();
        advance();
      }
    });

    // data-action による画面/ルート遷移（全画面共通）
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const act = target.dataset.action;
      if (act === 'to-title')   { e.preventDefault(); showScreen('title'); }
      else if (act === 'to-gallery'){ e.preventDefault(); showScreen('gallery'); }
      else if (act === 'route') { e.preventDefault(); playRoute(target.dataset.route); }
    });
  });

  return {
    showScreen, loadScenes, addScenes, playScene, advance,
    playRoute, toTitle, getAffection,
  };
})();


/* ============================================================
 * 起動：URLハッシュがあればその位置から、なければタイトル画面
 *   例) index.html#shiori_s1
 * ============================================================ */
window.addEventListener('load', () => {
  const hash = location.hash.replace('#', '');
  if (hash && Engine.playScene){
    // ハッシュで直接シーンを指定された場合はそこから（デバッグ/試読用）
    Engine.playScene(hash);
  } else {
    Engine.showScreen('title');
  }
});
