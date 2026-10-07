#!/usr/bin/env bash
# Arma el APK de F1 AR sin Gradle: aapt2 -> javac -> d8/dx -> zipalign -> apksigner.
#
# Necesita:
#   - JDK (javac, keytool)
#   - aapt2, zipalign, apksigner y d8 o dx
#       Ubuntu/Debian: sudo apt-get install aapt zipalign apksigner dalvik-exchange
#       o el Android SDK (build-tools) en el PATH
#   - android.jar de una plataforma reciente (API 34): variable ANDROID_JAR,
#     o $ANDROID_HOME/platforms/android-34/android.jar
#
# Uso: android/build.sh            -> android/build/F1-AR.apk
#      VERSION_CODE=2 VERSION_NAME=1.1 android/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
OUT="${OUT:-$HERE/build}"
# número de versión = cantidad de commits: crece siempre, igual en la compu y en CI
VERSION_CODE="${VERSION_CODE:-$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 1)}"
VERSION_NAME="${VERSION_NAME:-1.0.$VERSION_CODE}"
MIN_SDK=24
TARGET_SDK=34

# ---------------------------------------------------------------- herramientas
find_tool() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then command -v "$name"; return; fi
  # build-tools más nuevas primero
  for d in ${BUILD_TOOLS:-} $(ls -d ${ANDROID_HOME:+$ANDROID_HOME/build-tools/*} /usr/lib/android-sdk/build-tools/* 2>/dev/null | sort -rV); do
    [ -x "$d/$name" ] && { echo "$d/$name"; return; }
  done
  return 1
}
AAPT2="$(find_tool aapt2)" || { echo "Falta aapt2" >&2; exit 1; }
ZIPALIGN="$(find_tool zipalign)" || { echo "Falta zipalign" >&2; exit 1; }
APKSIGNER="$(find_tool apksigner)" || { echo "Falta apksigner" >&2; exit 1; }
D8="$(find_tool d8 || true)"
DX="$(find_tool dx || find_tool dalvik-exchange || true)"
[ -n "$D8" ] || [ -n "$DX" ] || { echo "Falta d8 o dx" >&2; exit 1; }

if [ -z "${ANDROID_JAR:-}" ]; then
  for c in ${ANDROID_HOME:+$ANDROID_HOME/platforms/android-$TARGET_SDK/android.jar} \
           ${ANDROID_SDK_ROOT:+$ANDROID_SDK_ROOT/platforms/android-$TARGET_SDK/android.jar}; do
    [ -f "$c" ] && ANDROID_JAR="$c" && break
  done
fi
[ -n "${ANDROID_JAR:-}" ] && [ -f "$ANDROID_JAR" ] || { echo "Falta android.jar (API $TARGET_SDK): definí ANDROID_JAR" >&2; exit 1; }

echo "aapt2:     $AAPT2"
echo "dex:       ${D8:-$DX}"
echo "android:   $ANDROID_JAR"

rm -rf "$OUT"
mkdir -p "$OUT/assets/www" "$OUT/gen" "$OUT/classes" "$OUT/compiled" "$OUT/dex"

# ---------------------------------------------------------------- 1) el juego (assets/www)
for f in index.html manifest.webmanifest sw.js; do cp "$ROOT/$f" "$OUT/assets/www/"; done
for d in css fonts icons js vendor; do cp -R "$ROOT/$d" "$OUT/assets/www/"; done
# caché del service worker atada a esta versión del APK: al actualizar la app se renueva
sed -i "s/^const CACHE = 'f1ar-[^']*';/const CACHE = 'f1ar-apk-$VERSION_CODE';/" "$OUT/assets/www/sw.js"
grep -q "f1ar-apk-$VERSION_CODE" "$OUT/assets/www/sw.js" || { echo "No pude versionar sw.js" >&2; exit 1; }
# chequeo: todo lo que el service worker precachea tiene que estar
python3 - "$ROOT/sw.js" "$OUT/assets/www" <<'PY'
import re, sys, os
files = re.findall(r"'\./([^']*)'", open(sys.argv[1]).read())
missing = [f for f in files if f and not os.path.exists(os.path.join(sys.argv[2], f))]
if missing:
    sys.exit("Faltan archivos del service worker: " + ", ".join(missing))
PY

# ---------------------------------------------------------------- 2) recursos + manifest
"$AAPT2" compile --dir "$HERE/res" -o "$OUT/compiled/res.zip"
"$AAPT2" link \
  -o "$OUT/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$HERE/AndroidManifest.xml" \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME" \
  -A "$OUT/assets" \
  --java "$OUT/gen" \
  "$OUT/compiled/res.zip"

# ---------------------------------------------------------------- 3) Java -> clases
find "$HERE/src" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options \
  -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" \
  -d "$OUT/classes" @"$OUT/sources.txt"

# ---------------------------------------------------------------- 4) clases -> classes.dex
if [ -n "$D8" ]; then
  find "$OUT/classes" -name '*.class' > "$OUT/classes.txt"
  "$D8" --release --min-api "$MIN_SDK" --lib "$ANDROID_JAR" --output "$OUT/dex" @"$OUT/classes.txt"
else
  "$DX" --dex --min-sdk-version="$MIN_SDK" --output="$OUT/dex/classes.dex" "$OUT/classes"
fi

# ---------------------------------------------------------------- 5) APK, alineado y firmado
cp "$OUT/base.apk" "$OUT/unaligned.apk"
(cd "$OUT/dex" && zip -q -X "$OUT/unaligned.apk" classes.dex)
"$ZIPALIGN" -p -f 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"

# Clave de firma: por defecto, una clave de DEBUG pública (está en el repo) para que
# cualquiera pueda recompilar y actualizar su propia instalación. Para distribuir
# públicamente, usá tu propia clave privada: KEYSTORE=/ruta KS_PASS=... KEY_ALIAS=...
KEYSTORE="${KEYSTORE:-$HERE/f1ar-debug.keystore}"
KS_PASS="${KS_PASS:-f1ar-debug}"
KEY_ALIAS="${KEY_ALIAS:-f1ar}"
if [ ! -f "$KEYSTORE" ]; then
  echo "Creando clave de firma $KEYSTORE"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias "$KEY_ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=F1 AR, O=F1 AR, C=AR" >/dev/null 2>&1
fi
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias "$KEY_ALIAS" \
  --key-pass "pass:$KS_PASS" --min-sdk-version "$MIN_SDK" \
  --out "$OUT/F1-AR.apk" "$OUT/aligned.apk"
"$APKSIGNER" verify --min-sdk-version "$MIN_SDK" "$OUT/F1-AR.apk"
"$ZIPALIGN" -c -p 4 "$OUT/F1-AR.apk"

echo
echo "Listo: $OUT/F1-AR.apk ($(du -h "$OUT/F1-AR.apk" | cut -f1)) · versión $VERSION_NAME ($VERSION_CODE)"
