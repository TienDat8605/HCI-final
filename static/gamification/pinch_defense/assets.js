(function initPinchDefenseAssets(globalObject) {
    'use strict';

    function createAssetStore(manifestPath) {
        const manifestDirectory = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
        let manifest = { assets: {} };
        let loadPromise = null;
        const images = {};

        function resolvePath(assetPath) {
            if (!assetPath) {
                return '';
            }
            if (assetPath.startsWith('http://') || assetPath.startsWith('https://') || assetPath.startsWith('/')) {
                return assetPath;
            }
            return `${manifestDirectory}${assetPath}`;
        }

        function loadImage(id, assetPath) {
            return new Promise((resolve) => {
                const image = new Image();
                image.onload = () => {
                    images[id] = image;
                    resolve();
                };
                image.onerror = () => resolve();
                image.src = resolvePath(assetPath);
            });
        }

        async function ensureLoaded() {
            if (loadPromise) {
                return loadPromise;
            }

            loadPromise = fetch(manifestPath)
                .then((response) => (response.ok ? response.json() : { assets: {} }))
                .catch(() => ({ assets: {} }))
                .then(async (nextManifest) => {
                    manifest = nextManifest && nextManifest.assets ? nextManifest : { assets: {} };
                    const entries = Object.entries(manifest.assets);
                    await Promise.all(entries.map(([id, assetPath]) => loadImage(id, assetPath)));
                    return manifest;
                });

            return loadPromise;
        }

        return {
            ensureLoaded,
            getImage(id) {
                return images[id] || null;
            },
            getManifest() {
                return manifest;
            },
            hasImage(id) {
                return Boolean(images[id]);
            },
        };
    }

    globalObject.PinchDefenseAssets = {
        createAssetStore,
    };
}(window));
