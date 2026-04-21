(function initPinchDefenseRenderer(globalObject) {
    'use strict';

    const PIXI_CDN_URLS = [
        'https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.min.js',
        'https://unpkg.com/pixi.js@7.4.2/dist/pixi.min.js',
    ];

    function getShapeEntity(shape) {
        if (shape === 'triangle') return '\u25B2';
        if (shape === 'square') return '\u25A0';
        if (shape === 'diamond') return '\u25C6';
        return '\u25CF';
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
            enemyDisplays: {},
            transientText: null,
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
            const texture = getTexture('wizard', () => createVectorTexture(84, 120, (graphics) => {
                graphics.beginFill(0xf8fafc);
                graphics.drawCircle(42, 28, 14);
                graphics.endFill();
                graphics.beginFill(0x2563eb);
                graphics.moveTo(18, 116);
                graphics.lineTo(42, 22);
                graphics.lineTo(68, 116);
                graphics.closePath();
                graphics.endFill();
            }));

            const sprite = new runtime.pixi.Sprite(texture);
            sprite.anchor.set(0.5, 0.5);
            container.addChild(sprite);
            container.sprite = sprite;
            runtime.actorLayer.addChild(container);
            runtime.playerDisplay = container;
            return container;
        }

        function createSequenceText(symbol, color) {
            return new runtime.pixi.Text(symbol, {
                fontFamily: '"Space Grotesk", sans-serif',
                fontSize: 20,
                fontWeight: '700',
                fill: color,
                stroke: '#ffffff',
                strokeThickness: 1,
            });
        }

        function createEnemyDisplay(enemy) {
            const container = new runtime.pixi.Container();
            container.sortableChildren = true;

            const shadow = new runtime.pixi.Graphics();
            shadow.beginFill(0x07101f, 0.32);
            shadow.drawEllipse(0, 0, 26, 10);
            shadow.endFill();
            shadow.y = 50;
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
            body.anchor.set(0.5, 0.5);
            body.y = -8;
            body.zIndex = 1;
            container.addChild(body);

            const flash = new runtime.pixi.Graphics();
            flash.beginFill(0xf8fafc, 0.16);
            flash.drawCircle(0, -8, 42);
            flash.endFill();
            flash.visible = false;
            flash.zIndex = 2;
            container.addChild(flash);

            const sequence = new runtime.pixi.Container();
            sequence.y = -64;
            sequence.zIndex = 3;
            container.addChild(sequence);

            runtime.enemyLayer.addChild(container);
            runtime.enemyDisplays[enemy.id] = { container, shadow, body, flash, sequence };
            return runtime.enemyDisplays[enemy.id];
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

        function syncEnemySequence(display, enemy) {
            display.sequence.removeChildren().forEach((child) => child.destroy());
            const pendingSequence = enemy.sequence.slice(enemy.currentStep);
            pendingSequence.forEach((fingerId, index) => {
                const fingerConfig = config.fingers[fingerId];
                const symbol = createSequenceText(getShapeEntity(fingerConfig.shape), fingerConfig.color);
                symbol.anchor.set(0.5, 0.5);
                symbol.x = (index * 28) - ((pendingSequence.length - 1) * 14);
                display.sequence.addChild(symbol);
            });
        }

        function syncPlayer(width, height) {
            const player = runtime.playerDisplay || createPlayerDisplay();
            const elapsedSeconds = runtime.app.ticker.lastTime / 1000;
            const drawWidth = width * 0.16;
            const drawHeight = height * 0.28;
            player.position.set(width * 0.18, height * 0.54 + (Math.sin(elapsedSeconds * 2.4) * 4));
            player.sprite.width = drawWidth;
            player.sprite.height = drawHeight;
        }

        function syncEnemies(viewState, width, height) {
            const laneStart = width * 0.2;
            const laneWidth = width * 0.68;
            const baseY = height * 0.55;
            const elapsedSeconds = runtime.app.ticker.lastTime / 1000;
            const activeIds = new Set();

            viewState.enemies.forEach((enemy, index) => {
                activeIds.add(enemy.id);
                const display = runtime.enemyDisplays[enemy.id] || createEnemyDisplay(enemy);
                const x = laneStart + enemy.x * laneWidth;
                const bob = Math.sin((elapsedSeconds * 3.6) + index) * 6;
                const knockback = enemy.knockbackMs > 0 ? 10 * Math.min(1, enemy.knockbackMs / 180) : 0;

                display.container.position.set(x + knockback, baseY + bob);
                display.container.scale.set(enemy.hitFlashMs > 0 ? 1.08 : 1);
                display.body.rotation = Math.sin((elapsedSeconds * 2.1) + index) * 0.05;
                display.flash.visible = enemy.hitFlashMs > 0;
                display.shadow.scale.x = 1 + (Math.sin((elapsedSeconds * 2.4) + index) * 0.08);
                display.shadow.alpha = 0.28 + (Math.sin((elapsedSeconds * 2.4) + index) * 0.04);
                syncEnemySequence(display, enemy);
            });

            Object.keys(runtime.enemyDisplays).forEach((enemyId) => {
                if (!activeIds.has(enemyId)) {
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
            syncPlayer(width, height);
            syncEnemies(viewState, width, height);
            syncTransient(viewState, width, height);
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
            runtime.transientText = null;
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
