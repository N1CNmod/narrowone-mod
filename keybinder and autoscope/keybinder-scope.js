// ==UserScript==
// @name         keybinder + visualizer v1.1
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Rebind WASD / Q / Space / Y / Left Click, apply to game input, show visualizer, export/import config, and right-click Scope toggle.
// @author       dodobird1
// @match        https://narrow.one/
// @grant        none
// @run-at       document-idle
// ==/UserScript==


(function () {
  'use strict';

  /*************************************************************************
   * CONFIG
   *************************************************************************/
  const STORAGE_KEY = 'narrow_one_keybinder_config_v3';
  const ACTIONS = ['forward','left','back','right','shoot','melee','jump','perspective'];
  const DEFAULT_BINDINGS = {
    forward: 'KeyW', left: 'KeyA', back: 'KeyS', right: 'KeyD',
    shoot: 'Mouse0', melee: 'KeyQ', jump: 'Space', perspective: 'KeyY'
  };
  const DEFAULT_OPTIONS = { rightClickScope: false };

  /*************************************************************************
   * Basic utilities & dispatch target
   *************************************************************************/
  function loadConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {bindings: {...DEFAULT_BINDINGS}, options: {...DEFAULT_OPTIONS}};
      const parsed = JSON.parse(raw);
      return {
        bindings: Object.assign({}, DEFAULT_BINDINGS, parsed.bindings || {}),
        options: Object.assign({}, DEFAULT_OPTIONS, parsed.options || {})
      };
    } catch (e) {
      console.warn('Failed to load config', e);
      return {bindings: {...DEFAULT_BINDINGS}, options: {...DEFAULT_OPTIONS}};
    }
  }
  function saveConfig(cfg){ localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); }

  const config = loadConfig();
  const bindings = config.bindings;
  const options = config.options;

  function codeToLabel(code){
    if(!code) return '';
    if(code.startsWith('Key')) return code.slice(3);
    if(code.startsWith('Digit')) return code.slice(5);
    if(code === 'Space') return 'SPACE';
    if(code.startsWith('Mouse')){
      const n = parseInt(code.slice(5));
      if(n===0) return 'LMB';
      if(n===1) return 'MMB';
      if(n===2) return 'RMB';
      return 'M'+n;
    }
    return code;
  }

  function codeToKeyAndKeyCode(code){
    if(code === 'Space') return {key:' ', keyCode:32};
    if(code.startsWith('Key')) {
      const ch = code.slice(3);
      return {key: ch.toLowerCase(), keyCode: ch.charCodeAt(0)};
    }
    if(code.startsWith('Digit')) {
      const num = code.slice(5);
      return {key:num, keyCode:num.charCodeAt(0)};
    }
    return {key: code, keyCode: 0};
  }

  // Find dispatch target: prefer pointerLockElement, otherwise first canvas, otherwise document
  function getDispatchTarget(){
    if (document.pointerLockElement) return document.pointerLockElement;
    const canv = document.querySelector('canvas');
    if (canv) return canv;
    return document;
  }

  function simulateKeyboard(code, type='keydown'){
    const {key, keyCode} = codeToKeyAndKeyCode(code);
    const ev = new KeyboardEvent(type, {
      key, code, keyCode, which: keyCode, bubbles: true, cancelable: true
    });
    try { Object.defineProperty(ev, 'keyCode', {value: keyCode}); } catch(e){}
    const target = getDispatchTarget();
    target.dispatchEvent(ev);
  }

  function simulateMouse(button, type='mousedown'){
    const target = getDispatchTarget();
    const ev = new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window, button, buttons: 1 << button,
      clientX: window.innerWidth/2, clientY: window.innerHeight/2
    });
    target.dispatchEvent(ev);
  }

  /*************************************************************************
   * UI - toggle button, rebind panel, export/import
   *************************************************************************/
  let enabled = true;
  let scoping = false;            // whether right-click-scope is active
  let scopeSimulated = false;     // whether we simulated the mousedown for scope (so we'll or won't release)

  function mkbtn(text){ const b=document.createElement('button'); b.innerText=text; Object.assign(b.style, {cursor:'pointer', padding:'6px 8px', borderRadius:'8px', border:'1px solid white', background:'transparent', color:'white'}); return b; }

  // Open button
  const openBtn = document.createElement('div');
  openBtn.innerText = 'Keybinds';
  Object.assign(openBtn.style, {position:'fixed', right:'11px', bottom:'11px', padding:'8px 12px', background:'rgba(0,0,0,0.6)', color:'white', borderRadius:'10px', border:'1px solid white', cursor:'pointer', zIndex:99999, backdropFilter:'blur(6px)', fontSize:'14px', userSelect:'none'});
  document.body.appendChild(openBtn);

  // Panel
  const panel = document.createElement('div');
  panel.classList.add('narrow-rebind-ui');
  Object.assign(panel.style, {position:'fixed', right:'11px', bottom:'60px', width:'420px', maxWidth:'95vw', padding:'12px', background:'rgba(0,0,0,0.75)', color:'white', borderRadius:'12px', border:'1px solid white', zIndex:99999, display:'none', backdropFilter:'blur(8px)'});
  document.body.appendChild(panel);

  const title = document.createElement('div'); title.innerText = 'narrow.one — Key Rebinds'; Object.assign(title.style, {fontWeight:'700', marginBottom:'8px'}); panel.appendChild(title);

  // status toggle
  const statusRow = document.createElement('div'); Object.assign(statusRow.style, {display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px'}); panel.appendChild(statusRow);
  const statusLabel = document.createElement('div'); statusLabel.innerText = 'Enabled:'; statusRow.appendChild(statusLabel);
  const statusToggle = mkbtn(enabled ? 'On':'Off'); statusRow.appendChild(statusToggle);
  statusToggle.addEventListener('click', ()=>{ enabled=!enabled; statusToggle.innerText = enabled ? 'On':'Off'; statusToggle.style.opacity = enabled ? '1':'0.6'; });

  // right-click scope toggle
  const rightClickRow = document.createElement('div'); Object.assign(rightClickRow.style, {display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px'}); panel.appendChild(rightClickRow);
  const rightClickLabel = document.createElement('div'); rightClickLabel.innerText = 'Right-click Scope:'; rightClickRow.appendChild(rightClickLabel);
  const rightClickToggle = mkbtn(options.rightClickScope ? 'On':'Off'); rightClickRow.appendChild(rightClickToggle);
  rightClickToggle.addEventListener('click', ()=>{ options.rightClickScope = !options.rightClickScope; rightClickToggle.innerText = options.rightClickScope ? 'On':'Off'; saveConfig(config); });

  // Action rows
  const rows = document.createElement('div'); Object.assign(rows.style,{display:'grid', gap:'6px', gridTemplateColumns:'1fr'}); panel.appendChild(rows);
  const actionRowEls = {};
  const humanNames = { forward:'Forward (move)', left:'Left (move)', back:'Back (move)', right:'Right (move)', shoot:'Shoot (LMB)', melee:'Melee/Bow', jump:'Jump', perspective:'Perspective' };
  function makeActionRow(action, humanLabel){
    const row = document.createElement('div'); Object.assign(row.style, {display:'flex', justifyContent:'space-between', alignItems:'center', gap:'8px'});
    const left = document.createElement('div'); left.innerText = humanLabel; left.style.width='160px'; row.appendChild(left);
    const bindingLabel = document.createElement('div'); bindingLabel.innerText = codeToLabel(bindings[action] || DEFAULT_BINDINGS[action]); bindingLabel.style.flex='1'; bindingLabel.style.textAlign='center'; row.appendChild(bindingLabel);
    const btnBind = mkbtn('Bind'); const btnClear = mkbtn('Clear');
    const rg = document.createElement('div'); rg.style.display='flex'; rg.style.gap='6px'; rg.appendChild(btnBind); rg.appendChild(btnClear); row.appendChild(rg);
    rows.appendChild(row);
    actionRowEls[action] = {bindingLabel, btnBind, btnClear};
    return {btnBind, btnClear, bindingLabel};
  }
  for(const a of ACTIONS) makeActionRow(a, humanNames[a]||a);

  // bottom controls
  const bottom = document.createElement('div'); Object.assign(bottom.style,{display:'flex', gap:'8px', marginTop:'8px', justifyContent:'space-between'}); panel.appendChild(bottom);
  const exportBtn = mkbtn('Export JSON'); const importBtn = mkbtn('Import JSON'); const resetBtn = mkbtn('Reset'); const saveBtn = mkbtn('Save'); const closeBtn = mkbtn('Close');
  bottom.appendChild(exportBtn); bottom.appendChild(importBtn); bottom.appendChild(resetBtn); bottom.appendChild(saveBtn); bottom.appendChild(closeBtn);

  openBtn.addEventListener('click', ()=>{ panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });
  closeBtn.addEventListener('click', ()=> panel.style.display='none');

  resetBtn.addEventListener('click', ()=>{
    for(const a of ACTIONS) bindings[a] = DEFAULT_BINDINGS[a];
    Object.assign(options, DEFAULT_OPTIONS);
    rightClickToggle.innerText = options.rightClickScope ? 'On':'Off';
    saveConfig(config); refreshActionLabels(); updateVisualizerLabels();
  });

  saveBtn.addEventListener('click', ()=>{
    saveConfig(config); refreshActionLabels(); updateVisualizerLabels(); alert('Saved.');
  });

  // export modal
  function openExportModal(){
    const data = JSON.stringify({bindings, options}, null, 2);
    const modal = document.createElement('div'); Object.assign(modal.style,{position:'fixed', left:'50%', top:'50%', transform:'translate(-50%,-50%)', zIndex:100000, background:'rgba(0,0,0,0.95)', color:'white', padding:'12px', border:'1px solid white', borderRadius:'10px', maxWidth:'90vw', maxHeight:'80vh', overflow:'auto'});
    const heading = document.createElement('div'); heading.innerText='Exported JSON'; heading.style.marginBottom='8px'; modal.appendChild(heading);
    const ta = document.createElement('textarea'); ta.value = data; Object.assign(ta.style,{width:'640px', maxWidth:'80vw', height:'320px', background:'#111', color:'white', padding:'8px'}); modal.appendChild(ta);
    const row = document.createElement('div'); row.style.display='flex'; row.style.gap='8px'; row.style.marginTop='8px';
    const copyBtn = mkbtn('Copy'); copyBtn.addEventListener('click', ()=>{ ta.select(); try{ document.execCommand('copy'); alert('Copied'); }catch(e){ alert('Copy failed'); }});
    const downloadBtn = mkbtn('Download .json'); downloadBtn.addEventListener('click', ()=>{ const blob=new Blob([data], {type:'application/json'}); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='narrow_one_keybindings.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); });
    const close = mkbtn('Close'); close.addEventListener('click', ()=> modal.remove());
    row.appendChild(copyBtn); row.appendChild(downloadBtn); row.appendChild(close);
    modal.appendChild(row); document.body.appendChild(modal);
  }
  exportBtn.addEventListener('click', openExportModal);

  // import modal
  function openImportModal(){
    const modal = document.createElement('div'); Object.assign(modal.style,{position:'fixed', left:'50%', top:'50%', transform:'translate(-50%,-50%)', zIndex:100000, background:'rgba(0,0,0,0.95)', color:'white', padding:'12px', border:'1px solid white', borderRadius:'10px', maxWidth:'90vw', maxHeight:'80vh', overflow:'auto'});
    const heading = document.createElement('div'); heading.innerText='Import JSON'; heading.style.marginBottom='8px'; modal.appendChild(heading);
    const ta = document.createElement('textarea'); ta.placeholder='{"bindings":{...},"options":{...}}'; Object.assign(ta.style,{width:'640px', maxWidth:'80vw', height:'320px', background:'#111', color:'white', padding:'8px'}); modal.appendChild(ta);
    const row = document.createElement('div'); row.style.display='flex'; row.style.gap='8px'; row.style.marginTop='8px';
    const imp = mkbtn('Import'); imp.addEventListener('click', ()=>{
      try {
        const parsed = JSON.parse(ta.value);
        if(parsed.bindings) {
          for(const k of Object.keys(DEFAULT_BINDINGS)) if(parsed.bindings[k]) bindings[k] = parsed.bindings[k];
        }
        if(parsed.options) {
          for(const k of Object.keys(DEFAULT_OPTIONS)) if(typeof parsed.options[k] !== 'undefined') options[k] = parsed.options[k];
        }
        saveConfig(config);
        rightClickToggle.innerText = options.rightClickScope ? 'On':'Off';
        refreshActionLabels(); updateVisualizerLabels();
        alert('Imported.');
        modal.remove();
      } catch(err){ alert('Import failed: ' + err); }
    });
    const close = mkbtn('Close'); close.addEventListener('click', ()=> modal.remove());
    row.appendChild(imp); row.appendChild(close); modal.appendChild(row); document.body.appendChild(modal);
  }
  importBtn.addEventListener('click', openImportModal);

  /*************************************************************************
   * Binding capture
   *************************************************************************/
  let capturingAction = null;
  let capturePrompt = null;
  function beginCapture(action){
    capturingAction = action;
    if(!capturePrompt){
      capturePrompt = document.createElement('div');
      capturePrompt.innerText = 'Press any key or mouse button to bind... (Esc to cancel)';
      Object.assign(capturePrompt.style,{color:'#ffea00', marginTop:'8px', fontWeight:'bold'});
      panel.appendChild(capturePrompt);
    } else capturePrompt.style.display='block';

    function onKey(e){ if(!e.isTrusted) return; if(e.code==='Escape'){ endCapture(true); return; } bindings[capturingAction] = e.code; endCapture(false); }
    function onMouse(e){ if(!e.isTrusted) return; bindings[capturingAction] = 'Mouse' + e.button; e.preventDefault(); e.stopPropagation(); endCapture(false); }

    beginCapture._onKey = onKey; beginCapture._onMouse = onMouse;
    document.addEventListener('keydown', onKey, {capture:true});
    document.addEventListener('mousedown', onMouse, {capture:true});
  }
  function endCapture(cancelled){
    if(beginCapture._onKey) document.removeEventListener('keydown', beginCapture._onKey, {capture:true});
    if(beginCapture._onMouse) document.removeEventListener('mousedown', beginCapture._onMouse, {capture:true});
    capturingAction = null;
    if(capturePrompt) capturePrompt.style.display='none';
    refreshActionLabels();
    if(!cancelled) saveConfig(config);
  }

  for(const a of ACTIONS){
    const {btnBind, btnClear} = actionRowEls[a];
    btnBind.addEventListener('click', (ev)=>{ ev.stopPropagation(); beginCapture(a); });
    btnClear.addEventListener('click', (ev)=>{ ev.stopPropagation(); bindings[a] = null; refreshActionLabels(); saveConfig(config); });
  }

  function refreshActionLabels(){
    for(const a of ACTIONS){
      const el = actionRowEls[a];
      if(!el) continue;
      el.bindingLabel.innerText = codeToLabel(bindings[a] || DEFAULT_BINDINGS[a]);
    }
  }

  /*************************************************************************
   * Visualizer: 3x3 centered square, includes RMB
   *************************************************************************/
  const viz = document.createElement('div');
  Object.assign(viz.style, {
    position:'fixed', right:'11px', bottom:'160px',
    width: '220px', height: '220px',
    padding:'12px', borderRadius:'12px', border:'1px solid white',
    background:'rgba(0,0,0,0.4)', color:'white', zIndex:99990, userSelect:'none',
    display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(8px)'
  });
  document.body.appendChild(viz);

  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display:'grid', gridTemplateColumns:'repeat(3,56px)', gridTemplateRows:'repeat(3,56px)',
    gap:'8px', justifyItems:'center', alignItems:'center'
  });
  viz.appendChild(grid);

  function makeKeyBox(id, title){
    const b = document.createElement('div');
    Object.assign(b.style, {display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', width:'56px', height:'56px', borderRadius:'10px', border:'1px solid white', background:'transparent', fontSize:'12px', textAlign:'center', padding:'4px'});
    b.dataset.keyId = id;
    b.innerHTML = `<div style="font-size:10px;opacity:0.8">${title}</div><div class="label" style="font-weight:700"></div>`;
    return b;
  }

  // 3x3: row1: melee | forward | perspective
  // row2: left | back | right
  // row3: rmb | shoot | space (jump)
  const keyBoxes = {
    forward: makeKeyBox('forward','Forward'),
    left: makeKeyBox('left','Left'),
    back: makeKeyBox('back','Back'),
    right: makeKeyBox('right','Right'),
    melee: makeKeyBox('melee','Melee'),
    jump: makeKeyBox('jump','Jump'),
    perspective: makeKeyBox('persp','Perspective'),
    shoot: makeKeyBox('shoot','Shoot (LMB)'),
    rmb: makeKeyBox('rmb','RMB')
  };

  // Append in 3x3 order
  grid.appendChild(keyBoxes.melee);
  grid.appendChild(keyBoxes.forward);
  grid.appendChild(keyBoxes.perspective);

  grid.appendChild(keyBoxes.left);
  grid.appendChild(keyBoxes.back);
  grid.appendChild(keyBoxes.right);

  grid.appendChild(keyBoxes.rmb);
  grid.appendChild(keyBoxes.shoot);
  grid.appendChild(keyBoxes.jump);

  // real vs simulated pressed maps
  const realPressed = {};       // code -> boolean for real physical presses
  const simulatedPressed = {};  // code -> boolean for simulated presses we created

  function isCodePressed(code){
    // pressed if real OR simulated OR (scoping & code is original shoot)
    const originalShoot = DEFAULT_BINDINGS.shoot;
    return !!(realPressed[code] || simulatedPressed[code] || (scoping && code === originalShoot));
  }

  function updateVisualizerLabels(){
    // update labels and highlight
    for(const a of ACTIONS){
      // map action -> box
      let box = null;
      if(a === 'shoot') box = keyBoxes.shoot;
      else if(a === 'melee') box = keyBoxes.melee;
      else if(a === 'jump') box = keyBoxes.jump;
      else if(a === 'perspective') box = keyBoxes.perspective;
      else if(a === 'forward') box = keyBoxes.forward;
      else if(a === 'left') box = keyBoxes.left;
      else if(a === 'back') box = keyBoxes.back;
      else if(a === 'right') box = keyBoxes.right;
      if(!box) continue;
      const labelEl = box.querySelector('.label');
      const code = bindings[a] || DEFAULT_BINDINGS[a];
      labelEl.innerText = codeToLabel(code);
      box.style.background = isCodePressed(code) ? 'white' : 'transparent';
      box.style.color = isCodePressed(code) ? 'black' : 'white';
    }
    // update RMB box label & highlight (RMB may not be bound to an action)
    const rmbLabel = keyBoxes.rmb.querySelector('.label');
    rmbLabel.innerText = codeToLabel('Mouse2');
    keyBoxes.rmb.style.background = isCodePressed('Mouse2') ? 'white' : 'transparent';
    keyBoxes.rmb.style.color = isCodePressed('Mouse2') ? 'black' : 'white';
  }
  updateVisualizerLabels();

  /*************************************************************************
   * Core remapping & Right-click scoping logic (improved)
   *************************************************************************/
  function findActionForInputCode(code){
    for(const a of ACTIONS){
      const c = bindings[a] || DEFAULT_BINDINGS[a];
      if(c === code) return a;
    }
    return null;
  }

  function startScope(){
    if(scoping) return;
    scoping = true;
    const originalForShoot = DEFAULT_BINDINGS.shoot; // usually 'Mouse0'
    if(originalForShoot && originalForShoot.startsWith('Mouse')){
      // only simulate mousedown if the game expects mouse
      simulateMouse(parseInt(originalForShoot.slice(5)), 'mousedown');
      simulatedPressed[originalForShoot] = true;
      scopeSimulated = true;
    } else if(originalForShoot && originalForShoot.startsWith('Key')){
      simulateKeyboard(originalForShoot, 'keydown');
      simulatedPressed[originalForShoot] = true;
      scopeSimulated = true;
    } else {
      simulateMouse(0, 'mousedown');
      simulatedPressed['Mouse0'] = true;
      scopeSimulated = true;
    }
    updateVisualizerLabels();
  }

  // simulateRelease=true will dispatch synthetic release; false will only clear simulatedPressed flags
  function stopScope(simulateRelease = true){
    if(!scoping) return;
    const originalForShoot = DEFAULT_BINDINGS.shoot;
    scoping = false;
    if(scopeSimulated && simulateRelease){
      if(originalForShoot && originalForShoot.startsWith('Mouse')){
        simulateMouse(parseInt(originalForShoot.slice(5)), 'mouseup');
        simulatedPressed[originalForShoot] = false;
      } else if(originalForShoot && originalForShoot.startsWith('Key')){
        simulateKeyboard(originalForShoot, 'keyup');
        simulatedPressed[originalForShoot] = false;
      } else {
        simulateMouse(0,'mouseup');
        simulatedPressed['Mouse0'] = false;
      }
    } else {
      // Clear simulated pressed flag without sending an event (used when a real LMB up already released it)
      if(originalForShoot && originalForShoot.startsWith('Mouse')) simulatedPressed[originalForShoot] = false;
      else if(originalForShoot && originalForShoot.startsWith('Key')) simulatedPressed[originalForShoot] = false;
      else simulatedPressed['Mouse0'] = false;
    }
    scopeSimulated = false;
    updateVisualizerLabels();
  }

  // KEYDOWN
  function onKeyDown(e){
    if(!e.isTrusted) return;
    if(e.target && e.target.closest && e.target.closest('.narrow-rebind-ui')) return;
    const code = e.code;
    realPressed[code] = true;

    // If scoping and this is the shoot key binding or melee binding -> release scope BEFORE letting the key act
    const currentShootBind = bindings.shoot || DEFAULT_BINDINGS.shoot;
    const currentMeleeBind = bindings.melee || DEFAULT_BINDINGS.melee;
    if(scoping && (code === currentShootBind || code === currentMeleeBind)){
      // release and simulate release so the game state is consistent
      stopScope(true);
      // continue handling event so remap still works
    }

    if(!enabled){ updateVisualizerLabels(); return; }

    const action = findActionForInputCode(code);
    if(!action){ updateVisualizerLabels(); return; }

    const original = DEFAULT_BINDINGS[action];
    if(!original || original === code){ updateVisualizerLabels(); return; }

    e.preventDefault(); e.stopImmediatePropagation();

    if(original.startsWith('Mouse')){
      simulateMouse(parseInt(original.slice(5)), 'mousedown');
      simulatedPressed[original] = true;
    } else {
      simulateKeyboard(original, 'keydown');
      simulatedPressed[original] = true;
    }
    updateVisualizerLabels();
  }

  // KEYUP
  function onKeyUp(e){
    if(!e.isTrusted) return;
    if(e.target && e.target.closest && e.target.closest('.narrow-rebind-ui')) return;
    const code = e.code;
    realPressed[code] = false;

    if(!enabled){ updateVisualizerLabels(); return; }

    const action = findActionForInputCode(code);
    if(!action){ updateVisualizerLabels(); return; }

    const original = DEFAULT_BINDINGS[action];
    if(!original || original === code){ updateVisualizerLabels(); return; }

    e.preventDefault(); e.stopImmediatePropagation();

    if(original.startsWith('Mouse')){
      simulateMouse(parseInt(original.slice(5)), 'mouseup');
      simulatedPressed[original] = false;
    } else {
      simulateKeyboard(original, 'keyup');
      simulatedPressed[original] = false;
    }

    updateVisualizerLabels();
  }

  // MOUSEDOWN
  function onMouseDown(e){
    if(!e.isTrusted) return;
    if(e.target && e.target.closest && e.target.closest('.narrow-rebind-ui')) return;
    const code = 'Mouse' + e.button;
    realPressed[code] = true;

    // Right-click Scope behaviour: only if option enabled and right button
    if(options.rightClickScope && e.button === 2){
      e.preventDefault(); e.stopImmediatePropagation();
      // toggle scope
      if(!scoping) startScope(); else stopScope(true);
      updateVisualizerLabels();
      return;
    }

    // If scoping and left-click occurs: allow the user to physically release the scoping by clicking LMB.
    // We'll let the real click go through, but if they release LMB, we will clear the simulated scope state in onMouseUp.
    // If shoot binding is not Mouse0, prevent real LMB from acting as shoot
    const currentShootBind = bindings.shoot || DEFAULT_BINDINGS.shoot;
    if(e.button === 0 && currentShootBind !== 'Mouse0'){
      // If they physically press LMB while scoping, we allow press but do not treat it as shoot; prevent default to avoid accidental shoot
      e.preventDefault(); e.stopImmediatePropagation();
      updateVisualizerLabels();
      return;
    }

    if(!enabled){ updateVisualizerLabels(); return; }

    // If this mouse button is bound to an action (e.g., user bound melee to RMB), synthesize original
    const action = findActionForInputCode(code);
    if(!action){ updateVisualizerLabels(); return; }

    const original = DEFAULT_BINDINGS[action];
    if(!original || original === code){ updateVisualizerLabels(); return; }

    e.preventDefault(); e.stopImmediatePropagation();
    if(original.startsWith('Mouse')){
      simulateMouse(parseInt(original.slice(5)), 'mousedown');
      simulatedPressed[original] = true;
    } else {
      simulateKeyboard(original, 'keydown');
      simulatedPressed[original] = true;
    }

    updateVisualizerLabels();
  }

  // MOUSEUP
  function onMouseUp(e){
    if(!e.isTrusted) return;
    if(e.target && e.target.closest && e.target.closest('.narrow-rebind-ui')) return;
    const code = 'Mouse' + e.button;
    realPressed[code] = false;

    // If right-click scope option enabled and this is right button, swallow to avoid contextmenu side effects
    if(options.rightClickScope && e.button === 2){
      e.preventDefault(); e.stopImmediatePropagation();
      // Already handled on mousedown (toggle), no further action
      // ensure visual mark for RMB cleared
      updateVisualizerLabels();
      return;
    }

    // If scoping and the user physically released LMB, the game may have released the arrow.
    // To keep display consistent, treat a real LMB release as an intent to stop scope.
    if(scoping && e.button === 0){
      // don't dispatch a synthetic release (real mouseup already happened in the browser), just clear simulated state
      stopScope(false); // false = do not simulate release event
      updateVisualizerLabels();
      // allow normal propagation (do not prevent) so the real mouseup is processed by the game
      return;
    }

    if(!enabled){ updateVisualizerLabels(); return; }

    const action = findActionForInputCode(code);
    if(!action){ updateVisualizerLabels(); return; }

    const original = DEFAULT_BINDINGS[action];
    if(!original || original === code){ updateVisualizerLabels(); return; }

    e.preventDefault(); e.stopImmediatePropagation();
    if(original.startsWith('Mouse')){
      simulateMouse(parseInt(original.slice(5)), 'mouseup');
      simulatedPressed[original] = false;
    } else {
      simulateKeyboard(original, 'keyup');
      simulatedPressed[original] = false;
    }

    updateVisualizerLabels();
  }

  // Attach listeners (capture) so we can prevent default early
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mouseup', onMouseUp, true);

  // Prevent context menu globally during gameplay, but allow over UI
  document.addEventListener('contextmenu', (e)=>{
    if(e.target && e.target.closest && e.target.closest('.narrow-rebind-ui')) return;
    if(options.rightClickScope) { e.preventDefault(); } else { e.preventDefault(); }
  }, true);

  // Clear pressed state on blur
  window.addEventListener('blur', ()=>{
    for(const k in realPressed) realPressed[k] = false;
    for(const k in simulatedPressed) simulatedPressed[k] = false;
    scoping = false; scopeSimulated = false;
    updateVisualizerLabels();
  });

  // Keep visual updated
  setInterval(updateVisualizerLabels, 100);

  /*************************************************************************
   * Initial sync and helpers
   *************************************************************************/
  refreshActionLabels();
  updateVisualizerLabels();
  rightClickToggle.innerText = options.rightClickScope ? 'On':'Off';

  window.__narrow_rebind = {
    config,
    saveConfig: ()=> saveConfig(config),
    loadConfig: ()=> Object.assign(config, loadConfig()),
    resetToDefaults: ()=> { for(const a of ACTIONS) bindings[a]=DEFAULT_BINDINGS[a]; Object.assign(options, DEFAULT_OPTIONS); saveConfig(config); refreshActionLabels(); updateVisualizerLabels(); }
  };

  console.log('narrow.one Keybinder + Visualizer v1.3 loaded (scope & visual fixes).');

})();
