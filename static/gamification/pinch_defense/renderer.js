(function initPinchDefenseRenderer(globalObject) {
    'use strict';

    const PIXI_CDN_URLS = [
        'https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.min.js',
        'https://unpkg.com/pixi.js@7.4.2/dist/pixi.min.js',
    ];
    const PLAYER_WIDTH_RATIO = 0.17;
    const PLAYER_HEIGHT_RATIO = 0.31;
    const ENEMY_SIZE_RATIO = 0.085;
    const SEQUENCE_FONT_RATIO = 0.048;
    const SEQUENCE_Y_OFFSET_RATIO = 0.14;
    const SEQUENCE_SPACING_RATIO = 0.04;
    const PLAYER_HIT_FLASH_MS = 320;
    const ENEMY_HIT_FLASH_MS = 220;
    const ENEMY_FADE_MS = 520;
    const HEART_SIZE = 30;

    function getShapeEntity(shape) {
        if (shape === 'triangle') return '\u25B2';
        if (shape === 'square') return '\u25A0';
        if (shape === 'diamond') return '\u25C6';
        return '\u25CF';
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function colorToNumber(color) {
        if (!color || color[0] !== '#') {
            return 0xffffff;
        }
        return Number.parseInt(color.slice(1), 16);
    }

    function loadPixi() {
        if (globalObject.PIXI) {
            return Promise.resolve(globalObject.PIXI);
        }
        if (globalObject.__pinchDefensePixiPromise) {
            return globalObject.__pinchDefensePixiPromise;
        }

        let fallbackPromise = Promise.reject(new Error('PixiJS not loaded yet.'));
        PIXI_CDN_URLS.forEach((source) => {
            fallbackPromise = fallbackPromise.catch(() => new Promise((resolve, reject) => {
                const existingScript = document.querySelector(`script[data-pinch-defense-pixi="${source}"]`);
                if (existingScript) {
                    existingScript.addEventListener('load', () => {
                        if (globalObject.PIXI) {
                            resolve(globalObject.PIXI);
                        } else {
                            reject(new Error('PixiJS loaded without namespace.'));
                        }
                    }, { once: true });
                    existingScript.addEventListener('error', () => reject(new Error(`Failed to load ${source}`)), { once: true });
                    return;
                }

                const script = document.createElement('script');
                script.src = source;
                script.async = true;
                script.dataset.pinchDefensePixi = source;
                script.onload = () => {
                    if (globalObject.PIXI) {
                        resolve(globalObject.PIXI);
                    } else {
                        reject(new Error('PixiJS loaded without namespace.'));
                    }
                };
                script.onerror = () => reject(new Error(`Failed to load ${source}`));
                document.head.appendChild(script);
            }));
        });

        globalObject.__pinchDefensePixiPromise = fallbackPromise.catch((error) => {
            globalObject.__pinchDefensePixiPromise = null;
            throw error;
        });
        return globalObject.__pinchDefensePixiPromise;
    }

    function createRenderer(config, assetStore) {
        const runtime = {
            container: null,
            root: null,
            stageHost: null,
            guide: null,
            releaseCue: null,
            fallbackNotice: null,
            lastViewState: null,
            lastStageWidth: 0,
            lastStageHeight: 0,
            pixi: null,
            app: null,
            stage: null,
            backgroundLayer: null,
            actorLayer: null,
            enemyLayer: null,
            overlayLayer: null,
            playerDisplay: null,
            heartDisplay: null,
            transientText: null,
            hitOverlay: null,
            enemyDisplays: {},
            resizeObserver: null,
            pixiReadyPromise: null,
        };

        function ensureFallbackNotice() {
            if (runtime.fallbackNotice) {
                return runtime.fallbackNotice;
            }
            const notice = document.createElement('div');
            notice.className = 'pinch-defense-fallback';
            notice.textContent = 'PixiJS could not load, so the lane renderer is unavailable.';
            runtime.root.appendChild(notice);
            runtime.fallbackNotice = notice;
            return notice;
        }

        function setFallbackVisible(isVisible) {
            if (!runtime.root) {
                return;
            }
            const notice = isVisible ? ensureFallbackNotice() : runtime.fallbackNotice;
            if (notice) {
                notice.style.display = isVisible ? 'grid' : 'none';
            }
        }

        function getStageSize() {
            if (!runtime.stageHost) {
                return { width: 1, height: 1 };
            }
            const rect = runtime.stageHost.getBoundingClientRect();
            return {
                width: Math.max(1, Math.round(rect.width)),
                height: Math.max(1, Math.round(rect.height)),
            };
        }

        function resolveStageSize() {
            if (!runtime.app) {
                return;
            }
            const { width, height } = getStageSize();
            if (width === runtime.lastStageWidth && height === runtime.lastStageHeight) {
                return;
            }
            runtime.lastStageWidth = width;
            runtime.lastStageHeight = height;
            runtime.app.renderer.resize(width, height);
            drawBackground(width, height);
        }

        function createVectorTexture(width, height, drawCallback) {
            const graphics = new runtime.pixi.Graphics();
            drawCallback(graphics);
            const texture = runtime.app.renderer.generateTexture(graphics, {
                resolution: Math.max(1, globalObject.devicePixelRatio || 1),
                region: new runtime.pixi.Rectangle(0, 0, width, height),
            });
            graphics.destroy();
            return texture;
        }

        function getTexture(assetId, fallbackFactory) {
            const image = assetStore.getImage(assetId);
            if (image) {
                return runtime.pixi.Texture.from(image);
            }
            return fallbackFactory();
        }

        function getHeartTexture(isFull) {
            return getTexture(isFull ? 'heart_full' : 'heart_empty', () => createVectorTexture(64, 58, (graphics) => {
                graphics.beginFill(isFull ? 0xef4444 : 0x94a3b8, isFull ? 1 : 0.38);
                graphics.moveTo(32, 54);
                graphics.bezierCurveTo(10, 38, 4, 18, 18, 8);
                graphics.bezierCurveTo(28, 2, 36, 12, 32, 18);
                graphics.bezierCurveTo(28, 12, 36, 2, 46, 8);
                graphics.bezierCurveTo(60, 18, 54, 38, 32, 54);
                graphics.endFill();
            }));
        }

        function drawBackground(width, height) {
            if (!runtime.backgroundLayer) {
                return;
            }
            runtime.backgroundLayer.removeChildren().forEach((child) => child.destroy());

            const base = new runtime.pixi.Graphics();
            base.beginFill(0x0c1229);
            base.drawRect(0, 0, width, height);
            base.endFill();
            runtime.backgroundLayer.addChild(base);

            for (let index = 0; index < 6; index += 1) {
                const radius = (width * 0.18) + index * 26;
                const ring = new runtime.pixi.Graphics();
                ring.beginFill(0x59a7ff, 0.08);
                ring.drawCircle(width * 0.72, height * 0.2, radius);
                ring.endFill();
                runtime.backgroundLayer.addChild(ring);
            }

            const laneGlow = new runtime.pixi.Graphics();
            laneGlow.beginFill(0xffffff, 0.12);
            laneGlow.drawRoundedRect(width * 0.08, height * 0.73, width * 0.84, height * 0.012, 4);
            laneGlow.endFill();
            runtime.backgroundLayer.addChild(laneGlow);

            const lane = new runtime.pixi.Graphics();
            lane.beginFill(0x8599b6, 0.3);
            lane.drawRoundedRect(width * 0.08, height * 0.742, width * 0.84, height * 0.12, 18);
            lane.endFill();
            runtime.backgroundLayer.addChild(lane);
        }

        function createPlayerDisplay() {
            const container = new runtime.pixi.Container();

            const glow = new runtime.pixi.Graphics();
            glow.visible = false;
            container.addChild(glow);

            const normalTexture = getTexture('witch_normal', () => createVectorTexture(120, 150, (graphics) => {
                graphics.beginFill(0xe2e8f0);
                graphics.drawCircle(60, 36, 18);
                graphics.endFill();
                graphics.beginFill(0x2563eb);
                graphics.moveTo(26, 144);
                graphics.lineTo(60, 28);
                graphics.lineTo(96, 144);
                graphics.closePath();
                graphics.endFill();
            }));
            const raiseTexture = getTexture('witch_raise', () => normalTexture);

            const body = new runtime.pixi.Sprite(normalTexture);
            body.anchor.set(0.5, 0.58);
            container.addChild(body);

            const damageOverlay = new runtime.pixi.Sprite(normalTexture);
            damageOverlay.anchor.set(0.5, 0.58);
            damageOverlay.tint = 0xff5c5c;
            damageOverlay.alpha = 0;
            container.addChild(damageOverlay);

            container.body = body;
            container.damageOverlay = damageOverlay;
            container.glow = glow;
            container.normalTexture = normalTexture;
            container.raiseTexture = raiseTexture;
            runtime.actorLayer.addChild(container);
            runtime.playerDisplay = container;
            return container;
        }

        function ensureHeartDisplay() {
            if (runtime.heartDisplay) {
                return runtime.heartDisplay;
            }

            const container = new runtime.pixi.Container();
            container.sprites = [];
            runtime.overlayLayer.addChild(container);
            runtime.heartDisplay = container;
            return container;
        }

        function createSequenceText(symbol, color) {
            return new runtime.pixi.Text(symbol, {
                fontFamily: '"Space Grotesk", sans-serif',
                fontSize: 24,
                fontWeight: '700',
                fill: color,
                stroke: '#ffffff',
                strokeThickness: 2,
            });
        }

        function createEnemyDisplay(enemy) {
            const container = new runtime.pixi.Container();
            container.sortableChildren = true;

            const shadow = new runtime.pixi.Graphics();
            shadow.beginFill(0x07101f, 0.32);
            shadow.drawEllipse(0, 0, 26, 10);
            shadow.endFill();
            shadow.y = 48;
            shadow.zIndex = 0;
            container.addChild(shadow);

            const texture = getTexture(enemy.assetId, () => createVectorTexture(88, 88, (graphics) => {
                const fill = enemy.type === 'ghost'
                    ? 0xe2e8f0
                    : (enemy.type === 'slime' ? 0x34d399 : 0xfda4af);
                graphics.beginFill(fill);
                graphics.drawCircle(44, 44, 30);
                graphics.endFill();
            }));

            const body = new runtime.pixi.Sprite(texture);
            body.anchor.set(0.5, 0.58);
            body.zIndex = 1;
            container.addChild(body);

            const damageOverlay = new runtime.pixi.Sprite(texture);
            damageOverlay.anchor.set(0.5, 0.58);
            damageOverlay.tint = 0xff5c5c;
            damageOverlay.alpha = 0;
            damageOverlay.zIndex = 2;
            container.addChild(damageOverlay);

            const sequence = new runtime.pixi.Container();
            sequence.zIndex = 3;
            container.addChild(sequence);

            const display = {
                container,
                shadow,
                body,
                damageOverlay,
                sequence,
                isDying: false,
                dyingMs: ENEMY_FADE_MS,
                maxDyingMs: ENEMY_FADE_MS,
                seen: false,
            };

            runtime.enemyLayer.addChild(container);
            runtime.enemyDisplays[enemy.id] = display;
            return display;
        }

        function destroyEnemyDisplay(enemyId) {
            const display = runtime.enemyDisplays[enemyId];
            if (!display) {
                return;
            }
            if (display.container.parent) {
                display.container.parent.removeChild(display.container);
            }
            display.container.destroy({ children: true });
            delete runtime.enemyDisplays[enemyId];
        }

        function syncEnemySequence(display, enemy, stageWidth) {
            display.sequence.removeChildren().forEach((child) => child.destroy());
            const pendingSequence = enemy.sequence.slice(enemy.currentStep);
            const symbolSpacing = Math.max(24, stageWidth * SEQUENCE_SPACING_RATIO);
            const symbolFontSize = Math.max(24, Math.round(stageWidth * SEQUENCE_FONT_RATIO));
            pendingSequence.forEach((fingerId, index) => {
                const fingerConfig = config.fingers[fingerId];
                const symbol = createSequenceText(getShapeEntity(fingerConfig.shape), fingerConfig.color);
                symbol.style.fontSize = symbolFontSize;
                symbol.anchor.set(0.5, 0.5);
                symbol.x = (index * symbolSpacing) - ((pendingSequence.length - 1) * symbolSpacing * 0.5);
                display.sequence.addChild(symbol);
            });
        }

        function syncPlayer(viewState, width, height) {
            const player = runtime.playerDisplay || createPlayerDisplay();
            const elapsedSeconds = runtime.app.ticker.lastTime / 1000;
            const drawWidth = width * PLAYER_WIDTH_RATIO;
            const drawHeight = height * PLAYER_HEIGHT_RATIO;
            const raiseFingerId = viewState.confirmedFinger || viewState.activeFinger || null;
            const glowColor = raiseFingerId && config.fingers[raiseFingerId]
                ? colorToNumber(config.fingers[raiseFingerId].color)
                : 0x60a5fa;
            const playerHitAlpha = clamp((viewState.playerHitFlashMs || 0) / PLAYER_HIT_FLASH_MS, 0, 1);

            player.position.set(width * 0.18, height * 0.58 + (Math.sin(elapsedSeconds * 2.4) * 4));
            player.body.texture = raiseFingerId ? player.raiseTexture : player.normalTexture;
            player.body.width = drawWidth;
            player.body.height = drawHeight;

            player.damageOverlay.texture = player.body.texture;
            player.damageOverlay.width = drawWidth;
            player.damageOverlay.height = drawHeight;
            player.damageOverlay.alpha = playerHitAlpha * 0.32;

            player.glow.clear();
            if (raiseFingerId) {
                const pulse = 0.18 + (Math.sin(elapsedSeconds * 6) * 0.05);
                player.glow.beginFill(glowColor, pulse);
                player.glow.drawEllipse(0, 8, drawWidth * 0.42, drawHeight * 0.36);
                player.glow.endFill();
                player.glow.visible = true;
            } else {
                player.glow.visible = false;
            }
        }

        function syncHearts(viewState) {
            const heartDisplay = ensureHeartDisplay();
            const totalHearts = Array.isArray(viewState.hearts) ? viewState.hearts.length : 0;
            while (heartDisplay.sprites.length < totalHearts) {
                const sprite = new runtime.pixi.Sprite(getHeartTexture(true));
                sprite.anchor.set(0, 0);
                heartDisplay.addChild(sprite);
                heartDisplay.sprites.push(sprite);
            }
            while (heartDisplay.sprites.length > totalHearts) {
                const sprite = heartDisplay.sprites.pop();
                heartDisplay.removeChild(sprite);
                sprite.destroy();
            }

            heartDisplay.position.set(24, 20);
            heartDisplay.sprites.forEach((sprite, index) => {
                const isFull = Boolean(viewState.hearts[index]);
                sprite.texture = getHeartTexture(isFull);
                sprite.width = HEART_SIZE;
                sprite.height = Math.round(HEART_SIZE * 0.91);
                sprite.x = index * (HEART_SIZE + 8);
                sprite.y = 0;
                sprite.alpha = isFull ? 1 : 0.72;
            });
        }

        function syncHitOverlay(viewState, width, height) {
            if (!runtime.hitOverlay) {
                runtime.hitOverlay = new runtime.pixi.Graphics();
                runtime.overlayLayer.addChild(runtime.hitOverlay);
            }

            const alpha = clamp((viewState.playerHitFlashMs || 0) / PLAYER_HIT_FLASH_MS, 0, 1) * 0.18;
            runtime.hitOverlay.clear();
            if (alpha <= 0.001) {
                return;
            }

            runtime.hitOverlay.beginFill(0xff3b3b, alpha);
            runtime.hitOverlay.drawRect(0, 0, width, height);
            runtime.hitOverlay.endFill();
        }

        function syncEnemies(viewState, width, height) {
            const laneStart = width * 0.2;
            const laneWidth = width * 0.68;
            const baseY = height * 0.55;
            const elapsedSeconds = runtime.app.ticker.lastTime / 1000;
            const deltaMs = runtime.app.ticker.deltaMS || 16.67;
            const enemySize = Math.max(56, width * ENEMY_SIZE_RATIO);
            const sequenceYOffset = Math.max(72, height * SEQUENCE_Y_OFFSET_RATIO);

            Object.values(runtime.enemyDisplays).forEach((display) => {
                display.seen = false;
            });

            viewState.enemies.forEach((enemy, index) => {
                const display = runtime.enemyDisplays[enemy.id] || createEnemyDisplay(enemy);
                const x = laneStart + enemy.x * laneWidth;
                const bob = Math.sin((elapsedSeconds * 3.6) + index) * 6;
                const knockback = enemy.knockbackMs > 0 ? 10 * Math.min(1, enemy.knockbackMs / 180) : 0;
                const hitAlpha = clamp((enemy.hitFlashMs || 0) / ENEMY_HIT_FLASH_MS, 0, 1);

                display.seen = true;
                display.isDying = false;
                display.dyingMs = display.maxDyingMs;
                display.container.alpha = 1;
                display.container.position.set(x + knockback, baseY + bob);
                display.container.scale.set(enemy.hitFlashMs > 0 ? 1.05 : 1);

                display.body.texture = getTexture(enemy.assetId, () => display.body.texture);
                display.body.width = enemySize;
                display.body.height = enemySize;
                display.body.rotation = Math.sin((elapsedSeconds * 2.1) + index) * 0.05;

                display.damageOverlay.texture = display.body.texture;
                display.damageOverlay.width = enemySize;
                display.damageOverlay.height = enemySize;
                display.damageOverlay.alpha = hitAlpha * 0.28;

                display.shadow.scale.x = (enemySize / 88) * (1 + (Math.sin((elapsedSeconds * 2.4) + index) * 0.08));
                display.shadow.scale.y = enemySize / 88;
                display.shadow.alpha = 0.28 + (Math.sin((elapsedSeconds * 2.4) + index) * 0.04);
                display.sequence.y = -sequenceYOffset;
                syncEnemySequence(display, enemy, width);
            });

            Object.entries(runtime.enemyDisplays).forEach(([enemyId, display]) => {
                if (display.seen) {
                    return;
                }

                if (!display.isDying) {
                    display.isDying = true;
                    display.dyingMs = display.maxDyingMs;
                    display.body.rotation = 0;
                    display.damageOverlay.alpha = 0;
                }

                display.dyingMs -= deltaMs;
                display.container.alpha = clamp(display.dyingMs / display.maxDyingMs, 0, 1);
                display.container.scale.set(0.96 + (display.container.alpha * 0.04));
                display.sequence.alpha = display.container.alpha;
                display.shadow.alpha = display.container.alpha * 0.24;

                if (display.dyingMs <= 0) {
                    destroyEnemyDisplay(enemyId);
                }
            });
        }

        function syncTransient(viewState, width, height) {
            if (!runtime.transientText) {
                runtime.transientText = new runtime.pixi.Text('', {
                    fontFamily: '"Space Grotesk", sans-serif',
                    fontSize: 28,
                    fontWeight: '700',
                    fill: '#fef08a',
                });
                runtime.overlayLayer.addChild(runtime.transientText);
            }
            runtime.transientText.text = viewState.transientText || '';
            runtime.transientText.visible = Boolean(viewState.transientText);
            runtime.transientText.position.set(width * 0.44, height * 0.2);
        }

        function drawStage(viewState) {
            if (!runtime.app) {
                return;
            }

            resolveStageSize();
            const width = runtime.app.renderer.width;
            const height = runtime.app.renderer.height;
            syncPlayer(viewState, width, height);
            syncEnemies(viewState, width, height);
            syncHearts(viewState);
            syncTransient(viewState, width, height);
            syncHitOverlay(viewState, width, height);
        }

        function updateGuide(viewState) {
            if (!runtime.guide) {
                return;
            }
            runtime.guide.innerHTML = config.fingerOrder.map((fingerId) => {
                const fingerConfig = config.fingers[fingerId];
                const fingerState = viewState.detectorStates[fingerId] || {};
                const classes = [
                    'pinch-defense-finger',
                    viewState.activeFinger === fingerId ? 'is-active' : '',
                    viewState.confirmedFinger === fingerId ? 'is-confirmed' : '',
                    fingerState.assisted ? 'is-assisted' : '',
                ].filter(Boolean).join(' ');
                const status = fingerState.state || 'idle';
                return `
                    <div class="${classes}" style="--finger-color:${fingerConfig.color}; --finger-glow:${fingerConfig.glow};">
                        <span class="pinch-defense-finger-symbol">${getShapeEntity(fingerConfig.shape)}</span>
                        <span>${fingerConfig.label}</span>
                        <b>${status.toUpperCase()}</b>
                    </div>
                `;
            }).join('');
        }

        function updateReleaseCue(viewState) {
            if (!runtime.releaseCue) {
                return;
            }
            runtime.releaseCue.classList.toggle('is-visible', Boolean(viewState.pendingRelease));
        }

        function ensurePixiStage() {
            if (runtime.pixiReadyPromise) {
                return runtime.pixiReadyPromise;
            }

            runtime.pixiReadyPromise = Promise.all([
                loadPixi(),
                assetStore.ensureLoaded(),
            ]).then(([pixi]) => {
                if (runtime.app) {
                    return runtime.app;
                }

                runtime.pixi = pixi;
                runtime.app = new pixi.Application({
                    antialias: true,
                    autoDensity: true,
                    backgroundAlpha: 0,
                    resolution: Math.max(1, globalObject.devicePixelRatio || 1),
                });

                runtime.stageHost.innerHTML = '';
                runtime.stageHost.appendChild(runtime.app.view);
                runtime.app.view.classList.add('pinch-defense-canvas');

                runtime.stage = new pixi.Container();
                runtime.backgroundLayer = new pixi.Container();
                runtime.actorLayer = new pixi.Container();
                runtime.enemyLayer = new pixi.Container();
                runtime.overlayLayer = new pixi.Container();

                runtime.stage.addChild(runtime.backgroundLayer);
                runtime.stage.addChild(runtime.actorLayer);
                runtime.stage.addChild(runtime.enemyLayer);
                runtime.stage.addChild(runtime.overlayLayer);
                runtime.app.stage.addChild(runtime.stage);

                if (typeof ResizeObserver === 'function') {
                    runtime.resizeObserver = new ResizeObserver(() => {
                        resolveStageSize();
                        if (runtime.lastViewState) {
                            drawStage(runtime.lastViewState);
                        }
                    });
                    runtime.resizeObserver.observe(runtime.stageHost);
                }

                runtime.app.ticker.add(() => {
                    if (runtime.lastViewState) {
                        drawStage(runtime.lastViewState);
                    }
                });

                resolveStageSize();
                setFallbackVisible(false);
                if (runtime.lastViewState) {
                    drawStage(runtime.lastViewState);
                }
                return runtime.app;
            }).catch((error) => {
                console.error('[pinch_defense] PixiJS renderer failed', error);
                setFallbackVisible(true);
                return null;
            });

            return runtime.pixiReadyPromise;
        }

        function buildRoot() {
            const root = document.createElement('div');
            root.className = 'pinch-defense-root';
            root.innerHTML = `
                <div class="pinch-defense-pixi-host"></div>
                <div class="pinch-defense-guide"></div>
                <div class="pinch-defense-release-cue" aria-hidden="true">
                    <span class="pinch-release-arrow is-left"></span>
                    <span class="pinch-release-hand"></span>
                    <span class="pinch-release-arrow is-right"></span>
                </div>
            `;

            runtime.root = root;
            runtime.stageHost = root.querySelector('.pinch-defense-pixi-host');
            runtime.guide = root.querySelector('.pinch-defense-guide');
            runtime.releaseCue = root.querySelector('.pinch-defense-release-cue');
        }

        function mount(container) {
            if (runtime.container === container && runtime.root) {
                return;
            }
            runtime.container = container;
            if (!runtime.root) {
                buildRoot();
            }
            container.innerHTML = '';
            container.appendChild(runtime.root);
            ensurePixiStage();
            if (runtime.lastViewState) {
                update(runtime.lastViewState);
            }
        }

        function unmount() {
            if (runtime.resizeObserver) {
                runtime.resizeObserver.disconnect();
                runtime.resizeObserver = null;
            }
            Object.keys(runtime.enemyDisplays).forEach(destroyEnemyDisplay);
            runtime.enemyDisplays = {};
            runtime.playerDisplay = null;
            runtime.heartDisplay = null;
            runtime.transientText = null;
            runtime.hitOverlay = null;
            runtime.stage = null;
            runtime.backgroundLayer = null;
            runtime.actorLayer = null;
            runtime.enemyLayer = null;
            runtime.overlayLayer = null;
            runtime.lastStageWidth = 0;
            runtime.lastStageHeight = 0;

            if (runtime.app) {
                runtime.app.destroy(true, { children: true });
                runtime.app = null;
            }

            if (runtime.root && runtime.root.parentNode) {
                runtime.root.parentNode.removeChild(runtime.root);
            }
            runtime.container = null;
            runtime.pixiReadyPromise = null;
        }

        function update(viewState) {
            runtime.lastViewState = viewState;
            if (!runtime.root) {
                return;
            }
            updateGuide(viewState);
            updateReleaseCue(viewState);
            if (runtime.app) {
                drawStage(viewState);
            } else {
                ensurePixiStage();
            }
        }

        return {
            mount,
            unmount,
            update,
        };
    }

    globalObject.PinchDefenseRenderer = {
        createRenderer,
    };
}(window));
