# Void Linux Packaging (XBPS)

## 1. Прямая установка бинарного пакета (.xbps)

После сборки пакета командой:
```bash
npm run build:xbps
```

В папке `dist/` создается пакет:
- `zipply-0.4.0_1.x86_64.xbps`

Установить пакет в Void Linux:
```bash
# Создать локальный репозиторий / индекс:
xbps-rindex -a dist/zipply-0.4.0_1.x86_64.xbps

# Установить:
sudo xbps-install --repository=dist zipply
```

## 2. Сборка через xbps-src (void-packages)

1. Клонируйте void-packages:
```bash
git clone https://github.com/void-linux/void-packages.git
cd void-packages
./xbps-src binary-bootstrap
```

2. Скопируйте папку `void` в `srcpkgs/zipply`:
```bash
mkdir -p srcpkgs/zipply
cp /path/to/zipply/void/template srcpkgs/zipply/
```

3. Запустите сборку:
```bash
./xbps-src pkg zipply
```
