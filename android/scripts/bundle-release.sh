#!/bin/zsh
# Builds the signed release AAB. The upload key comes from the macOS Keychain
# (account "gente", services ANDROID_UPLOAD_KEY*), lives in a temp file only during the
# build, and is deleted afterwards. Nothing secret is written into the repo.
set -euo pipefail
cd "${0:A:h}/.."
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
security find-generic-password -a gente -s ANDROID_UPLOAD_KEYSTORE_B64 -w | base64 -d > "$T/upload.p12"
export GENTE_UPLOAD_STORE_FILE="$T/upload.p12"
export GENTE_UPLOAD_STORE_PASSWORD="$(security find-generic-password -a gente -s ANDROID_UPLOAD_KEY_PASSWORD -w)"
export GENTE_UPLOAD_KEY_PASSWORD="$GENTE_UPLOAD_STORE_PASSWORD"
export GENTE_UPLOAD_KEY_ALIAS="$(security find-generic-password -a gente -s ANDROID_UPLOAD_KEY_ALIAS -w)"
./gradlew --no-configuration-cache :app:bundleRelease "$@"
echo "AAB: $(pwd)/app/build/outputs/bundle/release/app-release.aab"
