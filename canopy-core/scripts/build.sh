#!/bin/bash

set -e

if [ -z "$1" ]; then
    echo "❌ Error: No target platform specified."
    echo "Usage: ./build.sh [mac|win|linux|all]"
    exit 1
fi

# Get the directory of the script and go to the canopy-core root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
mkdir -p bin

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
    CGO_ENABLED=1 GOOS=darwin GOARCH=amd64 $GARBLE_CMD build -ldflags="-s -w" -o bin/canopy-core-intel .
    echo "📦 Compiling for Apple Silicon (arm64)..."
    CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 $GARBLE_CMD build -ldflags="-s -w" -o bin/canopy-core-arm64 .
    echo "🔗 Merging into Universal Binary using lipo..."
    lipo -create -output bin/canopy-core bin/canopy-core-intel bin/canopy-core-arm64
    echo "🧹 Cleaning up intermediate binaries..."
    rm bin/canopy-core-intel bin/canopy-core-arm64
    echo "✅ Done! Universal macOS binary 'bin/canopy-core' is ready."
}

build_win() {
    echo "🚀 Building Canopy Core (Windows amd64)..."
    if ! command -v x86_64-w64-mingw32-gcc &> /dev/null; then
        echo "❌ Error: Windows cross-compiler (mingw-w64) not found."
        echo "Please install it via Homebrew: brew install mingw-w64"
        exit 1
    fi
    CGO_ENABLED=1 CC=x86_64-w64-mingw32-gcc CXX=x86_64-w64-mingw32-g++ GOOS=windows GOARCH=amd64 $GARBLE_CMD build -ldflags="-s -w" -o bin/canopy-core.exe .
    echo "✅ Done! Windows binary 'bin/canopy-core.exe' is ready."
}

build_linux() {
    echo "🚀 Building Canopy Core (Linux amd64)..."
    if ! command -v x86_64-linux-musl-gcc &> /dev/null && ! command -v x86_64-linux-gnu-gcc &> /dev/null; then
        echo "❌ Error: Linux cross-compiler not found."
        echo "Please install via Homebrew: brew tap messense/macos-cross-toolchains && brew install x86_64-unknown-linux-gnu"
        exit 1
    fi
    
    # Determine which linux compiler is available
    if command -v x86_64-linux-gnu-gcc &> /dev/null; then
        LINUX_CC="x86_64-linux-gnu-gcc"
        LINUX_CXX="x86_64-linux-gnu-g++"
    else
        LINUX_CC="x86_64-linux-musl-gcc"
        LINUX_CXX="x86_64-linux-musl-g++"
    fi

    CGO_ENABLED=1 CC=$LINUX_CC CXX=$LINUX_CXX GOOS=linux GOARCH=amd64 $GARBLE_CMD build -ldflags="-s -w" -o bin/canopy-core-linux .
    echo "✅ Done! Linux binary 'bin/canopy-core-linux' is ready."
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