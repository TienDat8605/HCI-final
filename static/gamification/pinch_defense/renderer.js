(function initPinchDefenseRenderer(globalObject) {
    'use strict';

    function drawSymbol(ctx, shape, color, x, y, size) {
        ctx.save();
        ctx.fillStyle = color;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = Math.max(2, size * 0.08);
        ctx.beginPath();
        if (shape === 'triangle') {
            ctx.moveTo(x, y - size);
            ctx.lineTo(x + size * 0.86, y + size * 0.56);
            ctx.lineTo(x - size * 0.86, y + size * 0.56);
        } else if (shape === 'square') {
            ctx.rect(x - size * 0.82, y - size * 0.82, size * 1.64, size * 1.64);
        } else if (shape === 'diamond') {
            ctx.moveTo(x, y - size);
            ctx.lineTo(x + size * 0.92, y);
            ctx.lineTo(x, y + size);
            ctx.lineTo(x - size * 0.92, y);
        } else {
            ctx.arc(x, y, size, 0, Math.PI * 2);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    function formatClock(ms) {
        const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
        const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        return `${minutes}:${seconds}`;
    }

    function createRenderer(config, assetStore) {
        const runtime = {
            container: null,
            root: null,
            canvas: null,
            context: null,
            banner: null,
            guide: null,
            summary: null,
            lastViewState: null,
        };

        function resolveCanvasSize() {
            if (!runtime.canvas) {
                return;
            }
            const rect = runtime.canvas.getBoundingClientRect();
            const width = Math.max(1, Math.round(rect.width));
            const height = Math.max(1, Math.round(rect.height));
            if (runtime.canvas.width !== width || runtime.canvas.height !== height) {
                runtime.canvas.width = width;
                runtime.canvas.height = height;
            }
        }

        function drawBackground(ctx, width, height) {
            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, '#0c1229');
            gradient.addColorStop(1, '#1e293b');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);

            ctx.fillStyle = 'rgba(89, 167, 255, 0.08)';
            for (let index = 0; index < 6; index += 1) {
                const radius = (width * 0.18) + index * 26;
                ctx.beginPath();
                ctx.arc(width * 0.72, height * 0.2, radius, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
            ctx.fillRect(width * 0.08, height * 0.73, width * 0.84, height * 0.012);
            ctx.fillStyle = 'rgba(133, 153, 182, 0.3)';
            ctx.fillRect(width * 0.08, height * 0.742, width * 0.84, height * 0.12);
        }

        function drawImageOrFallback(ctx, image, fallback, x, y, width, height) {
            if (image) {
                ctx.drawImage(image, x, y, width, height);
                return;
            }
            fallback();
        }

        function drawPlayer(ctx, viewState, width, height) {
            const image = assetStore.getImage('wizard');
            const drawWidth = width * 0.16;
            const drawHeight = height * 0.28;
            const x = width * 0.1;
            const y = height * 0.4;
            drawImageOrFallback(ctx, image, () => {
                ctx.save();
                ctx.fillStyle = '#f8fafc';
                ctx.beginPath();
                ctx.arc(x + drawWidth * 0.55, y + drawHeight * 0.26, drawWidth * 0.16, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#2563eb';
                ctx.beginPath();
                ctx.moveTo(x + drawWidth * 0.32, y + drawHeight * 0.92);
                ctx.lineTo(x + drawWidth * 0.55, y + drawHeight * 0.18);
                ctx.lineTo(x + drawWidth * 0.82, y + drawHeight * 0.92);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }, x, y, drawWidth, drawHeight);

            ctx.save();
            ctx.font = '700 22px "Space Grotesk", sans-serif';
            ctx.fillStyle = '#e2e8f0';
            ctx.fillText(`HP ${viewState.hp}`, width * 0.08, height * 0.12);
            ctx.restore();
        }

        function drawEnemy(ctx, enemy, viewState, width, height) {
            const laneStart = width * 0.2;
            const laneWidth = width * 0.68;
            const x = laneStart + enemy.x * laneWidth;
            const y = height * 0.55;
            const size = width * 0.1;
            const image = assetStore.getImage(enemy.assetId);

            ctx.save();
            if (enemy.hitFlashMs > 0) {
                ctx.shadowColor = '#f8fafc';
                ctx.shadowBlur = 24;
            }
            drawImageOrFallback(ctx, image, () => {
                ctx.fillStyle = enemy.type === 'ghost'
                    ? '#e2e8f0'
                    : (enemy.type === 'slime' ? '#34d399' : '#fda4af');
                ctx.beginPath();
                ctx.arc(x, y, size * 0.42, 0, Math.PI * 2);
                ctx.fill();
            }, x - size * 0.54, y - size * 0.54, size, size);

            const pendingSequence = enemy.sequence.slice(enemy.currentStep);
            pendingSequence.forEach((fingerId, index) => {
                const fingerConfig = config.fingers[fingerId];
                drawSymbol(
                    ctx,
                    fingerConfig.shape,
                    fingerConfig.color,
                    x + (index * 30) - ((pendingSequence.length - 1) * 15),
                    y - size * 0.75,
                    size * 0.16
                );
            });
            ctx.restore();
        }

        function drawStage(viewState) {
            resolveCanvasSize();
            if (!runtime.context || !runtime.canvas) {
                return;
            }
            const ctx = runtime.context;
            const width = runtime.canvas.width;
            const height = runtime.canvas.height;
            ctx.clearRect(0, 0, width, height);

            drawBackground(ctx, width, height);
            drawPlayer(ctx, viewState, width, height);
            viewState.enemies.forEach((enemy) => drawEnemy(ctx, enemy, viewState, width, height));

            if (viewState.transientText) {
                ctx.save();
                ctx.font = '700 28px "Space Grotesk", sans-serif';
                ctx.fillStyle = '#fef08a';
                ctx.fillText(viewState.transientText, width * 0.44, height * 0.2);
                ctx.restore();
            }
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
                    viewState.activeTargetFinger === fingerId ? 'is-target' : '',
                    viewState.activeFinger === fingerId ? 'is-active' : '',
                    fingerState.assisted ? 'is-assisted' : '',
                ].filter(Boolean).join(' ');
                const status = fingerState.state || 'idle';
                return `
                    <div class="${classes}" style="--finger-color:${fingerConfig.color}; --finger-glow:${fingerConfig.glow};">
                        <span>${fingerConfig.label}</span>
                        <b>${status.toUpperCase()}</b>
                    </div>
                `;
            }).join('');
        }

        function updateBanner(viewState) {
            if (!runtime.banner) {
                return;
            }
            runtime.banner.innerHTML = `
                <strong>${viewState.waveLabel}</strong>
                <span>${viewState.praiseText}</span>
                <small>${formatClock(viewState.remainingMs)} remaining</small>
            `;
        }

        function updateSummary(viewState) {
            if (!runtime.summary) {
                return;
            }
            runtime.summary.innerHTML = `
                <div>
                    <span>Target Finger</span>
                    <b>${config.fingers[viewState.activeTargetFinger]?.label || 'Relaxed'}</b>
                </div>
                <div>
                    <span>Accuracy</span>
                    <b>${viewState.accuracyPercent}%</b>
                </div>
                <div>
                    <span>Combo</span>
                    <b>${viewState.combo > 1 ? `x${viewState.combo}` : 'Ready'}</b>
                </div>
            `;
        }

        function buildRoot() {
            const root = document.createElement('div');
            root.className = 'pinch-defense-root';
            root.innerHTML = `
                <canvas class="pinch-defense-canvas"></canvas>
                <div class="pinch-defense-banner"></div>
                <div class="pinch-defense-guide"></div>
                <div class="pinch-defense-summary"></div>
            `;
            runtime.root = root;
            runtime.canvas = root.querySelector('.pinch-defense-canvas');
            runtime.context = runtime.canvas.getContext('2d');
            runtime.banner = root.querySelector('.pinch-defense-banner');
            runtime.guide = root.querySelector('.pinch-defense-guide');
            runtime.summary = root.querySelector('.pinch-defense-summary');
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
            assetStore.ensureLoaded().then(() => {
                if (runtime.lastViewState) {
                    drawStage(runtime.lastViewState);
                }
            });
            if (runtime.lastViewState) {
                update(runtime.lastViewState);
            }
        }

        function unmount() {
            if (runtime.root && runtime.root.parentNode) {
                runtime.root.parentNode.removeChild(runtime.root);
            }
            runtime.container = null;
        }

        function update(viewState) {
            runtime.lastViewState = viewState;
            if (!runtime.root) {
                return;
            }
            updateBanner(viewState);
            updateGuide(viewState);
            updateSummary(viewState);
            drawStage(viewState);
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
