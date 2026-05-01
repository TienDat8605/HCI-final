/**
 * app_game_patch.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop-in replacements for two functions in app.js:
 *   1. renderStrengtheningGameScreen()   — full HTML rebuild with new design
 *   2. updateTrainingUI()                — DOM-diff updates (called every frame)
 *
 * HOW TO INTEGRATE
 * ─────────────────────────────────────────────────────────────────────────────
 * Option A — direct paste (recommended):
 *   Replace the existing renderStrengtheningGameScreen and updateTrainingUI
 *   function bodies in app.js with the versions below.
 *
 * Option B — load after app.js:
 *   Add  <script src="app_game_patch.js"></script>  after app.js.
 *   The patch reassigns window-scope functions, which works because app.js
 *   defines them as named function declarations in the global scope.
 *
 * ALSO REQUIRED
 * ─────────────────────────────────────────────────────────────────────────────
 *   • Paste the CSS block at the bottom of this file into your stylesheet
 *     (or into a <style> tag in your HTML, after your existing styles).
 *   • exercise_5_mode.js must be the updated version (with comboStreak /
 *     bestCombo / resultPopup.pts / resultPopup.combo fields).
 */

// ─── 1. renderStrengtheningGameScreen ────────────────────────────────────────
// Replaces the existing function of the same name in app.js.

function renderStrengtheningGameScreen() {
    const exercise = getCurrentExercise();
    const training = appState.training;
    const game = (training && training.gameData) ? training.gameData : {
        markerProgress  : 0,
        cupMl           : 0,
        targetMl        : 250,
        zoneKey         : 'bad',
        zoneLabel       : 'Bad',
        isSqueezing     : false,
        orderProgress   : 0,
        activeOrderIndex: 0,
        comboStreak     : 0,
        orders: [
            { icon: '🍊', targetMl: 250, progress: 0, zoneKey: 'bad', zoneLabel: 'Active', status: 'active' },
            { icon: '🍋', targetMl: 500, progress: 0, zoneKey: 'bad', zoneLabel: 'Wait',   status: 'queue'  },
        ],
        resultPopup: { visible: false, zoneKey: 'bad', title: '', detail: '', pts: null, combo: 0 },
    };

    const markerPoint = getTimingMarkerPosition(game.markerProgress);
    const cupPercent  = clamp((game.cupMl / Math.max(1, game.targetMl)) * 100, 0, 100);
    const popup       = game.resultPopup || { visible: false, zoneKey: 'bad', title: '', detail: '' };
    const gameHud     = (training && training.gameHud) ? training.gameHud : FALLBACK_GAME_HUD;
    const comboStreak = game.comboStreak || 0;
    const showCombo   = comboStreak >= 2;
    const comboLabel  = comboStreak >= 3 ? '×1.5 COMBO' : '×1.2 COMBO';

    return `
        <section class="screen training-screen sg-game-screen">
            <div class="sg-layout">

                <!-- ── Left panel: cup + orders ─────────────────────────── -->
                <aside class="sg-side-panel sg-side-panel--left">

                    <div class="sg-card sg-cup-card ${game.isSqueezing ? 'is-dripping' : ''}" id="juiceTargetCard">
                        <div class="sg-card-kicker">Cup</div>
                        <div class="sg-cup-wrap">
                            <div class="sg-cup-body">
                                <div id="juiceCupFill" class="sg-cup-fill" style="height:${cupPercent}%;"></div>
                                <div class="sg-cup-shine"></div>
                            </div>
                        </div>
                        <div id="juiceCupValue" class="sg-cup-value">
                            ${Math.round(game.cupMl)} / ${game.targetMl} ml
                        </div>
                        <div class="sg-drips" aria-hidden="true" id="sgDrips">
                            <span></span><span></span><span></span>
                        </div>
                    </div>

                    <div class="sg-card">
                        <div class="sg-card-kicker">Orders</div>
                        <div class="sg-order-list" id="juiceOrderList">
                            ${renderJuiceOrders(game.orders, game.activeOrderIndex || 0)}
                        </div>
                    </div>

                </aside>

                <!-- ── Center: camera + timing bar ──────────────────────── -->
                <section class="sg-center-column">

                    <!-- Camera stage -->
                    <div class="sg-stage-shell">
                        <div id="cameraMount" class="stage-mount"></div>
                        <div class="sg-stage-overlay">
                            <div class="sg-stage-header">
                                <div>
                                    <div class="sg-subtitle">Squeeze Game</div>
                                    <h2 class="sg-title">${exercise ? exercise.name : 'Strengthening'}</h2>
                                </div>
                                <div class="sg-status-box">
                                    <span id="trainingCalibrationText" class="sg-status-text">Scanning live hand</span>
                                    <div class="sg-status-caption">Timing bar active</div>
                                </div>
                            </div>

                            <!-- HUD -->
                            <div class="sg-hud">
                                <div class="sg-hud-score">
                                    <span class="sg-hud-label" id="trainingGamePrimaryLabel">${gameHud.primaryLabel}</span>
                                    <strong class="sg-hud-value" id="trainingGamePrimaryValue">${gameHud.primaryValue}</strong>
                                </div>
                                <div class="sg-hud-divider"></div>
                                <div class="sg-hud-order">
                                    <span class="sg-hud-label" id="trainingGameSecondaryLabel">${gameHud.secondaryLabel}</span>
                                    <strong class="sg-hud-value" id="trainingGameSecondaryValue">${gameHud.secondaryValue}</strong>
                                </div>
                                <div class="sg-combo-badge ${showCombo ? 'is-visible' : ''}" id="sgComboBadge">${comboLabel}</div>
                            </div>

                            <div class="sg-stage-footer" id="trainingGameStatusText">${gameHud.statusText}</div>
                        </div>
                    </div>

                    <!-- Timing bar -->
                    <div class="sg-timing-shell" id="sgTimingShell">

                        <!-- Zone bands -->
                        <div class="sg-band sg-band--bad-left"></div>
                        <div class="sg-band sg-band--good-left"></div>
                        <div class="sg-band sg-band--excellent">
                            <span class="sg-band-label">EXCELLENT</span>
                        </div>
                        <div class="sg-band sg-band--good-right"></div>
                        <div class="sg-band sg-band--bad-right"></div>

                        <!-- Marker trail -->
                        <div class="sg-marker-trail" id="sgMarkerTrail"
                             style="width:${markerPoint.x}px;"></div>

                        <!-- Marker -->
                        <div
                            id="juiceTimingMarker"
                            class="sg-marker"
                            data-zone="${game.zoneKey}"
                            style="left:${markerPoint.x}px; top:${markerPoint.y}px;"
                        ></div>

                        <!-- Result popup -->
                        <div
                            id="juiceResultPopup"
                            class="sg-result-popup ${popup.visible ? 'is-visible' : ''}"
                            data-zone="${popup.zoneKey || 'bad'}"
                        >
                            <strong id="juiceResultTitle">${popup.title || ''}</strong>
                            <small  id="juiceResultDetail">${popup.detail || ''}</small>
                            ${popup.pts != null ? `<div class="sg-result-pts" id="juiceResultPts">+${popup.pts} pts</div>` : '<div id="juiceResultPts"></div>'}
                        </div>

                        <!-- Squeeze state -->
                        <div class="sg-squeeze-row">
                            <div id="juiceSqueezeState" class="sg-squeeze-indicator ${game.isSqueezing ? 'is-active' : ''}">
                                <span class="sg-squeeze-dot"></span>
                                <span id="sgSqueezeLabel">${game.isSqueezing ? 'Squeezing' : 'Released'}</span>
                            </div>
                            <div class="sg-intensity-wrap">
                                <div class="sg-intensity-track">
                                    <div class="sg-intensity-fill" id="sgIntFill" style="width:0%;"></div>
                                </div>
                                <span class="sg-intensity-label" id="sgIntLabel">0%</span>
                            </div>
                        </div>

                    </div>
                </section>

            </div>
        </section>
    `;
}


// ─── 2. updateTrainingUI ──────────────────────────────────────────────────────
// Replaces the existing function of the same name in app.js.
// Called every animation frame — touches only DOM nodes that changed.

function updateTrainingUI() {
    const training = appState.training;
    if (!training) return;

    // ── Standard training fields (unchanged from original) ────────────────
    const progressFill  = dom.screenRoot.querySelector('#trainingProgressFill');
    const progressPop   = dom.screenRoot.querySelector('#trainingProgressPop');
    const progressMeta  = dom.screenRoot.querySelector('#trainingProgressMeta');
    const calibration   = dom.screenRoot.querySelector('#trainingCalibrationText');
    const cueTitle      = dom.screenRoot.querySelector('#trainingCueTitle');
    const cueText       = dom.screenRoot.querySelector('#trainingCueText');
    const gameModeTitle = dom.screenRoot.querySelector('#trainingGameModeTitle');

    const progressPercent = getCompletionPercent(training.guideIndex);
    const gameHud         = training.gameHud || FALLBACK_GAME_HUD;
    const gameData        = training.gameData || null;

    if (progressFill) progressFill.style.height = `${progressPercent}%`;
    if (progressPop)  progressPop.textContent   = `${progressPercent}%`;
    if (progressMeta) progressMeta.textContent  = `${progressPercent}% complete`;
    if (calibration)  calibration.textContent   = training.calibrationText;
    if (cueTitle)     cueTitle.textContent      = training.cueText;
    if (cueText)      cueText.textContent       = training.cueDetail;
    if (gameModeTitle) gameModeTitle.textContent = training.gameModeTitle || 'Game Mode';

    // HUD score / order label
    const elPrimaryVal   = dom.screenRoot.querySelector('#trainingGamePrimaryValue');
    const elSecondaryVal = dom.screenRoot.querySelector('#trainingGameSecondaryValue');
    const elStatusText   = dom.screenRoot.querySelector('#trainingGameStatusText');
    if (elPrimaryVal)   elPrimaryVal.textContent   = gameHud.primaryValue;
    if (elSecondaryVal) elSecondaryVal.textContent = gameHud.secondaryValue;
    if (elStatusText)   elStatusText.textContent   = gameHud.statusText;

    if (!gameData) return;

    // ── Strengthening-game-specific DOM updates ───────────────────────────

    // Timing marker
    const timingShell = dom.screenRoot.querySelector('#sgTimingShell');
    const markerEl    = dom.screenRoot.querySelector('#juiceTimingMarker');
    const trailEl     = dom.screenRoot.querySelector('#sgMarkerTrail');

    if (timingShell && markerEl) {
        const w   = timingShell.clientWidth  || 600;
        const h   = timingShell.clientHeight || 80;
        const pt  = getTimingMarkerPosition(gameData.markerProgress, w, h);
        markerEl.style.left  = `${pt.x}px`;
        markerEl.style.top   = `${pt.y}px`;
        markerEl.dataset.zone = gameData.zoneKey || 'bad';
        if (trailEl) trailEl.style.width = `${pt.x}px`;
    }

    // Cup fill
    const cupFill = dom.screenRoot.querySelector('#juiceCupFill');
    const cupVal  = dom.screenRoot.querySelector('#juiceCupValue');
    const targetMl = Math.max(1, gameData.targetMl || 250);
    const cupPct   = clamp((gameData.cupMl / targetMl) * 100, 0, 100);
    if (cupFill) cupFill.style.height = `${cupPct}%`;
    if (cupVal)  cupVal.textContent   = `${Math.round(gameData.cupMl || 0)} / ${targetMl} ml`;

    // Cup card dripping class
    const cupCard = dom.screenRoot.querySelector('#juiceTargetCard');
    if (cupCard) cupCard.classList.toggle('is-dripping', Boolean(gameData.isSqueezing));

    // Drip animations
    const drips = dom.screenRoot.querySelectorAll('#sgDrips span');
    drips.forEach((d) => d.classList.toggle('active', Boolean(gameData.isSqueezing && !gameData.orderResolved)));

    // Order rows
    const orderList = dom.screenRoot.querySelector('#juiceOrderList');
    if (orderList && Array.isArray(gameData.orders)) {
        orderList.querySelectorAll('[data-order-index]').forEach((row) => {
            const index    = Number(row.dataset.orderIndex);
            const order    = gameData.orders[index];
            if (!order) return;
            const isActive = index === gameData.activeOrderIndex;
            const isDone   = order.status === 'done';
            row.classList.toggle('is-active', isActive);
            row.classList.toggle('is-muted',  !isActive && !isDone);
            row.classList.toggle('is-done',    isDone);
            const progEl = row.querySelector('[data-order-progress]');
            const zoneEl = row.querySelector('[data-order-zone]');
            if (progEl) progEl.textContent = `${Math.round(clamp(order.progress || 0, 0, 1) * 100)}%`;
            if (zoneEl) {
                zoneEl.textContent    = order.zoneLabel || (isActive ? 'Active' : 'Wait');
                zoneEl.dataset.zone   = order.zoneKey || 'bad';
            }
        });
    }

    // Squeeze indicator
    const squeezeEl    = dom.screenRoot.querySelector('#juiceSqueezeState');
    const squeezeLbl   = dom.screenRoot.querySelector('#sgSqueezeLabel');
    const intFill      = dom.screenRoot.querySelector('#sgIntFill');
    const intLabel     = dom.screenRoot.querySelector('#sgIntLabel');
    const isSqueezing  = Boolean(gameData.isSqueezing);
    const intPct       = Math.round(clamp((gameData.squeezeIntensity || 0) * 100, 0, 100));

    if (squeezeEl) squeezeEl.classList.toggle('is-active', isSqueezing);
    if (squeezeLbl) squeezeLbl.textContent = isSqueezing ? `Squeezing… ${intPct}%` : 'Released';
    if (intFill)   intFill.style.width  = `${intPct}%`;
    if (intLabel)  intLabel.textContent = `${intPct}%`;

    // Combo badge
    const comboBadge  = dom.screenRoot.querySelector('#sgComboBadge');
    const comboStreak = gameData.comboStreak || 0;
    if (comboBadge) {
        const showCombo  = comboStreak >= 2;
        const comboLabel = comboStreak >= 3 ? '×1.5 COMBO' : '×1.2 COMBO';
        comboBadge.classList.toggle('is-visible', showCombo);
        comboBadge.textContent = comboLabel;
    }

    // Result popup
    const popup       = dom.screenRoot.querySelector('#juiceResultPopup');
    const popupTitle  = dom.screenRoot.querySelector('#juiceResultTitle');
    const popupDetail = dom.screenRoot.querySelector('#juiceResultDetail');
    const popupPts    = dom.screenRoot.querySelector('#juiceResultPts');
    if (popup && gameData.resultPopup) {
        popup.classList.toggle('is-visible', Boolean(gameData.resultPopup.visible));
        popup.dataset.zone = gameData.resultPopup.zoneKey || 'bad';
        if (popupTitle)  popupTitle.textContent  = gameData.resultPopup.title  || '';
        if (popupDetail) popupDetail.textContent = gameData.resultPopup.detail || '';
        if (popupPts) {
            popupPts.textContent = gameData.resultPopup.pts != null
                ? `+${gameData.resultPopup.pts} pts`
                : '';
        }
    }
}
