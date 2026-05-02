(function initStrengtheningRenderer(globalObject) {
    'use strict';

    const DPR = Math.max(1, globalObject.devicePixelRatio || 1);

    // Arc geometry (normalised angles, radians)
    const ARC_START    = Math.PI * 0.72;   // ~130° — left of bottom
    const ARC_END      = Math.PI * 2.28;   // ~411° — right of bottom
    const ARC_SWEEP    = ARC_END - ARC_START;

    // Zone boundaries along the arc (0–1 → ARC progress)
    const ZONE_GOOD_LO    = 0.20;
    const ZONE_EXC_LO     = 0.35;
    const ZONE_EXC_HI     = 0.65;
    const ZONE_GOOD_HI    = 0.80;

    // Visual sizing (relative to canvas dimensions)
    const ARC_RADIUS_RATIO   = 0.30;   // arc radius / canvas width
    const ARC_THICKNESS      = 14;     // track stroke width in CSS px
    const MARKER_RADIUS      = 10;     // marker circle radius in CSS px
    const CUP_W_RATIO        = 0.13;   // cup width / canvas width
    const CUP_H_RATIO        = 0.40;   // cup height / canvas height

    // Animation
    const DRIP_GRAVITY        = 420;   // px/s²
    const DRIP_SPAWN_INTERVAL = 0.10;  // seconds between drip spawns
    const DRIP_MAX            = 22;
    const WAVE_SPEED          = 2.8;   // radians per second
    const WAVE_AMPLITUDE      = 3;     // CSS px
    const PARTICLE_DECAY      = 0.55;  // opacity decay per second
    const RESULT_FLASH_MS     = 320;

    // Colors
    const COLORS = {
        bg          : '#0d1117',
        bgRing      : 'rgba(255,125,38,0.06)',
        trackBase   : 'rgba(255,255,255,0.08)',
        trackBad    : 'rgba(85,85,104,0.25)',
        trackGood   : 'rgba(245,200,66,0.35)',
        trackExc    : 'rgba(255,125,38,0.45)',
        markerBad   : '#555568',
        markerGood  : '#f5c842',
        markerExc   : '#ff7d26',
        markerBorder: 'rgba(255,255,255,0.85)',
        glowExc     : 'rgba(255,125,38,0.55)',
        glowGood    : 'rgba(245,200,66,0.45)',
        juiceTop    : '#ff9640',
        juiceBot    : '#ff5500',
        juiceSurf   : 'rgba(255,200,120,0.55)',
        cupStroke   : 'rgba(255,255,255,0.22)',
        cupShine    : 'rgba(255,255,255,0.10)',
        dripColor   : '#ff8830',
        resultExc   : '#ff7d26',
        resultGood  : '#f5c842',
        resultBad   : '#8888a0',
        scorePop    : '#ff9640',
        orderActive : 'rgba(255,125,38,0.22)',
        orderDone   : 'rgba(78,200,120,0.20)',
        orderDoneBdr: 'rgba(78,200,120,0.55)',
        orderActiveBdr: 'rgba(255,125,38,0.55)',
        orderIdle   : 'rgba(255,255,255,0.06)',
        heartFull   : '#ef4444',
        heartEmpty  : 'rgba(255,255,255,0.15)',
    };

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function lerp(a, b, t) { return a + (b - a) * t; }

    function easeOutBack(t) {
        const c1 = 1.70158, c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }

    function getZone(progress) {
        if (progress >= ZONE_EXC_LO && progress <= ZONE_EXC_HI) return 'excellent';
        if ((progress >= ZONE_GOOD_LO && progress < ZONE_EXC_LO) ||
            (progress > ZONE_EXC_HI  && progress <= ZONE_GOOD_HI)) return 'good';
        return 'bad';
    }

    function zoneColor(zone, type) {
        if (type === 'marker') {
            return zone === 'excellent' ? COLORS.markerExc : zone === 'good' ? COLORS.markerGood : COLORS.markerBad;
        }
        if (type === 'glow') {
            return zone === 'excellent' ? COLORS.glowExc : zone === 'good' ? COLORS.glowGood : 'transparent';
        }
        return zone === 'excellent' ? COLORS.resultExc : zone === 'good' ? COLORS.resultGood : COLORS.resultBad;
    }

    function createDrip(x, topY) {
        return {
            x  : x + (Math.random() - 0.5) * 10,
            y  : topY,
            vy : 40 + Math.random() * 60,
            r  : 2.5 + Math.random() * 2,
            opacity: 0.85 + Math.random() * 0.15,
            alive: true,
        };
    }

    function createScorePop(x, y, pts, zone) {
        return { x, y, vy: -60, pts, zone, opacity: 1, alive: true };
    }

    function createRenderer(config, assetStore) {

        const runtime = {
            container     : null,
            root          : null,
            canvas        : null,
            ctx           : null,
            animFrameId   : null,
            resizeObserver: null,
            lastViewState : null,
            lastW         : 0,
            lastH         : 0,

            // Live animation state
            wavePhase     : 0,
            drips         : [],
            dripTimer     : 0,
            scorePops     : [],
            lastResultPop : null,   // { zoneKey, title, detail, pts, opacity, scale }
            resultPopTimer: 0,

            // Previous viewState fields for change detection
            prevOrderResolved : false,
            prevScore         : 0,
        };

        // Canvas setup
        function ensureCanvas() {
            if (runtime.canvas) return runtime.canvas;
            const canvas = document.createElement('canvas');
            canvas.className = 'sg-renderer-canvas';
            canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
            runtime.canvas = canvas;
            runtime.ctx    = canvas.getContext('2d');
            return canvas;
        }

        function resizeCanvas() {
            if (!runtime.canvas || !runtime.root) return;
            const rect = runtime.root.getBoundingClientRect();
            const w = Math.max(1, Math.round(rect.width));
            const h = Math.max(1, Math.round(rect.height));
            if (w === runtime.lastW && h === runtime.lastH) return;
            runtime.lastW = w;
            runtime.lastH = h;
            runtime.canvas.width  = w * DPR;
            runtime.canvas.height = h * DPR;
            runtime.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        }

        // Draw Canvas
        function drawRoundedRect(ctx, x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.arcTo(x + w, y, x + w, y + r, r);
            ctx.lineTo(x + w, y + h - r);
            ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
            ctx.lineTo(x + r, y + h);
            ctx.arcTo(x, y + h, x, y + h - r, r);
            ctx.lineTo(x, y + r);
            ctx.arcTo(x, y, x + r, y, r);
            ctx.closePath();
        }

        function drawHeart(ctx, cx, cy, size, filled) {
            const s = size * 0.5;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(s / 32, s / 32);
            ctx.beginPath();
            ctx.moveTo(0, 22);
            ctx.bezierCurveTo(-22, 6, -28, -14, -14, -24);
            ctx.bezierCurveTo(-4, -30, 4, -20, 0, -14);
            ctx.bezierCurveTo(-4, -20, 4, -30, 14, -24);
            ctx.bezierCurveTo(28, -14, 22, 6, 0, 22);
            ctx.closePath();
            ctx.fillStyle = filled ? COLORS.heartFull : COLORS.heartEmpty;
            ctx.fill();
            ctx.restore();
        }

        // Background
        function drawBackground(ctx, w, h) {
            ctx.fillStyle = COLORS.bg;
            ctx.fillRect(0, 0, w, h);

            // Subtle ambient rings (top-right accent)
            for (let i = 0; i < 5; i++) {
                const r = (w * 0.12) + i * (w * 0.07);
                ctx.beginPath();
                ctx.arc(w * 0.82, h * 0.18, r, 0, Math.PI * 2);
                ctx.strokeStyle = COLORS.bgRing;
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }

        // Arc timing bar
        function arcAngle(progress) {
            return ARC_START + progress * ARC_SWEEP;
        }

        function drawArcTrack(ctx, cx, cy, radius) {
            // Base track
            ctx.beginPath();
            ctx.arc(cx, cy, radius, ARC_START, ARC_END);
            ctx.strokeStyle = COLORS.trackBase;
            ctx.lineWidth   = ARC_THICKNESS;
            ctx.lineCap     = 'round';
            ctx.stroke();

            // Good zones (yellow)
            const goodLeft  = [arcAngle(ZONE_GOOD_LO), arcAngle(ZONE_EXC_LO)];
            const goodRight = [arcAngle(ZONE_EXC_HI),  arcAngle(ZONE_GOOD_HI)];
            for (const [aStart, aEnd] of [goodLeft, goodRight]) {
                ctx.beginPath();
                ctx.arc(cx, cy, radius, aStart, aEnd);
                ctx.strokeStyle = COLORS.trackGood;
                ctx.lineWidth   = ARC_THICKNESS;
                ctx.stroke();
            }

            // Excellent zone (orange)
            ctx.beginPath();
            ctx.arc(cx, cy, radius, arcAngle(ZONE_EXC_LO), arcAngle(ZONE_EXC_HI));
            ctx.strokeStyle = COLORS.trackExc;
            ctx.lineWidth   = ARC_THICKNESS + 4;
            ctx.stroke();

            // Zone labels
            ctx.font      = 'bold 9px "Space Grotesk", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const labelDist = radius + 24;
            const excMid    = ARC_START + (ZONE_EXC_LO + ZONE_EXC_HI) / 2 * ARC_SWEEP;
            const excLX     = cx + Math.cos(excMid) * labelDist;
            const excLY     = cy + Math.sin(excMid) * labelDist;
            ctx.fillStyle = 'rgba(255,125,38,0.7)';
            ctx.fillText('EXCELLENT', excLX, excLY);
        }

        function drawArcMarker(ctx, cx, cy, radius, progress, zone, elapsedSec) {
            const angle  = arcAngle(progress);
            const mx     = cx + Math.cos(angle) * radius;
            const my     = cy + Math.sin(angle) * radius;
            const color  = zoneColor(zone, 'marker');
            const glow   = zoneColor(zone, 'glow');

            // Glow ring when in good/excellent
            if (zone !== 'bad') {
                const pulse = 0.4 + Math.sin(elapsedSec * 7) * 0.15;
                const grad  = ctx.createRadialGradient(mx, my, 0, mx, my, MARKER_RADIUS * 3.5);
                grad.addColorStop(0, glow.replace(')', `,${pulse})`).replace('rgba', 'rgba'));
                grad.addColorStop(1, 'transparent');
                ctx.beginPath();
                ctx.arc(mx, my, MARKER_RADIUS * 3.5, 0, Math.PI * 2);
                ctx.fillStyle = glow;
                ctx.globalAlpha = pulse;
                ctx.fill();
                ctx.globalAlpha = 1;
            }

            // Outer border
            ctx.beginPath();
            ctx.arc(mx, my, MARKER_RADIUS + 2, 0, Math.PI * 2);
            ctx.fillStyle = COLORS.markerBorder;
            ctx.fill();

            // Inner fill
            ctx.beginPath();
            ctx.arc(mx, my, MARKER_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();

            // Trail (arc from start to current)
            if (progress > 0.01) {
                ctx.beginPath();
                ctx.arc(cx, cy, radius, ARC_START, angle);
                const trailGrad = ctx.createLinearGradient(
                    cx + Math.cos(ARC_START) * radius, cy + Math.sin(ARC_START) * radius,
                    mx, my
                );
                trailGrad.addColorStop(0, 'transparent');
                trailGrad.addColorStop(1, color + 'aa');
                ctx.strokeStyle = trailGrad;
                ctx.lineWidth   = 4;
                ctx.lineCap     = 'round';
                ctx.stroke();
            }
        }

        // Cup
        function drawCup(ctx, cx, topY, cupW, cupH, fillRatio, wavePhase, isSqueezing) {
            const bottomY = topY + cupH;
            const halfW   = cupW * 0.5;
            const topW   = cupW * 0.72;
            const topHalf = topW * 0.5;

            // Clip cup shape
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(cx - topHalf, topY);
            ctx.lineTo(cx + topHalf, topY);
            ctx.lineTo(cx + halfW,   bottomY);
            ctx.lineTo(cx - halfW,   bottomY);
            ctx.closePath();
            ctx.clip();

            ctx.fillStyle = 'rgba(255,255,255,0.04)';
            ctx.fillRect(cx - halfW, topY, cupW, cupH);

            const fillY = lerp(bottomY, topY, clamp(fillRatio, 0, 1));

            if (fillRatio > 0.005) {
                // Animated wave surface
                const waveY   = fillY - WAVE_AMPLITUDE * Math.sin(wavePhase);
                const waveY2  = fillY + WAVE_AMPLITUDE * Math.sin(wavePhase + 1.2);

                // Main juice body
                const juiceGrad = ctx.createLinearGradient(0, fillY, 0, bottomY);
                juiceGrad.addColorStop(0, COLORS.juiceTop);
                juiceGrad.addColorStop(1, COLORS.juiceBot);
                ctx.fillStyle = juiceGrad;
                ctx.fillRect(cx - halfW, fillY, cupW, bottomY - fillY);

                // Wave surface
                ctx.beginPath();
                ctx.moveTo(cx - halfW, waveY);
                const steps = 12;
                for (let i = 0; i <= steps; i++) {
                    const t  = i / steps;
                    const wx = cx - halfW + t * cupW;
                    const wy = lerp(waveY, waveY2, Math.sin(t * Math.PI)) - WAVE_AMPLITUDE * Math.sin(wavePhase + t * Math.PI * 3);
                    if (i === 0) ctx.moveTo(wx, wy);
                    else ctx.lineTo(wx, wy);
                }
                ctx.lineTo(cx + halfW,  fillY + 2);
                ctx.lineTo(cx - halfW,  fillY + 2);
                ctx.closePath();
                ctx.fillStyle = COLORS.juiceSurf;
                ctx.fill();

                // Shine stripe on juice
                ctx.fillStyle = 'rgba(255,255,255,0.08)';
                ctx.fillRect(cx - halfW + 5, fillY, 6, bottomY - fillY);
            }

            ctx.restore();

            // Cup outline
            ctx.beginPath();
            ctx.moveTo(cx - topHalf, topY);
            ctx.lineTo(cx + topHalf, topY);
            ctx.lineTo(cx + halfW,   bottomY);
            ctx.lineTo(cx - halfW,   bottomY);
            ctx.closePath();
            ctx.strokeStyle = COLORS.cupStroke;
            ctx.lineWidth   = 1.5;
            ctx.stroke();

            // cup asset overlay (drawn at full cup bounds, preserves alpha)
            const cupGlassImg = assetStore.getImage('cup');
            if (cupGlassImg) {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(cx - topHalf, topY);
                ctx.lineTo(cx + topHalf, topY);
                ctx.lineTo(cx + halfW,   bottomY);
                ctx.lineTo(cx - halfW,   bottomY);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(cupGlassImg, cx - halfW, topY, cupW, cupH);
                ctx.restore();
            }

            // Squeeze ripple ring on surface
            if (isSqueezing && fillRatio > 0.05) {
                const rippleY = lerp(bottomY, topY, clamp(fillRatio, 0, 1));
                const ripplePulse = 0.4 + Math.abs(Math.sin(wavePhase * 4)) * 0.4;
                ctx.beginPath();
                ctx.ellipse(cx, rippleY, cupW * 0.3, 3, 0, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(255,200,120,${ripplePulse * 0.6})`;
                ctx.lineWidth   = 1.5;
                ctx.stroke();
            }
        }

        // Drip particles
        function updateDrips(dt, isSqueezing, dripX, dripTopY, bottomBound) {
            // Spawn
            if (isSqueezing) {
                runtime.dripTimer += dt;
                while (runtime.dripTimer >= DRIP_SPAWN_INTERVAL && runtime.drips.length < DRIP_MAX) {
                    runtime.drips.push(createDrip(dripX, dripTopY));
                    runtime.dripTimer -= DRIP_SPAWN_INTERVAL;
                }
            } else {
                runtime.dripTimer = 0;
            }

            // Update
            for (const d of runtime.drips) {
                d.vy      += DRIP_GRAVITY * dt;
                d.y       += d.vy * dt;
                d.opacity -= PARTICLE_DECAY * dt;
                if (d.y > bottomBound + 20 || d.opacity <= 0) d.alive = false;
            }
            runtime.drips = runtime.drips.filter((d) => d.alive);
        }

        // Score pop
        function updateScorePops(dt) {
            for (const p of runtime.scorePops) {
                p.y       += p.vy * dt;
                p.vy      *= 0.92;
                p.opacity -= 0.9 * dt;
                if (p.opacity <= 0) p.alive = false;
            }
            runtime.scorePops = runtime.scorePops.filter((p) => p.alive);
        }

        function drawScorePops(ctx) {
            for (const p of runtime.scorePops) {
                ctx.globalAlpha = p.opacity;
                ctx.font        = 'bold 18px "Space Grotesk", sans-serif';
                ctx.textAlign   = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle   = zoneColor(p.zone, 'result');
                ctx.fillText(`+${p.pts}`, p.x, p.y);
            }
            ctx.globalAlpha = 1;
        }

        // Result pop
        function drawResultPopup(ctx, w, h, popup, timer) {
            if (!popup || !popup.visible || !runtime.lastResultPop) return;

            const pop = runtime.lastResultPop;
            const t   = clamp(timer / 0.28, 0, 1);
            const sc  = easeOutBack(t);
            const alpha = t < 0.08 ? t / 0.08 : (t > 0.85 ? (1 - t) / 0.15 : 1);

            const boxW = 200, boxH = 72;
            const bx   = (w - boxW) / 2;
            const by   = h * 0.36;

            ctx.save();
            ctx.globalAlpha = clamp(alpha, 0, 1);
            ctx.translate(bx + boxW / 2, by + boxH / 2);
            ctx.scale(sc, sc);
            ctx.translate(-(boxW / 2), -(boxH / 2));

            // Box background
            drawRoundedRect(ctx, 0, 0, boxW, boxH, 10);
            ctx.fillStyle = 'rgba(12,14,22,0.96)';
            ctx.fill();

            // Border
            const borderColor = pop.zone === 'excellent' ? 'rgba(255,125,38,0.7)'
                : pop.zone === 'good' ? 'rgba(245,200,66,0.6)'
                : 'rgba(85,85,104,0.5)';
            drawRoundedRect(ctx, 0, 0, boxW, boxH, 10);
            ctx.strokeStyle = borderColor;
            ctx.lineWidth   = 1.5;
            ctx.stroke();

            // Title
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.font         = 'bold 14px "Space Grotesk", sans-serif';
            ctx.fillStyle    = zoneColor(pop.zone, 'result');
            ctx.fillText(pop.title, boxW / 2, boxH * 0.36);

            // Detail
            ctx.font      = '11px "Space Grotesk", sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.fillText(pop.detail, boxW / 2, boxH * 0.62);

            // Points
            if (pop.pts != null) {
                ctx.font      = 'bold 11px "Space Grotesk", sans-serif';
                ctx.fillStyle = COLORS.scorePop;
                ctx.fillText(`+${pop.pts} pts`, boxW / 2, boxH * 0.84);
            }

            ctx.restore();
        }

        // Hearts
        function drawHearts(ctx, w, hearts) {
            const heartSize = 22;
            const gap       = 6;
            const totalW    = hearts.length * (heartSize + gap) - gap;
            const startX    = w / 2 - totalW / 2;
            const y         = 22;
            for (let i = 0; i < hearts.length; i++) {
                drawHeart(ctx, startX + i * (heartSize + gap) + heartSize / 2, y, heartSize, hearts[i]);
            }
        }

        // Wave/Score Overlay
        function drawHUD(ctx, w, h, viewState) {
            // Wave badge (top-left)
            const waveText = `Wave ${viewState.currentWave || 1} / ${viewState.totalWaves || 3}`;
            ctx.font      = 'bold 10px "Space Grotesk", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.fillText(waveText, 16, 18);

            // Transient wave label (center fade-in)
            if (viewState.transientText) {
                ctx.save();
                ctx.font      = 'bold 22px "Space Grotesk", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = 'rgba(255,200,120,0.9)';
                ctx.shadowColor  = 'rgba(255,125,38,0.6)';
                ctx.shadowBlur   = 14;
                ctx.fillText(viewState.transientText, w / 2, h * 0.22);
                ctx.restore();
            }

            // Combo badge (top-right of arc)
            if (viewState.comboStreak >= 2) {
                const multLabel = viewState.comboStreak >= 3 ? '×1.5' : '×1.2';
                const badgeText = `${multLabel} COMBO`;
                ctx.font = 'bold 10px "Space Grotesk", sans-serif';
                const tw  = ctx.measureText(badgeText).width;
                const bx  = w - tw - 28;
                const by  = 10;
                const bw  = tw + 16;
                const bh  = 20;
                drawRoundedRect(ctx, bx, by, bw, bh, 999);
                ctx.fillStyle = '#ff7d26';
                ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.95)';
                ctx.textAlign    = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(badgeText, bx + bw / 2, by + bh / 2);
            }
        }

        // Order badges
        function drawOrders(ctx, w, h, orders, activeIdx) {
            if (!Array.isArray(orders) || !orders.length) return;

            const cardW  = w * 0.16;
            const cardH  = 52;
            const cardX  = w - cardW - 14;
            const startY = h * 0.12;
            const gap    = 10;

            ctx.font         = '10px "Space Grotesk", sans-serif';
            ctx.textBaseline = 'middle';

            orders.forEach((order, i) => {
                const isActive = i === activeIdx;
                const isDone   = order.status === 'done';
                const cy       = startY + i * (cardH + gap);

                // Card background
                drawRoundedRect(ctx, cardX, cy, cardW, cardH, 8);
                ctx.fillStyle = isDone ? COLORS.orderDone : isActive ? COLORS.orderActive : COLORS.orderIdle;
                ctx.fill();

                // Border
                drawRoundedRect(ctx, cardX, cy, cardW, cardH, 8);
                ctx.strokeStyle = isDone ? COLORS.orderDoneBdr : isActive ? COLORS.orderActiveBdr : 'rgba(255,255,255,0.07)';
                ctx.lineWidth = 1;
                ctx.stroke();

                // Mini fill bar along bottom
                const prog  = clamp(order.progress || 0, 0, 1);
                if (prog > 0) {
                    drawRoundedRect(ctx, cardX + 4, cy + cardH - 6, (cardW - 8) * prog, 3, 2);
                    ctx.fillStyle = isDone ? 'rgba(78,200,120,0.7)' : COLORS.markerExc;
                    ctx.fill();
                }

                // Icon — asset image preferred, emoji fallback
                const fruitAssetId = (order.icon === '🍋') ? 'lemon' : 'orange';
                const fruitImg     = assetStore.getImage(fruitAssetId);
                const iconCX       = cardX + cardW * 0.35;
                const iconCY       = cy + cardH / 2 - 2;
                const iconSize     = 20;
                if (fruitImg) {
                    ctx.drawImage(fruitImg, iconCX - iconSize / 2, iconCY - iconSize / 2, iconSize, iconSize);
                } else {
                    ctx.font      = '18px serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(order.icon || '🍊', iconCX, iconCY);
                }

                // ml text
                ctx.font      = 'bold 10px "Space Grotesk", sans-serif';
                ctx.fillStyle = isDone ? 'rgba(78,200,120,0.9)' : isActive ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)';
                ctx.textAlign = 'left';
                ctx.fillText(`${order.targetMl}ml`, cardX + cardW * 0.58, cy + cardH * 0.38);

                // Progress %
                ctx.font      = '9px "Space Grotesk", sans-serif';
                ctx.fillStyle = 'rgba(255,255,255,0.35)';
                ctx.fillText(`${Math.round(prog * 100)}%`, cardX + cardW * 0.58, cy + cardH * 0.64);
            });
        }

        // Squeeze indicator (bottom bar)
        function drawSqueezeBar(ctx, w, h, intensity, isSqueezing) {
            const barW = w * 0.36;
            const barH = 5;
            const barX = (w - barW) / 2;
            const barY = h - 28;

            // Track
            drawRoundedRect(ctx, barX, barY, barW, barH, 3);
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.fill();

            // Fill
            const fillW = barW * clamp(intensity, 0, 1);
            if (fillW > 2) {
                const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
                grad.addColorStop(0, '#f5c842');
                grad.addColorStop(1, '#ff7d26');
                drawRoundedRect(ctx, barX, barY, fillW, barH, 3);
                ctx.fillStyle = grad;
                ctx.fill();
            }

            // Dot indicator
            const dotX = barX - 14;
            const dotY = barY + barH / 2;
            ctx.beginPath();
            ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
            ctx.fillStyle = isSqueezing ? '#ff7d26' : 'rgba(255,255,255,0.2)';
            ctx.fill();
            if (isSqueezing) {
                ctx.beginPath();
                ctx.arc(dotX, dotY, 7, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,125,38,0.4)';
                ctx.lineWidth   = 1.5;
                ctx.stroke();
            }

            // Label
            const intPct = Math.round(clamp(intensity, 0, 1) * 100);
            ctx.font         = '10px "Space Grotesk", sans-serif';
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle    = isSqueezing ? 'rgba(255,125,38,0.9)' : 'rgba(255,255,255,0.3)';
            ctx.fillText(isSqueezing ? `Squeezing ${intPct}%` : 'Released', w / 2, h - 14);
        }

        // Main draw frame
        function drawFrame(dt) {
            const vs = runtime.lastViewState;
            if (!runtime.ctx || !vs) return;

            const ctx = runtime.ctx;
            const w   = runtime.lastW;
            const h   = runtime.lastH;
            if (w < 2 || h < 2) return;

            const elapsedSec = performance.now() / 1000;

            // Update animation state
            runtime.wavePhase += WAVE_SPEED * dt;

            const isSqueezing  = Boolean(vs.isSqueezing);
            const fillRatio    = clamp((vs.cupMl || 0) / Math.max(1, vs.targetMl || 250), 0, 1);
            const markerPct    = clamp(vs.markerProgress || 0, 0, 1);
            const zone         = getZone(markerPct);
            const intensity    = clamp(vs.squeezeIntensity || 0, 0, 1);

            // Arc center and radius
            const arcCX  = w * 0.46;
            const arcCY  = h * 0.52;
            const arcR   = Math.min(w, h) * ARC_RADIUS_RATIO;

            // Cup position
            const cupW   = w * CUP_W_RATIO;
            const cupH   = h * CUP_H_RATIO;
            const cupCX  = w * 0.16;
            const cupTopY = h * 0.30;

            // Drip source: just above cup top
            const dripX   = cupCX;
            const dripTopY = cupTopY - 16;

            // Change detection — score pop
            if ((vs.score || 0) > runtime.prevScore && runtime.lastResultPop) {
                const pts = (vs.score || 0) - runtime.prevScore;
                runtime.scorePops.push(createScorePop(arcCX, arcCY - arcR * 0.6, pts, zone));
            }
            runtime.prevScore = vs.score || 0;

            // Change detection — result popup
            if (vs.resultPopup && vs.resultPopup.visible && !runtime.prevOrderResolved) {
                runtime.lastResultPop = {
                    zone  : vs.resultPopup.zoneKey || 'bad',
                    title : vs.resultPopup.title   || '',
                    detail: vs.resultPopup.detail  || '',
                    pts   : vs.resultPopup.pts,
                };
                runtime.resultPopTimer = 0;
            }
            runtime.prevOrderResolved = Boolean(vs.resultPopup && vs.resultPopup.visible);
            if (runtime.prevOrderResolved) runtime.resultPopTimer += dt;

            // Update particles
            updateDrips(dt, isSqueezing && !vs.orderResolved, dripX, dripTopY, h);
            updateScorePops(dt);

            ctx.clearRect(0, 0, w, h);
            drawBackground(ctx, w, h);
            drawCup(ctx, cupCX, cupTopY, cupW, cupH, fillRatio, runtime.wavePhase, isSqueezing);
            drawDrips(ctx);

            ctx.font         = 'bold 11px "Space Grotesk", sans-serif';
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle    = 'rgba(255,255,255,0.4)';
            ctx.fillText(`${Math.round(vs.cupMl || 0)} / ${vs.targetMl || 250} ml`, cupCX, cupTopY + cupH + 14);

            ctx.font      = 'bold 9px "Space Grotesk", sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.28)';
            ctx.fillText('CUP', cupCX, cupTopY - 12);

            drawArcTrack(ctx, arcCX, arcCY, arcR);
            drawArcMarker(ctx, arcCX, arcCY, arcR, markerPct, zone, elapsedSec);

            drawOrders(ctx, w, h, vs.orders || [], vs.activeOrderIndex || 0);

            if (Array.isArray(vs.hearts)) drawHearts(ctx, w, vs.hearts);

            drawHUD(ctx, w, h, vs);

            drawSqueezeBar(ctx, w, h, intensity, isSqueezing);

            drawScorePops(ctx);

            drawResultPopup(ctx, w, h, vs.resultPopup, runtime.resultPopTimer);

            if (vs.playerHitFlashMs > 0) {
                const flashAlpha = clamp(vs.playerHitFlashMs / 320, 0, 1) * 0.14;
                ctx.fillStyle = `rgba(255,60,60,${flashAlpha})`;
                ctx.fillRect(0, 0, w, h);
            }
        }

        let lastFrameTime = null;

        function tick(ts) {
            runtime.animFrameId = requestAnimationFrame(tick);
            resizeCanvas();

            const dt = lastFrameTime == null ? 0 : Math.min((ts - lastFrameTime) / 1000, 0.1);
            lastFrameTime = ts;

            drawFrame(dt);
        }

        // API
        function mount(container) {
            if (runtime.container === container && runtime.canvas) return;

            // Teardown previous mount
            if (runtime.animFrameId) {
                cancelAnimationFrame(runtime.animFrameId);
                runtime.animFrameId = null;
            }
            if (runtime.resizeObserver) {
                runtime.resizeObserver.disconnect();
                runtime.resizeObserver = null;
            }

            runtime.container = container;
            container.style.position = 'relative';
            container.innerHTML = '';

            // Root wrapper
            const root = document.createElement('div');
            root.className  = 'sg-renderer-root';
            root.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0d1117;';
            container.appendChild(root);
            runtime.root = root;

            // Canvas
            root.appendChild(ensureCanvas());
            resizeCanvas();

            // ResizeObserver
            if (typeof ResizeObserver === 'function') {
                runtime.resizeObserver = new ResizeObserver(() => resizeCanvas());
                runtime.resizeObserver.observe(root);
            }

            lastFrameTime = null;
            runtime.animFrameId = requestAnimationFrame(tick);

            if (runtime.lastViewState) update(runtime.lastViewState);
        }

        function unmount() {
            if (runtime.animFrameId) {
                cancelAnimationFrame(runtime.animFrameId);
                runtime.animFrameId = null;
            }
            if (runtime.resizeObserver) {
                runtime.resizeObserver.disconnect();
                runtime.resizeObserver = null;
            }
            if (runtime.root && runtime.root.parentNode) {
                runtime.root.parentNode.removeChild(runtime.root);
            }
            runtime.container  = null;
            runtime.root       = null;
            runtime.canvas     = null;
            runtime.ctx        = null;
            runtime.lastW      = 0;
            runtime.lastH      = 0;
            runtime.drips      = [];
            runtime.scorePops  = [];
            lastFrameTime      = null;
        }

        function update(viewState) {
            runtime.lastViewState = viewState;
        }

        return { mount, unmount, update };
    }

    globalObject.StrengtheningRenderer = { createRenderer };

}(window));
