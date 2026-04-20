(function registerPinchDefenseMode(globalObject) {
    'use strict';

    const modeRegistry = globalObject.BlueprintGamificationModes || (globalObject.BlueprintGamificationModes = {});

    function syncState(state) {
        const snapshot = state.session.getSnapshot();
        state.hud = snapshot.hud;
        state.summary = snapshot.summary;
        state.viewState = snapshot.viewState;
        if (state.renderer && state.viewState) {
            state.renderer.update(state.viewState);
        }
    }

    modeRegistry.pinch_defense_mode = {
        id: 'pinch_defense_mode',
        title: 'Pinch Defense',
        description: 'Lane-defense pinch training that rewards clean finger opposition.',
        createInitialState() {
            const config = globalObject.PinchDefenseConfig;
            const detector = globalObject.PinchDefenseInput.createPinchDetector(config);
            const assets = globalObject.PinchDefenseAssets.createAssetStore(config.assetManifestPath);
            const renderer = globalObject.PinchDefenseRenderer.createRenderer(config, assets);
            const session = globalObject.PinchDefenseEngine.createSession(config, detector);

            return {
                hud: {
                    primaryLabel: 'Score',
                    primaryValue: '0',
                    secondaryLabel: 'Combo',
                    secondaryValue: 'Ready',
                    statusText: 'Pinch Defense ready',
                },
                summary: null,
                viewState: null,
                renderer,
                session,
            };
        },
        onSessionStart(state, payload) {
            state.session.start(payload || {});
            syncState(state);
        },
        onFrame(state, payload) {
            state.session.update(payload || {});
            syncState(state);
        },
        onPause(state) {
            state.session.pause();
            syncState(state);
        },
        onResume(state) {
            state.session.resume();
            syncState(state);
        },
        onSessionEnd(state, payload) {
            state.session.finish(payload || {});
            syncState(state);
        },
        mount(state, container) {
            state.renderer.mount(container);
            if (state.viewState) {
                state.renderer.update(state.viewState);
            }
        },
        unmount(state) {
            state.renderer.unmount();
        },
    };
}(window));
