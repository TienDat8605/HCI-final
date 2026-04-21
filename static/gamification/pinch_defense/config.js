(function initPinchDefenseConfig(globalObject) {
    'use strict';

    const FINGERS = {
        index: {
            id: 'index',
            label: 'Index',
            color: '#3b82f6',
            glow: 'rgba(59, 130, 246, 0.34)',
            shape: 'circle',
            tipIndex: 8,
            pinchThreshold: 0.24,
        },
        middle: {
            id: 'middle',
            label: 'Middle',
            color: '#22c55e',
            glow: 'rgba(34, 197, 94, 0.34)',
            shape: 'triangle',
            tipIndex: 12,
            pinchThreshold: 0.25,
        },
        ring: {
            id: 'ring',
            label: 'Ring',
            color: '#facc15',
            glow: 'rgba(250, 204, 21, 0.34)',
            shape: 'square',
            tipIndex: 16,
            pinchThreshold: 0.265,
        },
        pinky: {
            id: 'pinky',
            label: 'Pinky',
            color: '#ef4444',
            glow: 'rgba(239, 68, 68, 0.34)',
            shape: 'diamond',
            tipIndex: 20,
            pinchThreshold: 0.28,
        },
    };

    const FINGER_ORDER = ['index', 'middle', 'ring', 'pinky'];
    const MAX_ACTIVE_ENEMIES = 4;

    const ENEMY_TYPES = {
        ghost: { id: 'ghost', label: 'Ghost', assetId: 'ghost', baseScore: 100, hp: 1 },
        slime: { id: 'slime', label: 'Slime', assetId: 'slime', baseScore: 200, hp: 2 },
        skull: { id: 'skull', label: 'Skull', assetId: 'skull', baseScore: 300, hp: 2 },
    };

    const WAVES = [
        {
            label: 'Wave 1',
            travelTimeMs: 7500,
            spawnIntervalMs: 1500,
            enemies: [
                { type: 'ghost', sequence: ['index'] },
                { type: 'ghost', sequence: ['middle'] },
                { type: 'ghost', sequence: ['ring'] },
                { type: 'ghost', sequence: ['pinky'] },
                { type: 'ghost', sequence: ['index'] },
                { type: 'ghost', sequence: ['middle'] },
            ],
        },
        {
            label: 'Wave 2',
            travelTimeMs: 6700,
            spawnIntervalMs: 1380,
            enemies: [
                { type: 'ghost', sequence: ['ring'] },
                { type: 'ghost', sequence: ['middle'] },
                { type: 'slime', sequence: ['index', 'middle'] },
                { type: 'slime', sequence: ['middle', 'pinky'] },
                { type: 'ghost', sequence: ['pinky'] },
                { type: 'slime', sequence: ['ring', 'index'] },
                { type: 'ghost', sequence: ['index'] },
                { type: 'slime', sequence: ['pinky', 'ring'] },
            ],
        },
        {
            label: 'Wave 3',
            travelTimeMs: 5600,
            spawnIntervalMs: 1260,
            enemies: [
                { type: 'slime', sequence: ['index', 'ring'] },
                { type: 'ghost', sequence: ['middle'] },
                { type: 'skull', sequence: ['middle', 'pinky'] },
                { type: 'slime', sequence: ['ring', 'pinky'] },
                { type: 'ghost', sequence: ['index'] },
                { type: 'slime', sequence: ['middle', 'index'] },
                { type: 'skull', sequence: ['pinky', 'ring'] },
                { type: 'ghost', sequence: ['ring'] },
                { type: 'slime', sequence: ['index', 'middle'] },
                { type: 'ghost', sequence: ['pinky'] },
            ],
        },
    ];

    globalObject.PinchDefenseConfig = {
        assetManifestPath: '/static/gamification/pinch_defense/assets/manifest.json',
        sessionDurationMs: 180000,
        pauseThresholdMs: 800,
        comboWindowMs: 3000,
        playerMaxHp: 100,
        enemyStartX: 1.02,
        playerX: 0.18,
        maxActiveEnemies: MAX_ACTIVE_ENEMIES,
        waveTransitionMs: 1100,
        waveStartLeadMs: 400,
        sampleIntervalMs: 1000,
        rollingAccuracyWindowMs: 10000,
        fingerOrder: FINGER_ORDER,
        fingers: FINGERS,
        enemyTypes: ENEMY_TYPES,
        waves: WAVES,
        pinch: {
            approachBuffer: 0.09,
            releaseBuffer: 0.07,
            relaxedBuffer: 0.045,
            confirmHoldMs: 105,
            relaxedHoldMs: 150,
            releaseHoldMs: 70,
            interConfirmGapMs: 110,
            forceReleaseMs: 750,
            ambiguityMargin: 0.03,
        },
    };
}(window));
