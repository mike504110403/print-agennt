#!/bin/bash

echo "📦 開始打包 Print Agent ..."

# 1. 安裝依賴
yarn install

# 2. 清除之前的編譯結果
rm -rf out

# 3. 建立 macOS .app 及 Windows .exe
yarn make

echo ""
echo "✅ 打包完成！請查看 ./out/make"
