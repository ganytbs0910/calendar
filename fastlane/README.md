fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## Android

### android deploy

```sh
[bundle exec] fastlane android deploy
```

リリース用AABをビルドしてGoogle Playにアップロード（内部テスト）

### android build

```sh
[bundle exec] fastlane android build
```

リリース用AABをビルドのみ（アップロードなし）

### android release

```sh
[bundle exec] fastlane android release
```

本番リリース

----


## iOS

### ios deploy

```sh
[bundle exec] fastlane ios deploy
```

App Store Connect にアップロード

### ios build

```sh
[bundle exec] fastlane ios build
```

iOSビルドのみ（アップロードなし）

### ios beta

```sh
[bundle exec] fastlane ios beta
```

TestFlightにアップロード

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
