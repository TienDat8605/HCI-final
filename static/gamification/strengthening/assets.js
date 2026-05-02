(function initStrengtheningAssets(globalObject) {
    'use strict';

    function createAssetStore(manifestPath) {
        const manifestDir = manifestPath.slice(0, manifestPath.lastIndexOf('/') + 1);
        let manifest      = { assets: {} };
        let loadPromise   = null;
        const images      = {};

        function resolvePath(assetPath) {
            if (!assetPath) return '';
            if (
                assetPath.startsWith('http://') ||
                assetPath.startsWith('https://') ||
                assetPath.startsWith('/')
            ) {
                return assetPath;
            }
            return `${manifestDir}${assetPath}`;
        }

        function loadImage(id, assetPath) {
            return new Promise((resolve) => {
                const img    = new Image();
                img.onload   = () => { images[id] = img; resolve(); };
                img.onerror  = () => resolve();   // silent fail → fallback
                img.src      = resolvePath(assetPath);
            });
        }

        async function ensureLoaded() {
            if (loadPromise) return loadPromise;

            loadPromise = fetch(manifestPath)
                .then((res) => (res.ok ? res.json() : { assets: {} }))
                .catch(() => ({ assets: {} }))
                .then(async (data) => {
                    manifest = data && data.assets ? data : { assets: {} };
                    await Promise.all(
                        Object.entries(manifest.assets).map(([id, path]) => loadImage(id, path))
                    );
                    return manifest;
                });

            return loadPromise;
        }

        return {
            ensureLoaded,
            getImage  : (id) => images[id]  || null,
            hasImage  : (id) => Boolean(images[id]),
            getManifest: ()  => manifest,
        };
    }

    globalObject.StrengtheningAssets = { createAssetStore };

}(window));