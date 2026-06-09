#!/bin/bash

set -e

if [ -z "$1" ]; then
    echo "❌ Error: No target platform specified."
    echo "Usage: ./build.sh [mac|win|linux|all]"
    exit 1
fi

TARGET=$1

# Ensure garble is installed and resolving correctly
if command -v garble &> /dev/null; then
    GARBLE_CMD="garble"
else
    GARBLE_BIN="$(go env GOPATH)/bin/garble"
    if [ ! -x "$GARBLE_BIN" ]; then
        echo "📦 Garble not found. Installing mvdan.cc/garble@latest..."
        go install mvdan.cc/garble@latest
    fi
    GARBLE_CMD="$GARBLE_BIN"
fi

build_mac() {
    echo "🚀 Building Canopy Core (Universal macOS Binary)..."
    echo "📦 Compiling for Intel (amd64)..."
    GOOS=darwin GOARCH=amd64 $GARBLE_CMD build -ldflags="-s -w" -o canopy-core-intel .
    echo "📦 Compiling for Apple Silicon (arm64)..."
    GOOS=darwin GOARCH=arm64 $GARBLE_CMD build -ldflags="-s -w" -o canopy-core-arm64 .
    echo "🔗 Merging into Universal Binary using lipo..."
    lipo -create -output canopy-core canopy-core-intel canopy-core-arm64
    echo "🧹 Cleaning up intermediate binaries..."
    rm canopy-core-intel canopy-core-arm64
    echo "✅ Done! Universal macOS binary 'canopy-core' is ready."
}

build_win() {
    echo "🚀 Building Canopy Core (Windows amd64)..."
    GOOS=windows GOARCH=amd64 $GARBLE_CMD build -ldflags="-s -w" -o canopy-core.exe .
    echo "✅ Done! Windows binary 'canopy-core.exe' is ready."
}

build_linux() {
    echo "🚀 Building Canopy Core (Linux amd64)..."
    GOOS=linux GOARCH=amd64 $GARBLE_CMD build -ldflags="-s -w" -o canopy-core-linux .
    echo "✅ Done! Linux binary 'canopy-core-linux' is ready."
}

case $TARGET in
    mac) build_mac ;;
    win) build_win ;;
    linux) build_linux ;;
    all)
        echo "🚀 Building Canopy Core for ALL platforms..."
        build_mac
        build_win
        build_linux
        echo "🎉 All binaries compiled successfully!"
        ;;
    *)
        echo "❌ Error: Invalid target '$TARGET'. Use 'mac', 'win', 'linux', or 'all'."
        exit 1
        ;;
esac