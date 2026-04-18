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
 *     // 全lines表示後に出す分岐。なければ next: "s2" で直進
 *     choices: [
 *       { label: "声をかける", next: "s2" },
 *       { label: "無視する",   next: "s3" }
 *     ],
 *     next: "s2"
 *   }
 * ============================================================ */

const Engine = (() => {
  // ---------- 画面切り替え ----------
  function showScreen(id){
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }

  // ---------- シーン状態 ----------
  const state = {
    scenes: {},     // id -> scene
    current: null,  // 現在のシーンオブジェクト
    index: 0,       // 現在の行インデックス
  };

  function loadScenes(sceneMap){
    state.scenes = sceneMap || {};
  }

  // 複数ファイルから追記したい時に使う
  function addScenes(sceneMap){
    Object.assign(state.scenes, sceneMap || {});
  }

  function playScene(id){
    const scene = state.scenes[id];
    if (!scene){
      console.warn(`[Engine] scene not found: ${id}`);
      return;
    }
    state.current = scene;
    state.index = 0;
    showScreen('scene');
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

    const line = scene.lines[state.index];
    if (!line){
      // 全行終わり → 分岐 or next
      showEndOfScene();
      return;
    }

    // 話者装飾：ナレーションは控えめに
    speakerEl.textContent = line.who || '';
    speakerEl.className = 'speaker ' + (line.who === 'ナレーション' ? 'narration' : '');
    lineEl.textContent = line.text || '';
    hintEl.style.display = '';
  }

  function advance(){
    const scene = state.current;
    if (!scene) return;
    // 選択肢表示中は進まない
    const choicesEl = document.getElementById('choices');
    if (choicesEl.style.display === 'flex') return;

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
      // 選択肢UI表示
      lineEl.textContent = scene.prompt || '…どうする？';
      hintEl.style.display = 'none';
      choicesEl.innerHTML = '';
      choicesEl.style.display = 'flex';
      scene.choices.forEach((c, i) => {
        const btn = document.createElement('button');
        btn.className = 'choice';
        btn.type = 'button';
        btn.textContent = c.label;
        btn.addEventListener('click', () => onChoose(c));
        choicesEl.appendChild(btn);
      });
    } else if (scene.next){
      // 直進：クリックで次シーンへ
      hintEl.textContent = '▼ クリックで次へ';
      document.getElementById('scene').onclick = () => {
        document.getElementById('scene').onclick = null;
        playScene(scene.next);
      };
    } else {
      hintEl.textContent = '（ここで終わり）';
    }
  }

  function onChoose(choice){
    // 分岐記録用フック（必要になれば拡張）
    if (typeof choice.onPick === 'function') choice.onPick();
    if (choice.next) playScene(choice.next);
  }

  // ---------- クリックで進行 ----------
  document.addEventListener('DOMContentLoaded', () => {
    const sceneEl = document.getElementById('scene');
    // sceneEl 自体のクリックで advance（ただし .choice ボタンのクリックはバブリングで来てもOK、選択肢UI表示中は advance が無視する）
    sceneEl.addEventListener('click', (e) => {
      // 選択肢ボタン押下時は advance させない
      if (e.target.closest('.choice')) return;
      // scene の直進ハンドラがセットされている場合はそれ優先（重複発火を防ぐ）
      if (sceneEl.onclick) return;
      advance();
    });
    // スペース/エンターでも進む
    document.addEventListener('keydown', (e) => {
      if (!document.getElementById('scene').classList.contains('active')) return;
      if (e.code === 'Space' || e.code === 'Enter'){
        e.preventDefault();
        advance();
      }
    });
  });

  return { showScreen, loadScenes, addScenes, playScene, advance };
})();


/* ============================================================
 * 起動：URLハッシュで再生シーンを切り替え
 *   例) index.html#shiori_s1
 *   未指定なら misaki_s1 を再生
 *
 *   scenarios/*.js の読み込み完了後に起動させるため、
 *   DOMContentLoaded ではなく load を使う
 * ============================================================ */
window.addEventListener('load', () => {
  const startId = (location.hash || '#misaki_s1').replace('#','');
  Engine.playScene(startId);
});
