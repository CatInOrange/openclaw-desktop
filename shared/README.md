# Shared platform-independent assets and business rules

- `core/music-controller.cjs`: the single implementation of heart-mode login state, queue refill/recycling, likes and failure handling. No Electron/Node/Android imports; network, credential storage and UI updates are injected. Desktop keeps a compatibility export at `src/music-controller.cjs`.
- `contracts/gateway-cases.json`: a shared conformance corpus for desktop JavaScript and Android Kotlin URL/origin policies. Host adapters may differ, but token URL rejection and exact-origin boundaries must agree.
- Original icons, pet art and media remain centralized in repository `assets/`. Android derives launcher icons from the same `assets/icon.png` during the build; generated copies are not a second source of truth. Large desktop video/pet assets are intentionally not included in the first Android connection APK.

Android v0.1 is a connection shell, not a claim that the shared JS music core already runs in an Android background service. That runtime/backend integration remains a separately verified step before music ships. Do not put the player business loop inside the remote Control UI WebView and assume it survives background/lockscreen.
