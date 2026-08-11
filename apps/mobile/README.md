# Didar Mobile (Android, native)

Flutter app — client #2 in `docs/product/blueprint.md` §1 ("نسخه 2: Android App"),
same backend as `storefront`/`admin`/`pwa`. Flutter was chosen (blueprint §7) for one
codebase covering Android now, native iOS later if needed, plus camera/AR/push/deep
linking support.

## ⚠️ Platform folders (`android/`, `ios/`) do not exist yet

**The Flutter SDK is not installed in the environment this scaffold was generated
in**, so `android/`, `ios/`, and the other platform-runner directories that
`flutter create` normally generates (Gradle files, an Xcode project, platform
manifests, CI-friendly wrapper scripts, …) were deliberately **not** hand-written.
That boilerplate is substantial, easy to get subtly wrong by hand, and needs to be
produced by the actual toolchain to be trustworthy.

`pubspec.yaml`, `analysis_options.yaml`, and everything under `lib/`/`test/` **is**
real and follows the structure in blueprint §71 — but none of it has been run
through `flutter pub get`, `flutter analyze`, or `flutter test` yet either.

### To finish bootstrapping this app locally

```bash
cd apps/mobile
flutter create . --platforms=android,ios --org ir.didar --project-name didar_mobile
flutter pub get
flutter analyze
flutter test
```

`flutter create .` on an existing directory fills in the missing platform folders
without touching `lib/`, `pubspec.yaml`, or `analysis_options.yaml`. Re-verify the
dependency versions in `pubspec.yaml` (`flutter pub outdated`) at that point too —
they were selected by checking npm-adjacent latest-version signals, not
`pub.dev` directly.

## Structure

```
lib/
├── core/       — network client, secure storage, router, theme (see lib/core/README.md)
├── features/   — one dir per feature, home/ is the only one started (see lib/features/README.md)
└── shared/     — cross-feature widgets/extensions (see lib/shared/README.md)
```

## Non-negotiable

Same rule as every other client: no product/category/price/promotion data
hardcoded here. This app is a UI over `services/api` — see root `CLAUDE.md`.
